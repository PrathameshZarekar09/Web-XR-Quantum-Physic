import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';

// =============================================================================
// LABORATORY HUMAN SCALE & OPTICAL AXIS ALIGNMENT CONSTANTS
// =============================================================================
// Calibrate the lab room and apparatus to true human ergonomic scale (~0.70x)
// Physical standing eye height in WebXR Quest is ~1.55m - 1.65m.
// With LAB_SCALE = 0.70:
// - Optical Axis (Laser, Slits, Detector, Screen) = 2.10 * 0.70 = 1.47m (perfect chest/eye line of sight)
// - Bench Workbench Height = 1.00 * 0.70 = 0.70m (standard laboratory table height)
// - Console Buttons Height = 1.78 * 0.70 = 1.25m (natural arm-reach height for hands/controllers)
const LAB_SCALE = 0.70;
const OPTICAL_AXIS_Y = 2.10;
const Y_SHIFT_SLITS = OPTICAL_AXIS_Y - 2.70; // -0.60m vertical offset to align slits with optical axis
const Y_SHIFT_SCREEN = OPTICAL_AXIS_Y - 2.70; // -0.60m vertical offset to align screen with optical axis
const SCREEN_X = 6.40;
const SCREEN_FACE_X = SCREEN_X - 0.12; // Front phosphor surface facing beam
const dx = SCREEN_X - 5.30; // separation offset from original GLB position

// =============================================================================
// QUANTUM SIMULATION STATE
// =============================================================================
const state = {
    currentAppView: 'portal', // 'portal' | 'experiments' | 'experiment' | 'theory'
    emitterActive: true,
    detectorActive: false,
    beamMode: 'stream', // 'stream' | 'single'
    emissionRate: 60,   // particles per sec
    wavelength: 500,    // nm
    slitSeparation: 0.28, // mm (physical model distance roughly 0.28m mapped)
    slitWidth: 0.06,
    screenDistance: 6.4,
    totalHits: 0,
    audioEnabled: false,
    audioMuted: false,
    userScale: 1.0,
    userHeightOffset: 0.0, // Natural eye-level in VR (0.0 offset = real physical standing eye height ~1.6m)
    histogramBins: 120,
    hitHistogram: new Array(120).fill(0),
    maxHistCount: 1,
    activeView: 'overview',
    vrMenuVisible: true
};

// =============================================================================
// WEB AUDIO PROCEDURAL SYNTHESIZER
// =============================================================================
class QuantumAudioEngine {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.labHum = null;
        this.emitterOsc = null;
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(0.3, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);

        // Ambient Lab Hum
        try {
            const humOsc = this.ctx.createOscillator();
            const humFilter = this.ctx.createBiquadFilter();
            const humGain = this.ctx.createGain();

            humOsc.type = 'sine';
            humOsc.frequency.setValueAtTime(55, this.ctx.currentTime); // 55Hz low hum

            humFilter.type = 'lowpass';
            humFilter.frequency.setValueAtTime(120, this.ctx.currentTime);

            humGain.gain.setValueAtTime(0.08, this.ctx.currentTime);

            humOsc.connect(humFilter);
            humFilter.connect(humGain);
            humGain.connect(this.masterGain);

            humOsc.start();
            this.labHum = humGain;
        } catch (e) {
            console.warn('Audio Init hum error:', e);
        }

        this.initialized = true;
        state.audioEnabled = true;
    }

    playButtonClick(type = 'default') {
        if (!this.initialized || state.audioMuted) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'triangle';
        const freq = type === 'power' ? 880 : (type === 'detector' ? 660 : 440);
        osc.frequency.setValueAtTime(freq, now);
        osc.frequency.exponentialRampToValueAtTime(110, now + 0.08);

        gain.gain.setValueAtTime(0.25, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(now);
        osc.stop(now + 0.08);
    }

    playPageFlipSound() {
        if (!this.initialized || state.audioMuted || !this.ctx) return;
        try {
            const now = this.ctx.currentTime;
            const sampleRate = this.ctx.sampleRate;
            const bufferSize = Math.floor(sampleRate * 0.22);
            const noiseBuffer = this.ctx.createBuffer(1, bufferSize, sampleRate);
            const output = noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                output[i] = (Math.random() * 2 - 1) * Math.exp(-i / (sampleRate * 0.08));
            }
            const whiteNoise = this.ctx.createBufferSource();
            whiteNoise.buffer = noiseBuffer;

            const filter = this.ctx.createBiquadFilter();
            filter.type = 'bandpass';
            filter.frequency.setValueAtTime(1800, now);
            filter.frequency.exponentialRampToValueAtTime(500, now + 0.2);
            filter.Q.setValueAtTime(2.2, now);

            const gain = this.ctx.createGain();
            gain.gain.setValueAtTime(0.001, now);
            gain.gain.linearRampToValueAtTime(0.32, now + 0.03);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

            whiteNoise.connect(filter);
            filter.connect(gain);
            gain.connect(this.masterGain);

            whiteNoise.start(now);
            whiteNoise.stop(now + 0.2);

            // Subtle paper settling thud
            const thudOsc = this.ctx.createOscillator();
            const thudGain = this.ctx.createGain();
            thudOsc.type = 'sine';
            thudOsc.frequency.setValueAtTime(170, now + 0.1);
            thudOsc.frequency.exponentialRampToValueAtTime(45, now + 0.24);

            thudGain.gain.setValueAtTime(0.001, now);
            thudGain.gain.setValueAtTime(0.18, now + 0.1);
            thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

            thudOsc.connect(thudGain);
            thudGain.connect(this.masterGain);

            thudOsc.start(now + 0.1);
            thudOsc.stop(now + 0.24);
        } catch (e) {
            console.warn('Page flip audio error:', e);
        }
    }

    playParticleHit() {
        if (!this.initialized || state.audioMuted || Math.random() > 0.35) return; // sub-sample hits so it sounds like geiger counter
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        // Geiger-like short burst
        osc.type = 'square';
        osc.frequency.setValueAtTime(1800 + Math.random() * 800, now);
        osc.frequency.exponentialRampToValueAtTime(300, now + 0.015);

        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.015);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(now);
        osc.stop(now + 0.018);
    }

    playDetectorSweep(active) {
        if (!this.initialized || state.audioMuted) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sawtooth';
        if (active) {
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.exponentialRampToValueAtTime(1200, now + 0.25);
        } else {
            osc.frequency.setValueAtTime(1200, now);
            osc.frequency.exponentialRampToValueAtTime(300, now + 0.25);
        }

        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(now);
        osc.stop(now + 0.26);
    }

    playTeleportSound() {
        if (!this.initialized || state.audioMuted) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.15);
        osc.frequency.exponentialRampToValueAtTime(320, now + 0.35);

        gain.gain.setValueAtTime(0.22, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

        osc.connect(gain);
        gain.connect(this.masterGain);

        osc.start(now);
        osc.stop(now + 0.36);
    }

    toggleMute() {
        state.audioMuted = !state.audioMuted;
        if (this.masterGain && this.ctx) {
            this.masterGain.gain.setValueAtTime(state.audioMuted ? 0 : 0.3, this.ctx.currentTime);
        }
        return state.audioMuted;
    }
}

const audio = new QuantumAudioEngine();

// Auto-start audio on first user gesture
function ensureAudio() {
    if (!audio.initialized) {
        audio.init();
    } else if (audio.ctx && audio.ctx.state === 'suspended') {
        audio.ctx.resume();
    }
}
window.addEventListener('click', ensureAudio, { once: true });
window.addEventListener('keydown', ensureAudio, { once: true });

// =============================================================================
// SCENE, CAMERA, RENDERER & HIGH-FIDELITY PBR ENVIRONMENT
// =============================================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0f1d);
scene.fog = new THREE.FogExp2(0x0a0f1d, 0.018);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.05, 100);
camera.position.set(0.7, 1.75, 3.65);

const xrRig = new THREE.Group();
xrRig.position.set(0, 0, 0); // Keep at world origin in non-VR so controls.target and camera.position operate 1:1 in true world coordinates
scene.add(xrRig);
xrRig.add(camera);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

// Compile Procedural PBR Room Environment for Realistic Metal & Specular Radiance
const pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();
const roomEnvironment = new RoomEnvironment();
scene.environment = pmremGenerator.fromScene(roomEnvironment, 0.04).texture;

// Reset XR Rig when entering VR session - calibrated to human laboratory scale
renderer.xr.addEventListener('sessionstart', () => {
    xrRig.position.set(1.0 * LAB_SCALE, state.userHeightOffset, 3.5 * LAB_SCALE);
    xrRig.rotation.set(0, 0, 0);
    if (vrMenuRoot) {
        updateVRMenuTexture();
    }
});

renderer.xr.addEventListener('sessionend', () => {
    xrRig.position.set(0, 0, 0);
    xrRig.rotation.set(0, 0, 0);
    setAppView(state.currentAppView);
});

// VR Button with Hand Tracking Feature enabled
const vrBtn = VRButton.createButton(renderer, {
    optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking']
});
document.body.appendChild(vrBtn);

// Orbit Controls calibrated to human scale optical axis
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0.7, OPTICAL_AXIS_Y * LAB_SCALE, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI / 2 - 0.02; // prevent going below floor
controls.minDistance = 0.35;
controls.maxDistance = 14;
controls.update();

// =============================================================================
// COMPREHENSIVE LABORATORY LIGHTING SETUP
// =============================================================================
const ambientLight = new THREE.AmbientLight(0xdbeafe, 1.15);
scene.add(ambientLight);

const hemisphereLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 1.35);
scene.add(hemisphereLight);

const mainSun = new THREE.DirectionalLight(0xffffff, 2.4);
mainSun.position.set(4 * LAB_SCALE, 9 * LAB_SCALE, 5 * LAB_SCALE);
mainSun.castShadow = true;
mainSun.shadow.mapSize.width = 2048;
mainSun.shadow.mapSize.height = 2048;
mainSun.shadow.camera.near = 0.5;
mainSun.shadow.camera.far = 25;
mainSun.shadow.camera.left = -8;
mainSun.shadow.camera.right = 8;
mainSun.shadow.camera.top = 8;
mainSun.shadow.camera.bottom = -8;
mainSun.shadow.bias = -0.0005;
scene.add(mainSun);

// Soft Fill Light to eliminate harsh black regions
const fillLight = new THREE.DirectionalLight(0x8bc4ff, 1.3);
fillLight.position.set(-6 * LAB_SCALE, 7 * LAB_SCALE, 4 * LAB_SCALE);
scene.add(fillLight);

// Overhead Optical Bench Spotlight focused directly on aligned optical axis
const benchSpot = new THREE.SpotLight(0xffffff, 3.2, 16 * LAB_SCALE, Math.PI / 3, 0.45, 1);
benchSpot.position.set(0, 5.2 * LAB_SCALE, 1.2 * LAB_SCALE);
benchSpot.target.position.set(0, OPTICAL_AXIS_Y * LAB_SCALE, 0);
scene.add(benchSpot);
scene.add(benchSpot.target);

// Console Desk Task Light
const consoleSpot = new THREE.SpotLight(0x60a5fa, 2.0, 8 * LAB_SCALE, Math.PI / 4, 0.3);
consoleSpot.position.set(-1.5 * LAB_SCALE, 3.8 * LAB_SCALE, 2.5 * LAB_SCALE);
consoleSpot.target.position.set(-1.5 * LAB_SCALE, 1.45 * LAB_SCALE, 2.3 * LAB_SCALE);
scene.add(consoleSpot);
scene.add(consoleSpot.target);

// Dynamic Accent Lights focused on Emitter, Detector, and Screen Face
const emitterLight = new THREE.PointLight(0x00f0ff, 2.8, 4.5 * LAB_SCALE);
emitterLight.position.set(-3.12 * LAB_SCALE, OPTICAL_AXIS_Y * LAB_SCALE, 0);
scene.add(emitterLight);

const detectorLight = new THREE.PointLight(0xff2d87, 0, 4.0 * LAB_SCALE);
detectorLight.position.set(3.0 * LAB_SCALE, OPTICAL_AXIS_Y * LAB_SCALE, 0.5 * LAB_SCALE);
scene.add(detectorLight);

const screenGlowLight = new THREE.PointLight(0x00ff88, 1.6, 4.5 * LAB_SCALE);
screenGlowLight.position.set(SCREEN_FACE_X * LAB_SCALE, OPTICAL_AXIS_Y * LAB_SCALE, 0);
scene.add(screenGlowLight);

// Pendant Lamps
[-4, 0, 4].forEach(x => {
    const lampLight = new THREE.PointLight(0xffe8cc, 1.4, 8.0 * LAB_SCALE);
    lampLight.position.set(x * LAB_SCALE, 4.2 * LAB_SCALE, -1.5 * LAB_SCALE);
    scene.add(lampLight);
});

// =============================================================================
// UNIFIED LASER COLOR (CONSISTENT LASER GREEN AS IN REFERENCE IMAGE)
// =============================================================================
function wavelengthToRGB(wl) {
    // Keep unified laser green matching the reference image (#00ff88)
    const R = 0;
    const G = 255;
    const B = 136;
    const hex = 0x00ff88;
    return { r: R, g: G, b: B, hex: hex, css: `rgb(${R}, ${G}, ${B})` };
}

function wavelengthToHex(wl) {
    return 0x00ff88;
}

// =============================================================================
// REALISTIC OPTICAL LASER INTERFERENCE FRINGE PATTERN RENDERER
// Generates high-fidelity vertical diffraction & interference fringes
// with core laser bloom, vertical Gaussian beam fade, and matching spectral color
// =============================================================================
function renderOpticalFringePattern(canvas, ctx, options = {}) {
    if (!canvas || !ctx) return;
    const w = canvas.width;
    const h = canvas.height;

    const wl = options.wavelength !== undefined ? options.wavelength : state.wavelength;
    const dMm = options.slitSeparation !== undefined ? options.slitSeparation : state.slitSeparation;
    const aMm = options.slitWidth !== undefined ? options.slitWidth : state.slitWidth;
    const DM = options.screenDistance !== undefined ? options.screenDistance : state.screenDistance;
    const detectorActive = options.detectorActive !== undefined ? options.detectorActive : state.detectorActive;
    const emitterActive = options.emitterActive !== undefined ? options.emitterActive : state.emitterActive;

    if (!emitterActive) {
        ctx.fillStyle = '#020403';
        ctx.fillRect(0, 0, w, h);
        return;
    }

    // Determine laser color from wavelength or detector status
    const rgb = detectorActive ? { r: 255, g: 45, b: 135 } : wavelengthToRGB(wl);

    // 256-level optical laser bloom LUT (gamma expansion + laser core blooming)
    const lut = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        const I = i / 255.0;
        if (I <= 0.003) {
            lut[i] = 0xff000000; // Deep optical dark background
            continue;
        }

        const lum = Math.pow(I, 0.85); // High dynamic range curve
        let r = rgb.r * lum;
        let g = rgb.g * lum;
        let b = rgb.b * lum;

        // Laser core bloom (slight whitening / high luminosity core at maximum intensity)
        if (lum > 0.60) {
            const core = Math.pow((lum - 0.60) / 0.40, 1.6);
            r = r + (255 - r) * core * 0.60;
            g = g + (255 - g) * core * 0.60;
            b = b + (255 - b) * core * 0.60;
        }

        const R = Math.min(255, Math.max(0, Math.round(r)));
        const G = Math.min(255, Math.max(0, Math.round(g)));
        const B = Math.min(255, Math.max(0, Math.round(b)));
        lut[i] = (255 << 24) | (B << 16) | (G << 8) | R;
    }

    // 1. Horizontal cross-section: I(z) = cos^2(pi * d * z / lambda D) * sinc^2(pi * a * z / lambda D)
    const Ix = new Float32Array(w);
    const lambda = (wl * 1e-9) * 8e5;
    const d = dMm;
    const a = aMm;
    const D = DM;

    if (!detectorActive) {
        for (let x = 0; x < w; x++) {
            const testZ = ((x / w) * 2 - 1) * 1.4;
            const phase = (Math.PI * d * testZ) / (lambda * D);
            const sincArg = (Math.PI * a * testZ) / (lambda * D);
            const sinc = sincArg === 0 ? 1 : Math.sin(sincArg) / sincArg;
            Ix[x] = Math.cos(phase) * Math.cos(phase) * (sinc * sinc);
        }
    } else {
        // Decoherence / Observer ON: Classical Double Gaussian Clumps
        const center = d * 1.5;
        const sigma = 0.22;
        for (let x = 0; x < w; x++) {
            const testZ = ((x / w) * 2 - 1) * 1.4;
            const g1 = Math.exp(-Math.pow(testZ + center, 2) / (2 * sigma * sigma));
            const g2 = Math.exp(-Math.pow(testZ - center, 2) / (2 * sigma * sigma));
            Ix[x] = (g1 + g2) * 0.5;
        }
    }

    // 2. Vertical profile: Gaussian beam waist + soft aperture fade
    const Iy = new Float32Array(h);
    for (let y = 0; y < h; y++) {
        const v = (y - h / 2) / (h / 2); // [-1, 1]
        Iy[y] = Math.exp(-(v * v) / (2 * 0.38 * 0.38)) * Math.max(0, 1 - Math.pow(v, 6));
    }

    // 3. Fast separable buffer synthesis
    const imgData = ctx.createImageData(w, h);
    const buf32 = new Uint32Array(imgData.data.buffer);
    for (let y = 0; y < h; y++) {
        const vy = Iy[y];
        const row = y * w;
        for (let x = 0; x < w; x++) {
            const idx = Math.min(255, Math.max(0, Math.floor(Ix[x] * vy * 255)));
            buf32[row + x] = lut[idx];
        }
    }
    ctx.putImageData(imgData, 0, 0);
}

// =============================================================================
// PHOSPHOR DETECTION SCREEN (DYNAMIC CANVAS TEXTURE)
// =============================================================================
const screenCanvas = document.createElement('canvas');
screenCanvas.width = 512;
screenCanvas.height = 512;
const screenCtx = screenCanvas.getContext('2d');

function updateScreenTexture() {
    renderOpticalFringePattern(screenCanvas, screenCtx, {
        wavelength: state.wavelength,
        slitSeparation: state.slitSeparation,
        slitWidth: state.slitWidth,
        screenDistance: state.screenDistance,
        detectorActive: state.detectorActive,
        emitterActive: state.emitterActive
    });

    // Phosphor screen rectangular grid pattern
    screenCtx.strokeStyle = 'rgba(0, 255, 136, 0.12)';
    screenCtx.lineWidth = 1;
    for (let x = 0; x < 512; x += 32) {
        screenCtx.beginPath();
        screenCtx.moveTo(x, 0);
        screenCtx.lineTo(x, 512);
        screenCtx.stroke();
    }
    for (let y = 0; y < 512; y += 32) {
        screenCtx.beginPath();
        screenCtx.moveTo(0, y);
        screenCtx.lineTo(512, y);
        screenCtx.stroke();
    }

    // Phosphor screen rectangular border guide with matching green
    screenCtx.strokeStyle = state.detectorActive ? 'rgba(255, 45, 135, 0.45)' : 'rgba(0, 255, 170, 0.5)';
    screenCtx.lineWidth = 4;
    screenCtx.strokeRect(6, 6, 500, 500);

    if (screenTexture) screenTexture.needsUpdate = true;
}

function initScreenTexture() {
    updateScreenTexture();
}

const screenTexture = new THREE.CanvasTexture(screenCanvas);
screenTexture.generateMipmaps = true;
screenTexture.minFilter = THREE.LinearMipmapLinearFilter;

initScreenTexture();

// Screen Panel Material
const screenMaterial = new THREE.MeshStandardMaterial({
    map: screenTexture,
    emissive: 0x003318,
    emissiveMap: screenTexture,
    emissiveIntensity: 0.95,
    roughness: 0.35,
    metalness: 0.1,
    polygonOffset: true,
    polygonOffsetFactor: -1.5,
    polygonOffsetUnits: -1.5
});

// Particle Screen Hit Drawer
function recordScreenHit(normZ, normY) {
    // normZ in [-1, 1], normY in [-1, 1]
    const px = Math.floor(((normZ + 1) / 2) * 512);
    const py = Math.floor(((1 - normY) / 2) * 512);

    if (px >= 0 && px < 512 && py >= 0 && py < 512) {
        const rad = 3.2;
        const grad = screenCtx.createRadialGradient(px, py, 0, px, py, rad);
        const rgb = state.detectorActive ? { r: 255, g: 45, b: 135 } : wavelengthToRGB(state.wavelength);
        const color = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b},`;

        grad.addColorStop(0, color + ' 1.0)');
        grad.addColorStop(0.4, color + ' 0.6)');
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');

        screenCtx.fillStyle = grad;
        screenCtx.beginPath();
        screenCtx.arc(px, py, rad, 0, Math.PI * 2);
        screenCtx.fill();

        screenTexture.needsUpdate = true;
    }

    // Update Histogram Bin
    const bin = Math.min(state.histogramBins - 1, Math.max(0, Math.floor(((normZ + 1) / 2) * state.histogramBins)));
    state.hitHistogram[bin]++;
    if (state.hitHistogram[bin] > state.maxHistCount) {
        state.maxHistCount = state.hitHistogram[bin];
    }

    state.totalHits++;
    audio.playParticleHit();
}

function clearScreenHits() {
    updateScreenTexture();
    state.hitHistogram.fill(0);
    state.maxHistCount = 1;
    state.totalHits = 0;
    updateHUDStats();
    updateIntensityGraph();
}

// =============================================================================
// 3D MODEL NODES & INTERACTIVE OBJECTS
// =============================================================================
let modelRoot = null;
const interactiveObjects = [];
const buttonNodes = {
    emitter: null,
    detector: null,
    reset: null,
    switch: null,
    detectorStatus: null,
    beam: null,
    slitGlows: [],
    bands: []
};

const buttonAnimState = {
    emitter: { currentY: 0, targetY: 0 },
    detector: { currentY: 0, targetY: 0 },
    reset: { currentY: 0, targetY: 0 }
};

// =============================================================================
// LOAD GLB 3D MODEL WITH PBR MATERIAL ENHANCEMENT
// =============================================================================
const particleGroup = new THREE.Group();
const loader = new GLTFLoader();
function dismissLoadingScreen() {
    const loadingEl = document.getElementById('loading');
    if (loadingEl && loadingEl.style.display !== 'none') {
        loadingEl.style.opacity = '0';
        setTimeout(() => {
            loadingEl.style.display = 'none';
        }, 350);
    }
}

// Auto-dismiss loading screen quickly so the Hub Portal is immediately interactive
setTimeout(dismissLoadingScreen, 250);

loader.load(
    './models/YDSE1.glb',
    function (gltf) {
        modelRoot = gltf.scene;
        modelRoot.scale.set(LAB_SCALE, LAB_SCALE, LAB_SCALE);
        scene.add(modelRoot);

        // Add particle system directly to modelRoot so all particle positions share local lab coordinates
        modelRoot.add(particleGroup);

        // High-Tech Laboratory Floor Pedestal for the Screen Station
        const screenPedestalGroup = new THREE.Group();
        screenPedestalGroup.position.set(SCREEN_X, 0, 0);

        const pedestalMat = new THREE.MeshStandardMaterial({
            color: 0x182030,
            metalness: 0.75,
            roughness: 0.35
        });

        // Ground Base Plate
        const basePlate = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.12, 1.9), pedestalMat);
        basePlate.position.set(0, 0.06, 0);
        basePlate.receiveShadow = true;
        basePlate.castShadow = true;
        screenPedestalGroup.add(basePlate);

        // Dual Heavy Vertical Support Columns (solid connection from base plate to screen stand base at y = 0.55m)
        const pillarMat = new THREE.MeshStandardMaterial({
            color: 0x223046,
            metalness: 0.8,
            roughness: 0.25
        });
        const leftPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.43, 24), pillarMat);
        leftPillar.position.set(0, 0.335, -0.5);
        leftPillar.castShadow = true;
        const rightPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.43, 24), pillarMat);
        rightPillar.position.set(0, 0.335, 0.5);
        rightPillar.castShadow = true;
        screenPedestalGroup.add(leftPillar);
        screenPedestalGroup.add(rightPillar);

        // Floor Glowing Alignment Ring
        const floorRing = new THREE.Mesh(
            new THREE.RingGeometry(0.88, 0.96, 36).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({
                color: 0x00ff88,
                transparent: true,
                opacity: 0.55,
                side: THREE.DoubleSide
            })
        );
        floorRing.position.set(0, 0.005, 0);
        screenPedestalGroup.add(floorRing);

        modelRoot.add(screenPedestalGroup);

        modelRoot.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;

                // 1. OPTICAL AXIS ALIGNMENT (Vertical Y-Shift)
                // Bring Double Slits down (-0.60m) so slit apertures align with Emitter nozzle (y = 2.10m)
                if (child.name === 'Slit_Base' || child.name.startsWith('Barrier_') || child.name.startsWith('Slit_Frame_') || child.name.startsWith('SlitGlow_') || child.name === 'Slit_Label') {
                    child.position.y += Y_SHIFT_SLITS;
                }
                // Bring Phosphor Screen and frame down (-0.60m) so screen center aligns with beam impact (y = 2.10m)
                else if (child.name === 'Screen_Panel' || child.name === 'Screen_Stand' || child.name.startsWith('Screen_Frame_') || child.name.startsWith('InterferenceBand_') || child.name === 'Screen_Label') {
                    child.position.y += Y_SHIFT_SCREEN;
                }

                // Enhanced PBR Materials: Ensure rich lighting, reflection, and visible contrast
                if (child.material) {
                    child.material.envMapIntensity = 1.35;
                    child.material.needsUpdate = true;

                    if (child.material.isMeshStandardMaterial) {
                        child.material.roughness = Math.max(0.28, Math.min(0.85, child.material.roughness));
                        child.material.metalness = Math.min(0.65, child.material.metalness);

                        if (child.material.color) {
                            const hsl = {};
                            child.material.color.getHSL(hsl);
                            if (hsl.l < 0.12) {
                                child.material.color.setHSL(hsl.h, hsl.s, Math.max(0.18, hsl.l * 2.2));
                            }
                        }
                    }
                }

                // 2. INTERACTIVE BUTTONS & APPARATUS NODES
                if (child.name === 'BTN_EMITTER') {
                    buttonNodes.emitter = child;
                    buttonAnimState.emitter.baseY = child.position.y;
                    child.userData = { action: 'toggle-emitter', label: 'Emitter Power (Space)' };
                    interactiveObjects.push(child);
                } else if (child.name === 'BTN_DETECTOR') {
                    buttonNodes.detector = child;
                    buttonAnimState.detector.baseY = child.position.y;
                    child.userData = { action: 'toggle-detector', label: 'Which-Way Detector (D)' };
                    interactiveObjects.push(child);
                } else if (child.name === 'BTN_RESET') {
                    buttonNodes.reset = child;
                    buttonAnimState.reset.baseY = child.position.y;
                    child.userData = { action: 'reset-screen', label: 'Clear Screen Data (R)' };
                    interactiveObjects.push(child);
                } else if (child.name === 'Emitter_Switch') {
                    buttonNodes.switch = child;
                    child.userData = { action: 'toggle-emitter', label: 'Emitter Switch' };
                    interactiveObjects.push(child);
                } else if (child.name === 'Screen_Panel') {
                    // Dynamic phosphor canvas texture
                    child.material = screenMaterial;
                    child.castShadow = false;
                    child.position.x = SCREEN_X;
                } else if (child.name === 'Screen_Stand') {
                    child.position.x = SCREEN_X;
                } else if (child.name.startsWith('Screen_Frame_')) {
                    // Outer framing flush with screen panel front edge
                    child.position.x = 5.16 + dx;
                } else if (child.name === 'Screen_Label') {
                    child.position.x = 4.95 + dx;
                } else if (child.name === 'Detector_Status') {
                    buttonNodes.detectorStatus = child;
                    child.material = new THREE.MeshStandardMaterial({
                        color: 0x333333,
                        emissive: 0x220011,
                        roughness: 0.2
                    });
                } else if (child.name === 'QuantumBeam_Main') {
                    buttonNodes.beam = child;
                    child.material = new THREE.MeshBasicMaterial({
                        color: 0x00ff88,
                        transparent: true,
                        opacity: 0.5,
                        blending: THREE.AdditiveBlending
                    });
                    // Perfectly position & scale laser cylinder from Emitter aperture (-3.12m) to Phosphor Screen Face (SCREEN_FACE_X)
                    const beamLength = SCREEN_FACE_X - (-3.12);
                    child.position.set((-3.12 + SCREEN_FACE_X) / 2, OPTICAL_AXIS_Y, 0);
                    child.scale.set(1, beamLength / 8.44, 1);
                } else if (child.name.startsWith('SlitGlow_')) {
                    buttonNodes.slitGlows.push(child);
                    child.material = new THREE.MeshBasicMaterial({
                        color: 0x00ff88,
                        transparent: true,
                        opacity: 0.8,
                        blending: THREE.AdditiveBlending
                    });
                } else if (child.name.startsWith('InterferenceBand_')) {
                    // Rectangular pattern bands positioned flush 2mm in front of screen canvas
                    buttonNodes.bands.push(child);
                    child.material = new THREE.MeshBasicMaterial({
                        color: 0x00ff88,
                        transparent: true,
                        opacity: 0.75,
                        blending: THREE.AdditiveBlending,
                        depthWrite: false
                    });
                    child.position.x = SCREEN_FACE_X - 0.002;
                    child.renderOrder = 3;
                    child.visible = true;
                } else if (child.name.startsWith('Electron_') || child.name.startsWith('WavePath_')) {
                    // Hide static blender preview placeholder meshes in favor of our dynamic particle system
                    child.visible = false;
                }
            }
        });

        dismissLoadingScreen();
        updateVisualState();
        console.log('YDSE 3D Physics Lab loaded and initialized successfully!');
    },
    function (progress) {
        if (progress.total > 0) {
            const percent = (progress.loaded / progress.total) * 100;
            const progressBar = document.getElementById('loading-bar');
            if (progressBar) progressBar.style.width = `${percent}%`;
        }
    },
    function (error) {
        console.warn('Asynchronous YDSE GLB notice:', error);
        dismissLoadingScreen();
    }
);

// =============================================================================
// DYNAMIC QUANTUM PARTICLE SYSTEM
// =============================================================================
const MAX_ACTIVE_PARTICLES = 160;
const particlesPool = [];

// Particle Geometry & Materials
const particleGeo = new THREE.SphereGeometry(0.024, 8, 8);
const waveMat = new THREE.MeshBasicMaterial({
    color: 0x00ff88,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending
});
const observedMat = new THREE.MeshBasicMaterial({
    color: 0xff2d87,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending
});

for (let i = 0; i < MAX_ACTIVE_PARTICLES; i++) {
    const mesh = new THREE.Mesh(particleGeo, waveMat);
    mesh.visible = false;
    particleGroup.add(mesh);

    particlesPool.push({
        mesh: mesh,
        active: false,
        progress: 0,
        speed: 0.015 + Math.random() * 0.008,
        chosenSlit: 0, // -1 or +1 (for observed mode)
        targetNormZ: 0,
        targetNormY: 0,
        startY: OPTICAL_AXIS_Y,
        startZ: 0,
        trail: []
    });
}

// Quantum Probability Distribution Sampling
function sampleQuantumImpact(detectorActive, wavelength, slitDist) {
    const d = slitDist; // slit separation
    const lambda = (wavelength * 1e-9) * 8e5; // scale wavelength for visual screen mapping
    const D = 6.6; // distance to screen
    const a = 0.06; // slit width

    let normZ = 0;
    let normY = (Math.random() - 0.5) * 0.8; // vertical dispersion

    if (!detectorActive) {
        // Wave Interference Rejection Sampling
        // I(z) = cos^2(pi * d * z / (lambda * D)) * sinc^2(pi * a * z / (lambda * D))
        let accepted = false;
        let attempts = 0;
        while (!accepted && attempts < 100) {
            attempts++;
            const testZ = (Math.random() * 2 - 1) * 1.4; // z in [-1.4, 1.4]
            const phase = (Math.PI * d * testZ) / (lambda * D);
            const sincArg = (Math.PI * a * testZ) / (lambda * D);
            const sinc = sincArg === 0 ? 1 : Math.sin(sincArg) / sincArg;
            const prob = Math.cos(phase) * Math.cos(phase) * (sinc * sinc);

            if (Math.random() < prob) {
                normZ = testZ / 1.5;
                accepted = true;
            }
        }
    } else {
        // Detector Active: Classical Double Gaussian Clumps
        const slitChoice = Math.random() < 0.5 ? -1 : 1;
        const center = slitChoice * (d * 1.5);
        const sigma = 0.22; // spread per slit
        // Box-Muller normal distribution
        const u1 = Math.max(1e-6, Math.random());
        const u2 = Math.random();
        const randStd = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
        normZ = (center + randStd * sigma) / 1.5;
    }

    normZ = Math.max(-0.95, Math.min(0.95, normZ));
    normY = Math.max(-0.85, Math.min(0.85, normY));

    return { normZ, normY };
}

let lastSpawnTime = 0;

function spawnParticle() {
    if (!state.emitterActive) return;

    const p = particlesPool.find(item => !item.active);
    if (!p) return;

    const impact = sampleQuantumImpact(state.detectorActive, state.wavelength, state.slitSeparation);
    p.active = true;
    p.progress = 0;
    p.speed = (0.012 + Math.random() * 0.006) * (state.beamMode === 'single' ? 0.7 : 1.0);
    p.targetNormZ = impact.normZ;
    p.targetNormY = impact.normY;
    p.chosenSlit = impact.normZ < 0 ? -1 : 1;
    p.mesh.material = state.detectorActive ? observedMat : waveMat;
    p.mesh.visible = true;

    // Emitter Aperture Position: x = -3.12, y = OPTICAL_AXIS_Y, z = 0
    p.mesh.position.set(-3.12, OPTICAL_AXIS_Y, 0);
}

function updateParticles(delta) {
    const spawnInterval = 1000 / state.emissionRate;
    const now = performance.now();

    if (state.emitterActive && now - lastSpawnTime > spawnInterval) {
        spawnParticle();
        lastSpawnTime = now;
    }

    // Update active particles along 3-stage path:
    // Stage 1: Emitter (x = -3.12) -> Slit Barrier (x = 0)
    // Stage 2: Slit Barrier (x = 0) -> Screen Face (x = SCREEN_FACE_X)
    for (let i = 0; i < particlesPool.length; i++) {
        const p = particlesPool[i];
        if (!p.active) continue;

        p.progress += p.speed * (delta * 60);

        if (p.progress >= 1.0) {
            // Impact Screen precisely on the canvas face
            recordScreenHit(p.targetNormZ, p.targetNormY);
            p.active = false;
            p.mesh.visible = false;
            updateHUDStats();
            continue;
        }

        let posX, posY, posZ;
        const xEmitter = -3.12;
        const xSlits = 0.0;
        const xScreen = SCREEN_FACE_X;

        if (p.progress < 0.35) {
            // Stage 1: Heading toward slits directly along optical axis
            const t = p.progress / 0.35;
            posX = THREE.MathUtils.lerp(xEmitter, xSlits, t);
            posY = OPTICAL_AXIS_Y + Math.sin(t * Math.PI) * 0.02;
            posZ = (Math.random() - 0.5) * 0.04;
        } else {
            // Stage 2: Passing through slits and traveling to screen face
            const t = (p.progress - 0.35) / 0.65;
            posX = THREE.MathUtils.lerp(xSlits, xScreen, t);

            const targetWorldZ = p.targetNormZ * 1.35;
            const targetWorldY = OPTICAL_AXIS_Y + p.targetNormY * 1.0;

            if (!state.detectorActive) {
                // Wave mode: quantum sinusoidal probability oscillation
                const waveSpread = Math.sin(t * Math.PI * 4.0) * (1 - t) * 0.08;
                posZ = THREE.MathUtils.lerp(0, targetWorldZ, t) + waveSpread;
            } else {
                // Observed mode: particle passes localized through chosen slit
                const slitZ = p.chosenSlit * 0.14;
                if (t < 0.2) {
                    posZ = THREE.MathUtils.lerp(slitZ, slitZ, t / 0.2);
                } else {
                    posZ = THREE.MathUtils.lerp(slitZ, targetWorldZ, (t - 0.2) / 0.8);
                }
            }
            posY = THREE.MathUtils.lerp(OPTICAL_AXIS_Y, targetWorldY, t);
        }

        p.mesh.position.set(posX, posY, posZ);
    }
}

// =============================================================================
// VISUAL STATE UPDATER
// =============================================================================
function updateVisualState() {
    // Wavelength Color Map
    const colorHex = wavelengthToHex(state.wavelength);

    if (buttonNodes.beam) {
        buttonNodes.beam.visible = state.emitterActive;
        buttonNodes.beam.material.color.set(state.detectorActive ? 0xff2d87 : colorHex);
        buttonNodes.beam.material.opacity = state.emitterActive ? 0.45 : 0;
    }

    buttonNodes.slitGlows.forEach(glow => {
        glow.visible = state.emitterActive;
        glow.material.color.set(state.detectorActive ? 0xff2d87 : colorHex);
    });

    // Rectangular Interference Bands on 3D Screen Frame
    buttonNodes.bands.forEach(band => {
        band.visible = !state.detectorActive && state.emitterActive;
        band.material.color.set(colorHex);
    });

    if (screenMaterial) {
        screenMaterial.emissive.set(state.detectorActive ? 0x2b0515 : (state.emitterActive ? 0x003318 : 0x000000));
        screenMaterial.emissiveIntensity = state.emitterActive ? 0.95 : 0.05;
    }
    updateScreenTexture();

    // Dynamic Lights
    emitterLight.intensity = state.emitterActive ? 2.8 : 0;
    emitterLight.color.set(colorHex);

    detectorLight.intensity = state.detectorActive ? 3.5 : 0;
    if (buttonNodes.detectorStatus) {
        buttonNodes.detectorStatus.material.emissive.set(state.detectorActive ? 0xff0044 : 0x110005);
        buttonNodes.detectorStatus.material.color.set(state.detectorActive ? 0xff2d87 : 0x222222);
    }

    // UI Buttons and Indicators
    const btnEmitter = document.getElementById('ui-btn-emitter');
    const statusEmitter = document.getElementById('ui-status-emitter');
    if (btnEmitter) {
        if (state.emitterActive) {
            btnEmitter.classList.add('active');
            if (statusEmitter) statusEmitter.textContent = 'ACTIVE';
        } else {
            btnEmitter.classList.remove('active');
            if (statusEmitter) statusEmitter.textContent = 'OFF';
        }
    }

    const btnDetector = document.getElementById('ui-btn-detector');
    const statusDetector = document.getElementById('ui-status-detector');
    const valDetectorStatus = document.getElementById('val-detector-status');
    const statQuantumState = document.getElementById('val-quantum-state');

    if (btnDetector) {
        if (state.detectorActive) {
            btnDetector.classList.add('active');
            if (statusDetector) statusDetector.textContent = 'ACTIVE (Particle)';
            if (valDetectorStatus) {
                valDetectorStatus.textContent = 'ACTIVE (Observed)';
                valDetectorStatus.className = 'stat-value font-mono text-active';
            }
            if (statQuantumState) {
                statQuantumState.textContent = 'WAVEFUNCTION COLLAPSED (Particle)';
                statQuantumState.className = 'stat-value state-particle';
            }
        } else {
            btnDetector.classList.remove('active');
            if (statusDetector) statusDetector.textContent = 'OFF (Wave)';
            if (valDetectorStatus) {
                valDetectorStatus.textContent = 'OFF (Unobserved)';
                valDetectorStatus.className = 'stat-value font-mono text-inactive';
            }
            if (statQuantumState) {
                statQuantumState.textContent = 'WAVE SUPERPOSITION (Interference)';
                statQuantumState.className = 'stat-value state-wave';
            }
        }
    }

    // Calculate Theoretical Fringe Width: beta = lambda * D / d
    const fringeWidthMm = ((state.wavelength * 1e-9 * state.screenDistance) / (state.slitSeparation * 1e-3)) * 1000;
    const fringeWidthEl = document.getElementById('val-fringe-width');
    if (fringeWidthEl) fringeWidthEl.textContent = fringeWidthMm.toFixed(2);

    const fringeWidthTop = document.getElementById('val-fringe-width-top');
    if (fringeWidthTop) fringeWidthTop.textContent = `${fringeWidthMm.toFixed(2)} mm`;

    updateIntensityGraph();
    updateVRMenuTexture();
}

function updateHUDStats() {
    const hitEl = document.getElementById('val-hit-count');
    if (hitEl) hitEl.textContent = state.totalHits.toLocaleString();
}

// =============================================================================
// 2D REAL-TIME INTENSITY GRAPH & OPTICAL PATTERN PLOTTER
// =============================================================================
const graphCanvas = document.getElementById('intensity-canvas');
const graphCtx = graphCanvas ? graphCanvas.getContext('2d') : null;
const fringeScreenCanvas = document.getElementById('fringe-screen-canvas');
const fringeScreenCtx = fringeScreenCanvas ? fringeScreenCanvas.getContext('2d') : null;

function updateIntensityGraph() {
    // 1. Draw Optical Interference Pattern Strip (Laser Screen Projection)
    if (fringeScreenCanvas && fringeScreenCtx) {
        renderOpticalFringePattern(fringeScreenCanvas, fringeScreenCtx, {
            wavelength: state.wavelength,
            slitSeparation: state.slitSeparation,
            slitWidth: state.slitWidth,
            screenDistance: state.screenDistance,
            detectorActive: state.detectorActive,
            emitterActive: state.emitterActive
        });

        // Update color indicator dot and wavelength label
        const dot = document.getElementById('fringe-color-dot');
        const label = document.getElementById('fringe-wavelength-label');
        const rgb = state.detectorActive ? { r: 255, g: 45, b: 135 } : wavelengthToRGB(state.wavelength);
        if (dot) {
            dot.style.backgroundColor = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
            dot.style.boxShadow = `0 0 10px rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
        }
        if (label) {
            label.textContent = state.detectorActive ? 'OBSERVED (Particle)' : `${state.wavelength} nm`;
        }
    }

    if (!graphCtx || !graphCanvas) return;
    const w = graphCanvas.width;
    const h = graphCanvas.height;

    graphCtx.fillStyle = '#040810';
    graphCtx.fillRect(0, 0, w, h);

    // Center Axis & Grid Lines
    graphCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    graphCtx.lineWidth = 1;
    graphCtx.beginPath();
    graphCtx.moveTo(w / 2, 0);
    graphCtx.lineTo(w / 2, h);
    graphCtx.moveTo(0, h - 20);
    graphCtx.lineTo(w, h - 20);
    graphCtx.stroke();

    // 1. Draw Measured Hits Histogram Bars
    const binCount = state.histogramBins;
    const barW = w / binCount;
    const maxVal = Math.max(state.maxHistCount, 10);

    const rgb = state.detectorActive ? { r: 255, g: 45, b: 135 } : wavelengthToRGB(state.wavelength);
    graphCtx.fillStyle = state.detectorActive ? 'rgba(255, 45, 135, 0.65)' : `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.65)`;
    for (let i = 0; i < binCount; i++) {
        const count = state.hitHistogram[i];
        if (count > 0) {
            const barH = (count / maxVal) * (h - 40);
            graphCtx.fillRect(i * barW, h - 20 - barH, barW + 0.5, barH);
        }
    }

    // 2. Draw Theoretical Quantum Curve
    graphCtx.beginPath();
    graphCtx.strokeStyle = state.detectorActive ? '#ff2d87' : `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    graphCtx.lineWidth = 2.5;

    const d = state.slitSeparation;
    const lambda = (state.wavelength * 1e-9) * 8e5;
    const D = 6.6;
    const a = 0.06;

    for (let x = 0; x < w; x++) {
        const normZ = ((x / w) * 2 - 1) * 1.5;
        let yProb = 0;

        if (!state.detectorActive) {
            const phase = (Math.PI * d * normZ) / (lambda * D);
            const sincArg = (Math.PI * a * normZ) / (lambda * D);
            const sinc = sincArg === 0 ? 1 : Math.sin(sincArg) / sincArg;
            yProb = Math.cos(phase) * Math.cos(phase) * (sinc * sinc);
        } else {
            const center1 = -(d * 1.5);
            const center2 = (d * 1.5);
            const sigma = 0.22;
            const g1 = Math.exp(-Math.pow(normZ - center1, 2) / (2 * sigma * sigma));
            const g2 = Math.exp(-Math.pow(normZ - center2, 2) / (2 * sigma * sigma));
            yProb = (g1 + g2) * 0.5;
        }

        const plotY = (h - 22) - yProb * (h - 45);
        if (x === 0) graphCtx.moveTo(x, plotY);
        else graphCtx.lineTo(x, plotY);
    }
    graphCtx.stroke();
}

// =============================================================================
// OBSERVATION STATIONS & TELEPORTATION SYSTEM
// =============================================================================
const S = LAB_SCALE;
const teleportStations = {
    overview: {
        id: 'overview',
        name: 'Lab Overview',
        vrPos: new THREE.Vector3(0.7, 0, 2.8),
        camPos: new THREE.Vector3(0.7, 1.75, 3.65),
        target: new THREE.Vector3(0.7, OPTICAL_AXIS_Y * S, 0)
    },
    console: {
        id: 'console',
        name: 'Control Desk',
        vrPos: new THREE.Vector3(-1.05, 0, 2.1),
        camPos: new THREE.Vector3(-1.05, 1.47, 2.1),
        target: new THREE.Vector3(-1.05, 1.25, 1.61)
    },
    emitter: {
        id: 'emitter',
        name: 'Quantum Emitter',
        vrPos: new THREE.Vector3(-2.24, 0, 1.05),
        camPos: new THREE.Vector3(-2.24, 1.6, 1.4),
        target: new THREE.Vector3(-2.55, OPTICAL_AXIS_Y * S, 0)
    },
    beamline: {
        id: 'beamline',
        name: 'Beamline POV',
        vrPos: new THREE.Vector3(-3.36, 0, 0.7),
        camPos: new THREE.Vector3(-3.5, OPTICAL_AXIS_Y * S, 0),
        target: new THREE.Vector3(SCREEN_X * S, OPTICAL_AXIS_Y * S, 0)
    },
    slits: {
        id: 'slits',
        name: 'Double Slits',
        vrPos: new THREE.Vector3(0, 0, 0.95),
        camPos: new THREE.Vector3(0.15, 1.6, 1.15),
        target: new THREE.Vector3(0, OPTICAL_AXIS_Y * S, 0)
    },
    detector: {
        id: 'detector',
        name: 'Which-Way Detector',
        vrPos: new THREE.Vector3(1.96, 0, 1.05),
        camPos: new THREE.Vector3(1.65, 1.6, 1.25),
        target: new THREE.Vector3(2.1, OPTICAL_AXIS_Y * S, 0)
    },
    screen: {
        id: 'screen',
        name: 'Phosphor Screen',
        vrPos: new THREE.Vector3((SCREEN_X - 1.2) * S, 0, 1.4),
        camPos: new THREE.Vector3((SCREEN_X - 1.6) * S, 1.6, 1.7),
        target: new THREE.Vector3(SCREEN_X * S, OPTICAL_AXIS_Y * S, 0)
    },
    screen_front: {
        id: 'screen_front',
        name: 'Target Frontal',
        vrPos: new THREE.Vector3((SCREEN_X - 1.4) * S, 0, 0),
        camPos: new THREE.Vector3((SCREEN_X - 1.6) * S, OPTICAL_AXIS_Y * S, 0),
        target: new THREE.Vector3(SCREEN_X * S, OPTICAL_AXIS_Y * S, 0)
    },
    chalkboard: {
        id: 'chalkboard',
        name: 'Theory Blackboard',
        vrPos: new THREE.Vector3(0, 0, -2.4),
        camPos: new THREE.Vector3(0, 1.7, -1.8),
        target: new THREE.Vector3(0, 2.45, -3.71)
    },
    rear: {
        id: 'rear',
        name: 'Rear Lab Angle',
        vrPos: new THREE.Vector3(0.56, 0, -1.82),
        camPos: new THREE.Vector3(0.56, 1.75, -2.5),
        target: new THREE.Vector3(0.56, OPTICAL_AXIS_Y * S, 0.35)
    },
    storage: {
        id: 'storage',
        name: 'Equipment Corner',
        vrPos: new THREE.Vector3(3.36, 0, 2.8),
        camPos: new THREE.Vector3(3.64, 1.75, 3.0),
        target: new THREE.Vector3(1.05, OPTICAL_AXIS_Y * S, 0.35)
    },
    aerial: {
        id: 'aerial',
        name: 'Balcony Overview',
        vrPos: new THREE.Vector3(0.7, 0, 3.5),
        camPos: new THREE.Vector3(1.4, 3.0, 4.0),
        target: new THREE.Vector3(0.56, OPTICAL_AXIS_Y * S * 0.9, 0)
    }
};

// =============================================================================
// HOLOGRAPHIC TELEPORTATION PADS (GLOWING GROUND CIRCLES ONLY)
// =============================================================================
const teleportPadsGroup = new THREE.Group();
scene.add(teleportPadsGroup);
const animatedPads = [];

function createTeleportPads() {
    Object.values(teleportStations).forEach(station => {
        const padGroup = new THREE.Group();
        padGroup.position.copy(station.vrPos);

        // 1. Floor Outer Glowing Ring
        const outerRingGeo = new THREE.RingGeometry(0.38, 0.46, 32);
        outerRingGeo.rotateX(-Math.PI / 2);
        const outerRingMat = new THREE.MeshBasicMaterial({
            color: 0x00f0ff,
            transparent: true,
            opacity: 0.75,
            side: THREE.DoubleSide
        });
        const outerRingMesh = new THREE.Mesh(outerRingGeo, outerRingMat);
        outerRingMesh.position.y = 0.015;
        padGroup.add(outerRingMesh);

        // 2. Floor Middle Accent Ring
        const midRingGeo = new THREE.RingGeometry(0.24, 0.27, 32);
        midRingGeo.rotateX(-Math.PI / 2);
        const midRingMat = new THREE.MeshBasicMaterial({
            color: 0x00f0ff,
            transparent: true,
            opacity: 0.55,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        });
        const midRingMesh = new THREE.Mesh(midRingGeo, midRingMat);
        midRingMesh.position.y = 0.018;
        padGroup.add(midRingMesh);

        // 3. Floor Inner Glowing Disc
        const discGeo = new THREE.CircleGeometry(0.22, 32);
        discGeo.rotateX(-Math.PI / 2);
        const discMat = new THREE.MeshBasicMaterial({
            color: 0x00f0ff,
            transparent: true,
            opacity: 0.35,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        });
        const discMesh = new THREE.Mesh(discGeo, discMat);
        discMesh.position.y = 0.02;
        padGroup.add(discMesh);

        // Raycasting & Interaction Data
        outerRingMesh.userData = {
            action: `teleport-${station.id}`,
            label: `⚡ Teleport: ${station.name}`
        };
        midRingMesh.userData = outerRingMesh.userData;
        discMesh.userData = outerRingMesh.userData;

        interactiveObjects.push(outerRingMesh);
        interactiveObjects.push(midRingMesh);
        interactiveObjects.push(discMesh);

        teleportPadsGroup.add(padGroup);
        animatedPads.push({
            outerRing: outerRingMesh,
            midRing: midRingMesh,
            disc: discMesh
        });
    });
}
createTeleportPads();

// =============================================================================
// TELEPORTATION & CAMERA NAVIGATION CONTROLLER
// =============================================================================
let isCameraTransitioning = false;
let camStartPos = new THREE.Vector3();
let camEndPos = new THREE.Vector3();
let camStartTarget = new THREE.Vector3();
let camEndTarget = new THREE.Vector3();
let camTransitionProgress = 0;

function teleportToStation(stationId) {
    const station = teleportStations[stationId];
    if (!station) return;

    state.activeView = stationId;
    audio.playTeleportSound();

    if (renderer.xr.isPresenting) {
        // VR Teleportation: smoothly position user rig
        xrRig.position.set(station.vrPos.x, state.userHeightOffset, station.vrPos.z);
        const lookDir = new THREE.Vector3().subVectors(station.target, station.vrPos);
        xrRig.rotation.y = Math.atan2(-lookDir.x, -lookDir.z);

        // Keep VR menu in front of user upon teleport
        if (vrMenuRoot && vrMenuRoot.visible) {
            repositionVRMenuInFrontOfUser();
        }
    } else {
        // Desktop / Mobile Camera Transition
        camStartPos.copy(camera.position);
        camEndPos.copy(station.camPos);

        camStartTarget.copy(controls.target);
        camEndTarget.copy(station.target);

        camTransitionProgress = 0;
        isCameraTransitioning = true;
    }

    // Update active UI view button in HUD
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === stationId);
    });
}

function switchCameraView(viewName) {
    teleportToStation(viewName);
}

function updateCameraTransition(delta) {
    if (!isCameraTransitioning) return;
    camTransitionProgress += delta * 2.2;

    if (camTransitionProgress >= 1.0) {
        camera.position.copy(camEndPos);
        controls.target.copy(camEndTarget);
        controls.update();
        isCameraTransitioning = false;
    } else {
        const ease = t => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t);
        const t = ease(camTransitionProgress);
        camera.position.lerpVectors(camStartPos, camEndPos, t);
        controls.target.lerpVectors(camStartTarget, camEndTarget, t);
        controls.update();
    }
}

// Update Glowing Ground Circles in Loop
function updateTeleportPads(delta, elapsedTime) {
    animatedPads.forEach((pad, idx) => {
        pad.outerRing.rotation.z += delta * 0.35;
        pad.midRing.rotation.z -= delta * 0.5;
        const pulse = 0.28 + Math.sin(elapsedTime * 2.8 + idx) * 0.14;
        pad.disc.material.opacity = pulse;
        pad.outerRing.material.opacity = 0.55 + Math.sin(elapsedTime * 2.0 + idx) * 0.2;
    });
}// =============================================================================
// IN-VR DIEGETIC 3D QUANTUM PALM BOOK (EXPERIMENT CONTROLLER GRIMOIRE)
// =============================================================================
let palmBookRoot = null;
let bookPivot = null;
let leftPageCanvas = null;
let leftPageCtx = null;
let leftPageTexture = null;
let rightPageCanvas = null;
let rightPageCtx = null;
let rightPageTexture = null;

// Page Button 3D Meshes & Textures (3-4 per page)
const pageButtonMeshes = [];
const pageButtonCanvases = [];
const pageButtonContexts = [];
const pageButtonTextures = [];

// Navigation Footer 3D Meshes
let prevBtnMesh = null;
let nextBtnMesh = null;
let pinBtnMesh = null;

// Page Flip Dynamic Mesh & Animation
let flippingHinge = null;
let flippingPageMesh = null;
let flippingFrontCanvas = null;
let flippingFrontCtx = null;
let flippingFrontTexture = null;
let flippingBackCanvas = null;
let flippingBackCtx = null;
let flippingBackTexture = null;

let currentPageIndex = 0;
let isFlippingPage = false;
let flipDirection = 1; // 1 for next (R to L), -1 for prev (L to R)
let flipProgress = 0;
const FLIP_DURATION = 0.44; // seconds for natural page flip physics

// Interaction State
let isBookPinned = false;
let isDesktopBookOpen = false;
let bookScale = 0.0;
let targetBookScale = 0.0;
let bookWorldPos = new THREE.Vector3();
let bookWorldQuat = new THREE.Quaternion();
let directTouchCooldown = 0;
let pokeCursorMesh = null;
let lastPokeLocalX = null;

// Multi-Theme High-Contrast Color Palettes for Grimoire / Palm Book
const bookThemes = {
    obsidian: {
        id: 'obsidian',
        name: 'OBSIDIAN CYBER',
        pageBg: '#060d1b',
        pageBorder: '#d4af37',
        pageInnerBorder: 'rgba(0, 240, 255, 0.45)',
        headerBg: '#0c1527',
        headerBorder: '#d4af37',
        headerText: '#fbbf24',
        cardBg: '#0c1424',
        cardBorder: 'rgba(0, 240, 255, 0.35)',
        labelColor: '#f1f5f9',
        valColor: '#fbbf24',
        valColorAlt: '#38bdf8',
        btnBg: '#0c1628',
        btnText: '#ffffff',
        accent: '#00f0ff',
        coverColor: 0x070b14,
        goldTrim: 0xf59e0b
    },
    parchment: {
        id: 'parchment',
        name: 'ROYAL PARCHMENT',
        pageBg: '#faf3e3',
        pageBorder: '#854d0e',
        pageInnerBorder: 'rgba(180, 83, 9, 0.45)',
        headerBg: '#f0e3c5',
        headerBorder: '#854d0e',
        headerText: '#78350f',
        cardBg: '#1e293b',
        cardBorder: '#854d0e',
        labelColor: '#f8fafc',
        valColor: '#fbbf24',
        valColorAlt: '#38bdf8',
        btnBg: '#18243b',
        btnText: '#ffffff',
        accent: '#b45309',
        coverColor: 0x2b1408,
        goldTrim: 0xd97706
    },
    tactical: {
        id: 'tactical',
        name: 'TACTICAL MATRIX',
        pageBg: '#010804',
        pageBorder: '#00ff88',
        pageInnerBorder: 'rgba(0, 255, 136, 0.45)',
        headerBg: '#04170d',
        headerBorder: '#00ff88',
        headerText: '#00ff88',
        cardBg: '#05180f',
        cardBorder: '#00ff88',
        labelColor: '#dcfce7',
        valColor: '#facc15',
        valColorAlt: '#00ff88',
        btnBg: '#061c10',
        btnText: '#ffffff',
        accent: '#00ff88',
        coverColor: 0x020f08,
        goldTrim: 0x00ff88
    }
};

let currentBookTheme = 'obsidian';
let coverMatRef = null;
let goldTrimMatRef = null;

// Legacy backward-compatibility alias
let vrMenuRoot = null;

// Multi-Page Book Contents (3-4 controls per page from original board)
const bookPages = [
    {
        chapter: 'CHAPTER 1: CORE SIMULATION',
        subtitle: 'Primary Quantum Beam Operations',
        controls: [
            {
                id: 'toggle-emitter',
                getLabel: () => (state.emitterActive ? '⚡ LASER EMITTER: ON' : '⚡ LASER EMITTER: OFF'),
                getColor: () => (state.emitterActive ? '#00f0ff' : '#64748b'),
                getBg: () => (state.emitterActive ? 'rgba(0, 240, 255, 0.28)' : 'rgba(30, 41, 59, 0.5)'),
                icon: '⚡'
            },
            {
                id: 'toggle-detector',
                getLabel: () => (state.detectorActive ? '👁️ DETECTOR: ON (COLLAPSE)' : '👁️ DETECTOR: OFF (WAVE)'),
                getColor: () => (state.detectorActive ? '#ff2d87' : '#64748b'),
                getBg: () => (state.detectorActive ? 'rgba(255, 45, 135, 0.28)' : 'rgba(30, 41, 59, 0.5)'),
                icon: '👁️'
            },
            {
                id: 'reset-screen',
                getLabel: () => '🔄 CLEAR DETECTOR SCREEN',
                getColor: () => '#ffb703',
                getBg: () => 'rgba(255, 183, 3, 0.25)',
                icon: '🔄'
            },
            {
                id: 'toggle-beam-mode',
                getLabel: () => (state.beamMode === 'stream' ? '🌊 BEAM MODE: CONTINUOUS' : '🎯 BEAM MODE: SINGLE PARTICLE'),
                getColor: () => '#00ff88',
                getBg: () => 'rgba(0, 255, 136, 0.25)',
                icon: '🌊'
            }
        ]
    },
    {
        chapter: 'CHAPTER 2: PORTALS & SUITES',
        subtitle: 'Facility Teleportation & Theory',
        controls: [
            {
                id: 'exit-vr-to-hub',
                getLabel: () => '🏠 RETURN TO MAIN HUB',
                getColor: () => '#00f0ff',
                getBg: () => 'rgba(0, 240, 255, 0.25)',
                icon: '🏠'
            },
            {
                id: 'exit-vr-to-catalog',
                getLabel: () => '🔬 EXPERIMENTS CATALOG',
                getColor: () => '#a855f7',
                getBg: () => 'rgba(168, 85, 247, 0.25)',
                icon: '🔬'
            },
            {
                id: 'exit-vr-to-theory',
                getLabel: () => '📚 QUANTUM THEORY SUITE',
                getColor: () => '#ff2d87',
                getBg: () => 'rgba(255, 45, 135, 0.25)',
                icon: '📚'
            },
            {
                id: 'teleport-overview',
                getLabel: () => '🔭 LABORATORY OVERVIEW',
                getColor: () => '#38bdf8',
                getBg: () => 'rgba(56, 189, 248, 0.25)',
                icon: '🔭'
            }
        ]
    },
    {
        chapter: 'CHAPTER 3: APPARATUS STATIONS',
        subtitle: 'Precision Optical Bench Focus',
        controls: [
            {
                id: 'teleport-emitter',
                getLabel: () => '⚡ STATION: LASER EMITTER',
                getColor: () => '#00f0ff',
                getBg: () => 'rgba(0, 240, 255, 0.22)',
                icon: '⚡'
            },
            {
                id: 'teleport-slits',
                getLabel: () => '🚪 STATION: DOUBLE SLITS',
                getColor: () => '#00f0ff',
                getBg: () => 'rgba(0, 240, 255, 0.22)',
                icon: '🚪'
            },
            {
                id: 'teleport-detector',
                getLabel: () => '👁️ STATION: DETECTOR ARRAY',
                getColor: () => '#ff2d87',
                getBg: () => 'rgba(255, 45, 135, 0.22)',
                icon: '👁️'
            },
            {
                id: 'teleport-beamline',
                getLabel: () => '〰️ STATION: BEAMLINE AXIS',
                getColor: () => '#38bdf8',
                getBg: () => 'rgba(56, 189, 248, 0.22)',
                icon: '〰️'
            }
        ]
    },
    {
        chapter: 'CHAPTER 4: TARGET & WORKBENCH',
        subtitle: 'Phosphor Screen & Terminal',
        controls: [
            {
                id: 'teleport-screen',
                getLabel: () => '🎯 STATION: PHOSPHOR SCREEN',
                getColor: () => '#00ff88',
                getBg: () => 'rgba(0, 255, 136, 0.22)',
                icon: '🎯'
            },
            {
                id: 'teleport-screen_front',
                getLabel: () => '🔍 STATION: SCREEN CLOSEUP',
                getColor: () => '#00ff88',
                getBg: () => 'rgba(0, 255, 136, 0.22)',
                icon: '🔍'
            },
            {
                id: 'teleport-console',
                getLabel: () => '🖥️ STATION: WORKSTATION',
                getColor: () => '#00f0ff',
                getBg: () => 'rgba(0, 240, 255, 0.22)',
                icon: '🖥️'
            },
            {
                id: 'teleport-chalkboard',
                getLabel: () => '📝 STATION: CHALKBOARD',
                getColor: () => '#facc15',
                getBg: () => 'rgba(250, 204, 21, 0.22)',
                icon: '📝'
            }
        ]
    },
    {
        chapter: 'CHAPTER 5: FACILITY STATIONS',
        subtitle: 'Surrounding Lab Environment',
        controls: [
            {
                id: 'teleport-storage',
                getLabel: () => '📦 STATION: STORAGE BAY',
                getColor: () => '#94a3b8',
                getBg: () => 'rgba(148, 163, 184, 0.22)',
                icon: '📦'
            },
            {
                id: 'teleport-aerial',
                getLabel: () => '🏙️ STATION: BALCONY VISTA',
                getColor: () => '#38bdf8',
                getBg: () => 'rgba(56, 189, 248, 0.22)',
                icon: '🏙️'
            },
            {
                id: 'teleport-rear',
                getLabel: () => '🚪 STATION: REAR LAB',
                getColor: () => '#94a3b8',
                getBg: () => 'rgba(148, 163, 184, 0.22)',
                icon: '🚪'
            },
            {
                id: 'teleport-overview',
                getLabel: () => '🔭 STATION: CENTRAL HUB',
                getColor: () => '#00f0ff',
                getBg: () => 'rgba(0, 240, 255, 0.22)',
                icon: '🔭'
            }
        ]
    },
    {
        chapter: 'CHAPTER 6: ERGONOMICS & THEME',
        subtitle: 'Display Theme & Height Calibration',
        controls: [
            {
                id: 'toggle-book-theme',
                getLabel: () => `🎨 THEME: ${bookThemes[currentBookTheme].name}`,
                getColor: () => '#a855f7',
                getBg: () => 'rgba(168, 85, 247, 0.25)',
                icon: '🎨'
            },
            {
                id: 'vr-height-up',
                getLabel: () => '▲ RAISE EYE LEVEL (+0.15m)',
                getColor: () => '#00f0ff',
                getBg: () => 'rgba(0, 240, 255, 0.22)',
                icon: '▲'
            },
            {
                id: 'vr-height-down',
                getLabel: () => '▼ LOWER EYE LEVEL (-0.15m)',
                getColor: () => '#00f0ff',
                getBg: () => 'rgba(0, 240, 255, 0.22)',
                icon: '▼'
            },
            {
                id: 'vr-height-reset',
                getLabel: () => `⟲ RESET HEIGHT (${state.userHeightOffset >= 0 ? '+' : ''}${state.userHeightOffset.toFixed(2)}m)`,
                getColor: () => '#94a3b8',
                getBg: () => 'rgba(148, 163, 184, 0.22)',
                icon: '⟲'
            }
        ]
    }
];

function createQuantumPalmBook() {
    palmBookRoot = new THREE.Group();
    palmBookRoot.name = 'Quantum_Palm_Book';
    palmBookRoot.scale.set(0, 0, 0);
    palmBookRoot.visible = false;
    scene.add(palmBookRoot);

    vrMenuRoot = palmBookRoot; // legacy alias

    bookPivot = new THREE.Group();
    palmBookRoot.add(bookPivot);

    // Book Dimensions: Standard handheld codex (Width: 0.32m, Height: 0.22m, Depth: 0.024m)
    const PAGE_W = 0.150;
    const PAGE_H = 0.216;

    // 1. High-Fidelity Cyber-Leather Hardcover & Spine
    const coverMat = new THREE.MeshStandardMaterial({
        color: 0x090f1d,
        roughness: 0.55,
        metalness: 0.7,
        emissive: 0x030812,
        emissiveIntensity: 0.2
    });
    coverMatRef = coverMat;

    const goldTrimMat = new THREE.MeshStandardMaterial({
        color: 0xeab308,
        roughness: 0.35,
        metalness: 0.9,
        emissive: 0x854d0e,
        emissiveIntensity: 0.2
    });
    goldTrimMatRef = goldTrimMat;

    const cyanGlowMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.85
    });

    // Center Spine Cylinder (aligned along the vertical Y-axis at the back of the book)
    const spineGeo = new THREE.CylinderGeometry(0.007, 0.007, PAGE_H + 0.008, 16);
    const spineMesh = new THREE.Mesh(spineGeo, coverMat);
    // Cylinder is already vertical along Y - keep it at the back cover (z = -0.005)
    spineMesh.position.set(0, 0, -0.005);
    bookPivot.add(spineMesh);

    // Spine End Accent Rings (also aligned vertically along Y at the back cover)
    [-0.105, 0.105].forEach(yPos => {
        const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.008, 16), goldTrimMat);
        ring.position.set(0, yPos, -0.005);
        bookPivot.add(ring);
    });

    // Left and Right Cover Boards (Slightly larger than pages with beveled rims)
    const coverGeo = new THREE.BoxGeometry(PAGE_W + 0.008, PAGE_H + 0.012, 0.006);
    const leftCover = new THREE.Mesh(coverGeo, coverMat);
    leftCover.position.set(-(PAGE_W / 2 + 0.006), 0, -0.004);
    bookPivot.add(leftCover);

    const rightCover = new THREE.Mesh(coverGeo, coverMat);
    rightCover.position.set(PAGE_W / 2 + 0.006, 0, -0.004);
    bookPivot.add(rightCover);

    // Gold Corner Brackets for Grimoire Feel
    const cornerOffsets = [
        { x: -(PAGE_W + 0.008), y: PAGE_H / 2 },
        { x: -(PAGE_W + 0.008), y: -PAGE_H / 2 },
        { x: PAGE_W + 0.008, y: PAGE_H / 2 },
        { x: PAGE_W + 0.008, y: -PAGE_H / 2 }
    ];
    cornerOffsets.forEach(pos => {
        const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.022, 0.008), goldTrimMat);
        bracket.position.set(pos.x > 0 ? pos.x - 0.011 : pos.x + 0.011, pos.y > 0 ? pos.y - 0.011 : pos.y + 0.011, -0.004);
        bookPivot.add(bracket);
    });

    // 2. Gilded Edge Paper Blocks (Left and Right)
    const gildedEdgeMat = new THREE.MeshStandardMaterial({
        color: 0xd4af37,
        roughness: 0.6,
        metalness: 0.55
    });

    const pageStackGeo = new THREE.BoxGeometry(PAGE_W, PAGE_H, 0.010);
    const leftStack = new THREE.Mesh(pageStackGeo, gildedEdgeMat);
    leftStack.position.set(-PAGE_W / 2 - 0.003, 0, 0.005);
    bookPivot.add(leftStack);

    const rightStack = new THREE.Mesh(pageStackGeo, gildedEdgeMat);
    rightStack.position.set(PAGE_W / 2 + 0.003, 0, 0.005);
    bookPivot.add(rightStack);

    // 3. Left Page Surface (Illuminated Field Manual & Live Quantum Telemetry)
    leftPageCanvas = document.createElement('canvas');
    leftPageCanvas.width = 1024;
    leftPageCanvas.height = 1400;
    leftPageCtx = leftPageCanvas.getContext('2d');

    leftPageTexture = new THREE.CanvasTexture(leftPageCanvas);
    leftPageTexture.generateMipmaps = true;
    leftPageTexture.minFilter = THREE.LinearMipmapLinearFilter;

    // Use MeshBasicMaterial: Immune to room glare, provides 100% self-luminous contrast
    const pageFaceMatLeft = new THREE.MeshBasicMaterial({
        map: leftPageTexture
    });

    const leftPageMesh = new THREE.Mesh(new THREE.PlaneGeometry(PAGE_W, PAGE_H), pageFaceMatLeft);
    leftPageMesh.position.set(-PAGE_W / 2 - 0.003, 0, 0.0105);
    bookPivot.add(leftPageMesh);

    // Left Page 3D Pin Button
    const pinBtnGeo = new THREE.BoxGeometry(0.134, 0.024, 0.005);
    const pinBtnCanvas = document.createElement('canvas');
    pinBtnCanvas.width = 512;
    pinBtnCanvas.height = 100;
    const pinBtnCtx = pinBtnCanvas.getContext('2d');
    const pinBtnTexture = new THREE.CanvasTexture(pinBtnCanvas);

    const pinBtnMat = new THREE.MeshBasicMaterial({
        map: pinBtnTexture
    });
    pinBtnMesh = new THREE.Mesh(pinBtnGeo, pinBtnMat);
    pinBtnMesh.position.set(-PAGE_W / 2 - 0.003, -0.088, 0.0135);
    pinBtnMesh.userData = {
        action: 'toggle-book-pin',
        label: '📌 Lock Book in Space',
        baseZ: 0.0135,
        currentZ: 0.0135,
        targetZ: 0.0135,
        canvas: pinBtnCanvas,
        ctx: pinBtnCtx,
        texture: pinBtnTexture
    };
    bookPivot.add(pinBtnMesh);
    interactiveObjects.push(pinBtnMesh);

    // 4. Right Page Surface (Active Chapter Background & Dynamic 3D Controls)
    rightPageCanvas = document.createElement('canvas');
    rightPageCanvas.width = 1024;
    rightPageCanvas.height = 1400;
    rightPageCtx = rightPageCanvas.getContext('2d');

    rightPageTexture = new THREE.CanvasTexture(rightPageCanvas);
    rightPageTexture.generateMipmaps = true;
    rightPageTexture.minFilter = THREE.LinearMipmapLinearFilter;

    const pageFaceMatRight = new THREE.MeshBasicMaterial({
        map: rightPageTexture
    });

    const rightPageMesh = new THREE.Mesh(new THREE.PlaneGeometry(PAGE_W, PAGE_H), pageFaceMatRight);
    rightPageMesh.position.set(PAGE_W / 2 + 0.003, 0, 0.0105);
    bookPivot.add(rightPageMesh);

    // 4 Tactile 3D Buttons on Right Page
    const btnBoxGeo = new THREE.BoxGeometry(0.134, 0.033, 0.006);
    const btnYPositions = [0.058, 0.018, -0.022, -0.062];

    for (let i = 0; i < 4; i++) {
        const btnCanvas = document.createElement('canvas');
        btnCanvas.width = 512;
        btnCanvas.height = 120;
        const btnCtx = btnCanvas.getContext('2d');
        const btnTex = new THREE.CanvasTexture(btnCanvas);
        btnTex.generateMipmaps = true;

        const btnMat = new THREE.MeshBasicMaterial({
            map: btnTex
        });

        const btnMesh = new THREE.Mesh(btnBoxGeo, btnMat);
        btnMesh.position.set(PAGE_W / 2 + 0.003, btnYPositions[i], 0.014);
        btnMesh.userData = {
            index: i,
            action: null,
            label: '',
            baseZ: 0.014,
            currentZ: 0.014,
            targetZ: 0.014,
            canvas: btnCanvas,
            ctx: btnCtx,
            texture: btnTex
        };

        bookPivot.add(btnMesh);
        pageButtonMeshes.push(btnMesh);
        pageButtonCanvases.push(btnCanvas);
        pageButtonContexts.push(btnCtx);
        pageButtonTextures.push(btnTex);
        interactiveObjects.push(btnMesh);
    }

    // 5. Navigation Footer 3D Buttons (Prev Page & Next Page)
    const navBtnGeo = new THREE.BoxGeometry(0.058, 0.024, 0.005);

    // Prev Button
    const prevCanvas = document.createElement('canvas');
    prevCanvas.width = 256;
    prevCanvas.height = 100;
    const prevCtx = prevCanvas.getContext('2d');
    const prevTex = new THREE.CanvasTexture(prevCanvas);
    const prevMat = new THREE.MeshBasicMaterial({
        map: prevTex
    });
    prevBtnMesh = new THREE.Mesh(navBtnGeo, prevMat);
    prevBtnMesh.position.set(PAGE_W / 2 - 0.038, -0.088, 0.0135);
    prevBtnMesh.userData = {
        action: 'book-prev-page',
        label: '◀ Previous Page',
        baseZ: 0.0135,
        currentZ: 0.0135,
        targetZ: 0.0135,
        canvas: prevCanvas,
        ctx: prevCtx,
        texture: prevTex
    };
    bookPivot.add(prevBtnMesh);
    interactiveObjects.push(prevBtnMesh);

    // Next Button
    const nextCanvas = document.createElement('canvas');
    nextCanvas.width = 256;
    nextCanvas.height = 100;
    const nextCtx = nextCanvas.getContext('2d');
    const nextTex = new THREE.CanvasTexture(nextCanvas);
    const nextMat = new THREE.MeshBasicMaterial({
        map: nextTex
    });
    nextBtnMesh = new THREE.Mesh(navBtnGeo, nextMat);
    nextBtnMesh.position.set(PAGE_W / 2 + 0.044, -0.088, 0.0135);
    nextBtnMesh.userData = {
        action: 'book-next-page',
        label: 'Next Page ▶',
        baseZ: 0.0135,
        currentZ: 0.0135,
        targetZ: 0.0135,
        canvas: nextCanvas,
        ctx: nextCtx,
        texture: nextTex
    };
    bookPivot.add(nextBtnMesh);
    interactiveObjects.push(nextBtnMesh);

    // 6. Realistic 3D Flipping Page Mechanism
    flippingHinge = new THREE.Group();
    flippingHinge.position.set(0, 0, 0.011);
    bookPivot.add(flippingHinge);

    flippingFrontCanvas = document.createElement('canvas');
    flippingFrontCanvas.width = 1024;
    flippingFrontCanvas.height = 1400;
    flippingFrontCtx = flippingFrontCanvas.getContext('2d');
    flippingFrontTexture = new THREE.CanvasTexture(flippingFrontCanvas);

    flippingBackCanvas = document.createElement('canvas');
    flippingBackCanvas.width = 1024;
    flippingBackCanvas.height = 1400;
    flippingBackCtx = flippingBackCanvas.getContext('2d');
    flippingBackTexture = new THREE.CanvasTexture(flippingBackCanvas);

    // Dynamic Flexible Plane for realistic paper bending during flip
    const flipGeo = new THREE.PlaneGeometry(PAGE_W, PAGE_H, 20, 6);
    flipGeo.translate(PAGE_W / 2, 0, 0); // hinge around spine x = 0
    flipGeo.userData = {
        origPositions: Float32Array.from(flipGeo.attributes.position.array)
    };

    const flipMatFront = new THREE.MeshBasicMaterial({
        map: flippingFrontTexture,
        side: THREE.FrontSide
    });
    const flipMatBack = new THREE.MeshBasicMaterial({
        map: flippingBackTexture,
        side: THREE.BackSide
    });

    const frontPageMesh = new THREE.Mesh(flipGeo, flipMatFront);
    const backPageMesh = new THREE.Mesh(flipGeo, flipMatBack);
    flippingHinge.add(frontPageMesh);
    flippingHinge.add(backPageMesh);
    flippingHinge.visible = false;

    // 7. Ambient Glowing Magic Spark Particles around Grimoire
    const sparkCount = 28;
    const sparkPositions = new Float32Array(sparkCount * 3);
    for (let i = 0; i < sparkCount; i++) {
        sparkPositions[i * 3 + 0] = (Math.random() - 0.5) * 0.38;
        sparkPositions[i * 3 + 1] = (Math.random() - 0.5) * 0.28;
        sparkPositions[i * 3 + 2] = (Math.random() - 0.5) * 0.08 + 0.02;
    }
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
    const sparkMat = new THREE.PointsMaterial({
        color: 0x00f0ff,
        size: 0.007,
        transparent: true,
        opacity: 0.75,
        blending: THREE.AdditiveBlending
    });
    const sparks = new THREE.Points(sparkGeo, sparkMat);
    sparks.name = 'MagicSparks';
    bookPivot.add(sparks);

    // 8. Holographic Fingertip Poke Cursor with Concentric Reticle Ring
    const pokeCursorGeo = new THREE.SphereGeometry(0.006, 16, 16);
    const pokeCursorMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.9
    });
    pokeCursorMesh = new THREE.Mesh(pokeCursorGeo, pokeCursorMat);

    const reticleGeo = new THREE.RingGeometry(0.009, 0.013, 24);
    const reticleMat = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.8
    });
    const reticleMesh = new THREE.Mesh(reticleGeo, reticleMat);
    pokeCursorMesh.add(reticleMesh);

    pokeCursorMesh.visible = false;
    scene.add(pokeCursorMesh);

    // Initial Render
    updatePalmBookUI();
}

function triggerPokeHaptics() {
    const session = renderer.xr.getSession();
    if (session) {
        for (const source of session.inputSources) {
            if (source.gamepad && source.gamepad.hapticActuators && source.gamepad.hapticActuators[0]) {
                try {
                    source.gamepad.hapticActuators[0].pulse(0.75, 45);
                } catch (e) {}
            }
        }
    }
}

function applyBookTheme(themeKey) {
    if (!bookThemes[themeKey]) themeKey = 'obsidian';
    currentBookTheme = themeKey;
    const theme = bookThemes[currentBookTheme];

    if (coverMatRef) {
        coverMatRef.color.setHex(theme.coverColor);
    }
    if (goldTrimMatRef) {
        goldTrimMatRef.color.setHex(theme.goldTrim);
    }

    updatePalmBookUI();
}

function updatePalmBookUI() {
    if (!leftPageCtx || !rightPageCtx) return;

    const theme = bookThemes[currentBookTheme] || bookThemes.obsidian;
    const lw = leftPageCanvas.width;
    const lh = leftPageCanvas.height;

    // -------------------------------------------------------------
    // RENDER LEFT PAGE: Cyber Grimoire Field Manual & Telemetry
    // -------------------------------------------------------------
    leftPageCtx.fillStyle = theme.pageBg;
    leftPageCtx.fillRect(0, 0, lw, lh);

    // Subtle ambient vignette
    const grad = leftPageCtx.createRadialGradient(lw / 2, lh / 2, 80, lw / 2, lh / 2, 720);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.03)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
    leftPageCtx.fillStyle = grad;
    leftPageCtx.fillRect(0, 0, lw, lh);

    // High-Contrast Borders
    leftPageCtx.strokeStyle = theme.pageBorder;
    leftPageCtx.lineWidth = 5;
    leftPageCtx.strokeRect(26, 26, lw - 52, lh - 52);

    leftPageCtx.strokeStyle = theme.pageInnerBorder;
    leftPageCtx.lineWidth = 2;
    leftPageCtx.strokeRect(36, 36, lw - 72, lh - 72);

    // Top Header Banner
    leftPageCtx.fillStyle = theme.headerBg;
    leftPageCtx.fillRect(45, 48, lw - 90, 84);
    leftPageCtx.strokeStyle = theme.headerBorder;
    leftPageCtx.lineWidth = 3.5;
    leftPageCtx.strokeRect(45, 48, lw - 90, 84);

    leftPageCtx.font = 'bold 36px Outfit, sans-serif';
    leftPageCtx.textAlign = 'center';
    leftPageCtx.textBaseline = 'middle';
    leftPageCtx.strokeStyle = '#000000';
    leftPageCtx.lineWidth = 5;
    leftPageCtx.strokeText('📖 QUANTUM XR FIELD MANUAL', lw / 2, 90);
    leftPageCtx.fillStyle = theme.headerText;
    leftPageCtx.fillText('📖 QUANTUM XR FIELD MANUAL', lw / 2, 90);

    // Live Quantum Superposition / Observer Collapse Banner
    const isObserved = state.detectorActive;
    leftPageCtx.fillStyle = isObserved ? '#4c0519' : '#052e16';
    leftPageCtx.strokeStyle = isObserved ? '#ff2d87' : '#10b981';
    leftPageCtx.lineWidth = 4;
    leftPageCtx.beginPath();
    leftPageCtx.roundRect(45, 148, lw - 90, 86, 12);
    leftPageCtx.fill();
    leftPageCtx.stroke();

    leftPageCtx.font = 'bold 28px Outfit, sans-serif';
    leftPageCtx.textAlign = 'center';
    leftPageCtx.textBaseline = 'middle';
    const statusText = isObserved ? '👁️ OBSERVED (Wavefunction Collapsed)' : '🌊 WAVE SUPERPOSITION (Interference Active)';
    leftPageCtx.strokeStyle = '#000000';
    leftPageCtx.lineWidth = 5;
    leftPageCtx.strokeText(statusText, lw / 2, 191);
    leftPageCtx.fillStyle = isObserved ? '#ff2d87' : '#10b981';
    leftPageCtx.fillText(statusText, lw / 2, 191);

    // Live Experiment Telemetry Table (Solid Opaque Card for Maximum Readability)
    leftPageCtx.fillStyle = theme.cardBg;
    leftPageCtx.strokeStyle = theme.cardBorder;
    leftPageCtx.lineWidth = 3;
    leftPageCtx.beginPath();
    leftPageCtx.roundRect(45, 252, lw - 90, 485, 14);
    leftPageCtx.fill();
    leftPageCtx.stroke();

    leftPageCtx.font = 'bold 26px Outfit, sans-serif';
    leftPageCtx.textAlign = 'left';
    leftPageCtx.textBaseline = 'middle';
    leftPageCtx.strokeStyle = '#000000';
    leftPageCtx.lineWidth = 4;
    leftPageCtx.strokeText('⚡ REALTIME EXPERIMENT TELEMETRY', 72, 290);
    leftPageCtx.fillStyle = theme.valColor;
    leftPageCtx.fillText('⚡ REALTIME EXPERIMENT TELEMETRY', 72, 290);

    const fringeWidthMm = ((state.wavelength * 1e-9 * state.screenDistance) / (state.slitSeparation * 1e-3)) * 1000;
    const telemetryRows = [
        { label: 'TOTAL IMPACT HITS', value: `${state.totalHits.toLocaleString()}` },
        { label: 'LIGHT WAVELENGTH λ', value: `${state.wavelength} nm` },
        { label: 'SLIT SEPARATION d', value: `${state.slitSeparation.toFixed(2)} mm` },
        { label: 'SCREEN DISTANCE D', value: `${state.screenDistance.toFixed(2)} m` },
        { label: 'FRINGE WIDTH β', value: `${fringeWidthMm.toFixed(2)} mm` },
        { label: 'EMISSION MODE', value: `${state.beamMode.toUpperCase()}` },
        { label: 'OBSERVER DETECTOR', value: state.detectorActive ? 'ACTIVE (WHICH-WAY)' : 'INACTIVE (WAVE)' }
    ];

    telemetryRows.forEach((row, idx) => {
        const y = 345 + idx * 52;

        // Subtle alternating card stripe
        if (idx % 2 === 1) {
            leftPageCtx.fillStyle = 'rgba(255, 255, 255, 0.035)';
            leftPageCtx.fillRect(60, y - 20, lw - 120, 42);
        }

        // High-Contrast Label (Left-aligned)
        leftPageCtx.font = 'bold 24px Outfit, sans-serif';
        leftPageCtx.textAlign = 'left';
        leftPageCtx.textBaseline = 'middle';
        leftPageCtx.strokeStyle = '#000000';
        leftPageCtx.lineWidth = 4;
        leftPageCtx.strokeText(row.label, 72, y);
        leftPageCtx.fillStyle = theme.labelColor;
        leftPageCtx.fillText(row.label, 72, y);

        // High-Contrast Value (Right-aligned)
        leftPageCtx.font = 'bold 26px JetBrains Mono, monospace';
        leftPageCtx.textAlign = 'right';
        leftPageCtx.textBaseline = 'middle';
        leftPageCtx.strokeStyle = '#000000';
        leftPageCtx.lineWidth = 4;
        leftPageCtx.strokeText(row.value, lw - 72, y);
        leftPageCtx.fillStyle = (idx === 6 && state.detectorActive) ? '#ff2d87' : theme.valColor;
        leftPageCtx.fillText(row.value, lw - 72, y);

        // Horizontal separator line
        leftPageCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        leftPageCtx.lineWidth = 1;
        leftPageCtx.beginPath();
        leftPageCtx.moveTo(70, y + 23);
        leftPageCtx.lineTo(lw - 70, y + 23);
        leftPageCtx.stroke();
    });

    // Schematic Vector Diagram of Double Slit Optical Line
    leftPageCtx.fillStyle = theme.cardBg;
    leftPageCtx.strokeStyle = theme.cardBorder;
    leftPageCtx.lineWidth = 2.5;
    leftPageCtx.beginPath();
    leftPageCtx.roundRect(45, 755, lw - 90, 345, 14);
    leftPageCtx.fill();
    leftPageCtx.stroke();

    leftPageCtx.font = 'bold 24px Outfit, sans-serif';
    leftPageCtx.textAlign = 'left';
    leftPageCtx.textBaseline = 'middle';
    leftPageCtx.strokeStyle = '#000000';
    leftPageCtx.lineWidth = 4;
    leftPageCtx.strokeText('🔬 OPTICAL BENCH BEAMLINE SCHEMATIC', 72, 792);
    leftPageCtx.fillStyle = theme.accent;
    leftPageCtx.fillText('🔬 OPTICAL BENCH BEAMLINE SCHEMATIC', 72, 792);

    // 1. Emitter Box
    leftPageCtx.fillStyle = state.emitterActive ? '#00f0ff' : '#475569';
    leftPageCtx.fillRect(80, 860, 72, 72);
    leftPageCtx.strokeStyle = '#ffffff';
    leftPageCtx.lineWidth = 2;
    leftPageCtx.strokeRect(80, 860, 72, 72);
    leftPageCtx.font = 'bold 18px Outfit, sans-serif';
    leftPageCtx.fillStyle = '#0f172a';
    leftPageCtx.textAlign = 'center';
    leftPageCtx.textBaseline = 'middle';
    leftPageCtx.fillText('EMIT', 116, 896);

    // 2. Beams
    leftPageCtx.strokeStyle = state.emitterActive ? '#00f0ff' : '#475569';
    leftPageCtx.lineWidth = 4;
    leftPageCtx.beginPath();
    leftPageCtx.moveTo(152, 896);
    leftPageCtx.lineTo(380, 896);
    leftPageCtx.stroke();

    // 3. Double Slits Barrier
    leftPageCtx.fillStyle = '#94a3b8';
    leftPageCtx.fillRect(380, 830, 18, 45);
    leftPageCtx.fillRect(380, 887, 18, 18);
    leftPageCtx.fillRect(380, 917, 18, 45);

    leftPageCtx.font = 'bold 16px Outfit, sans-serif';
    leftPageCtx.fillStyle = '#f8fafc';
    leftPageCtx.fillText('SLITS', 389, 990);

    // 4. Which-way detector icon
    if (state.detectorActive) {
        leftPageCtx.fillStyle = 'rgba(255, 45, 135, 0.4)';
        leftPageCtx.strokeStyle = '#ff2d87';
        leftPageCtx.lineWidth = 3;
        leftPageCtx.beginPath();
        leftPageCtx.arc(430, 865, 26, 0, Math.PI * 2);
        leftPageCtx.fill();
        leftPageCtx.stroke();
        leftPageCtx.font = '22px Outfit, sans-serif';
        leftPageCtx.fillStyle = '#ff2d87';
        leftPageCtx.fillText('👁️', 430, 874);
    }

    // 5. Screen Target
    leftPageCtx.fillStyle = '#10b981';
    leftPageCtx.fillRect(860, 820, 22, 160);
    leftPageCtx.font = 'bold 16px Outfit, sans-serif';
    leftPageCtx.fillStyle = '#10b981';
    leftPageCtx.fillText('SCREEN', 871, 1002);

    // Draw waves or particle trajectories
    if (state.emitterActive) {
        if (!state.detectorActive) {
            leftPageCtx.strokeStyle = '#00ff88';
            leftPageCtx.lineWidth = 2.5;
            for (let r = 30; r < 360; r += 45) {
                leftPageCtx.beginPath();
                leftPageCtx.arc(398, 876, r, -0.4, 0.4);
                leftPageCtx.stroke();
                leftPageCtx.beginPath();
                leftPageCtx.arc(398, 906, r, -0.4, 0.4);
                leftPageCtx.stroke();
            }
        } else {
            leftPageCtx.strokeStyle = '#ff2d87';
            leftPageCtx.lineWidth = 3;
            leftPageCtx.setLineDash([8, 6]);
            leftPageCtx.beginPath();
            leftPageCtx.moveTo(398, 876);
            leftPageCtx.lineTo(860, 876);
            leftPageCtx.moveTo(398, 906);
            leftPageCtx.lineTo(860, 906);
            leftPageCtx.stroke();
            leftPageCtx.setLineDash([]);
        }
    }

    // Dog-ear corner fold hint (Bottom-Left corner: ◀ POKE TO FLIP)
    leftPageCtx.save();
    leftPageCtx.fillStyle = 'rgba(0, 240, 255, 0.25)';
    leftPageCtx.beginPath();
    leftPageCtx.moveTo(30, lh - 30);
    leftPageCtx.lineTo(145, lh - 30);
    leftPageCtx.lineTo(30, lh - 145);
    leftPageCtx.closePath();
    leftPageCtx.fill();
    leftPageCtx.strokeStyle = theme.accent;
    leftPageCtx.lineWidth = 3;
    leftPageCtx.stroke();
    leftPageCtx.font = 'bold 20px Outfit, sans-serif';
    leftPageCtx.fillStyle = theme.accent;
    leftPageCtx.textAlign = 'left';
    leftPageCtx.textBaseline = 'middle';
    leftPageCtx.fillText('◀ POKE', 44, lh - 55);
    leftPageCtx.restore();

    // Quick VR Interaction Guide at bottom
    leftPageCtx.font = 'bold 22px Outfit, sans-serif';
    leftPageCtx.fillStyle = theme.labelColor;
    leftPageCtx.textAlign = 'center';
    leftPageCtx.textBaseline = 'middle';
    leftPageCtx.strokeStyle = '#000000';
    leftPageCtx.lineWidth = 3;
    leftPageCtx.strokeText('Turn left palm to summon • Poke page corners, buttons, or swipe to turn', lw / 2, 1140);
    leftPageCtx.fillText('Turn left palm to summon • Poke page corners, buttons, or swipe to turn', lw / 2, 1140);

    leftPageTexture.needsUpdate = true;

    // Render Pin Button Canvas (Solid High-Contrast Button)
    if (pinBtnMesh && pinBtnMesh.userData.ctx) {
        const pctx = pinBtnMesh.userData.ctx;
        pctx.fillStyle = isBookPinned ? '#451a03' : theme.btnBg;
        pctx.fillRect(0, 0, 512, 100);

        pctx.strokeStyle = isBookPinned ? '#fbbf24' : '#00f0ff';
        pctx.lineWidth = 5;
        pctx.strokeRect(3, 3, 506, 94);

        pctx.font = 'bold 28px Outfit, sans-serif';
        pctx.textAlign = 'center';
        pctx.textBaseline = 'middle';
        pctx.strokeStyle = '#000000';
        pctx.lineWidth = 5;
        const pinText = isBookPinned ? '📌 PINNED IN SPACE (CLICK TO UNPIN)' : '🤲 ATTACHED TO PALM (CLICK TO PIN)';
        pctx.strokeText(pinText, 256, 50);
        pctx.fillStyle = isBookPinned ? '#fbbf24' : '#00f0ff';
        pctx.fillText(pinText, 256, 50);
        pinBtnMesh.userData.texture.needsUpdate = true;
    }

    // -------------------------------------------------------------
    // RENDER RIGHT PAGE: Active Chapter Background & Layout
    // -------------------------------------------------------------
    const rw = rightPageCanvas.width;
    const rh = rightPageCanvas.height;

    rightPageCtx.fillStyle = theme.pageBg;
    rightPageCtx.fillRect(0, 0, rw, rh);

    const rgrad = rightPageCtx.createRadialGradient(rw / 2, rh / 2, 80, rw / 2, rh / 2, 720);
    rgrad.addColorStop(0, 'rgba(255, 255, 255, 0.03)');
    rgrad.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
    rightPageCtx.fillStyle = rgrad;
    rightPageCtx.fillRect(0, 0, rw, rh);

    // Frame
    rightPageCtx.strokeStyle = theme.pageBorder;
    rightPageCtx.lineWidth = 5;
    rightPageCtx.strokeRect(26, 26, rw - 52, rh - 52);

    rightPageCtx.strokeStyle = theme.pageInnerBorder;
    rightPageCtx.lineWidth = 2;
    rightPageCtx.strokeRect(36, 36, rw - 72, rh - 72);

    const currPageData = bookPages[currentPageIndex] || bookPages[0];

    // Chapter Header Banner (Solid Opaque High Contrast)
    rightPageCtx.fillStyle = theme.headerBg;
    rightPageCtx.fillRect(45, 48, rw - 90, 88);
    rightPageCtx.strokeStyle = theme.headerBorder;
    rightPageCtx.lineWidth = 3.5;
    rightPageCtx.strokeRect(45, 48, rw - 90, 88);

    rightPageCtx.font = 'bold 36px Outfit, sans-serif';
    rightPageCtx.textAlign = 'center';
    rightPageCtx.textBaseline = 'middle';
    rightPageCtx.strokeStyle = '#000000';
    rightPageCtx.lineWidth = 5;
    rightPageCtx.strokeText(currPageData.chapter, rw / 2, 78);
    rightPageCtx.fillStyle = theme.headerText;
    rightPageCtx.fillText(currPageData.chapter, rw / 2, 78);

    rightPageCtx.font = 'bold 24px Outfit, sans-serif';
    rightPageCtx.strokeStyle = '#000000';
    rightPageCtx.lineWidth = 3;
    rightPageCtx.strokeText(currPageData.subtitle, rw / 2, 114);
    rightPageCtx.fillStyle = '#cbd5e1';
    rightPageCtx.fillText(currPageData.subtitle, rw / 2, 114);

    // Divider Line
    rightPageCtx.strokeStyle = theme.pageBorder;
    rightPageCtx.lineWidth = 2;
    rightPageCtx.beginPath();
    rightPageCtx.moveTo(60, 160);
    rightPageCtx.lineTo(rw - 60, 160);
    rightPageCtx.stroke();

    // Footer Pagination Bar: PAGE X OF Y with glowing bullet dots
    rightPageCtx.fillStyle = theme.cardBg;
    rightPageCtx.strokeStyle = theme.cardBorder;
    rightPageCtx.lineWidth = 2;
    rightPageCtx.beginPath();
    rightPageCtx.roundRect(45, rh - 130, rw - 90, 60, 8);
    rightPageCtx.fill();
    rightPageCtx.stroke();

    rightPageCtx.font = 'bold 24px Outfit, sans-serif';
    rightPageCtx.textAlign = 'center';
    rightPageCtx.textBaseline = 'middle';
    rightPageCtx.strokeStyle = '#000000';
    rightPageCtx.lineWidth = 4;
    const pageText = `PAGE ${currentPageIndex + 1} OF ${bookPages.length}`;
    rightPageCtx.strokeText(pageText, rw / 2, rh - 98);
    rightPageCtx.fillStyle = theme.accent;
    rightPageCtx.fillText(pageText, rw / 2, rh - 98);

    // Dot indicators
    const dotSpacing = 30;
    const startDotX = rw / 2 - ((bookPages.length - 1) * dotSpacing) / 2;
    for (let d = 0; d < bookPages.length; d++) {
        rightPageCtx.beginPath();
        rightPageCtx.arc(startDotX + d * dotSpacing, rh - 58, d === currentPageIndex ? 7 : 4, 0, Math.PI * 2);
        rightPageCtx.fillStyle = (d === currentPageIndex) ? theme.accent : 'rgba(148, 163, 184, 0.45)';
        rightPageCtx.fill();
    }

    // Dog-ear corner fold hint (Bottom-Right corner: POKE TO FLIP ▶)
    rightPageCtx.save();
    rightPageCtx.fillStyle = 'rgba(0, 240, 255, 0.25)';
    rightPageCtx.beginPath();
    rightPageCtx.moveTo(rw - 145, rh - 30);
    rightPageCtx.lineTo(rw - 30, rh - 145);
    rightPageCtx.lineTo(rw - 30, rh - 30);
    rightPageCtx.closePath();
    rightPageCtx.fill();
    rightPageCtx.strokeStyle = theme.accent;
    rightPageCtx.lineWidth = 3;
    rightPageCtx.stroke();
    rightPageCtx.font = 'bold 20px Outfit, sans-serif';
    rightPageCtx.fillStyle = theme.accent;
    rightPageCtx.textAlign = 'right';
    rightPageCtx.textBaseline = 'middle';
    rightPageCtx.fillText('POKE ▶', rw - 44, rh - 55);
    rightPageCtx.restore();

    rightPageTexture.needsUpdate = true;

    // Render Navigation Footer Buttons (Prev & Next)
    renderNavButtons();

    // Render 4 Active 3D Controls on the Page
    updatePalmBookButtons();
}

function renderNavButtons() {
    const theme = bookThemes[currentBookTheme] || bookThemes.obsidian;

    if (prevBtnMesh && prevBtnMesh.userData.ctx) {
        const pctx = prevBtnMesh.userData.ctx;
        // Solid opaque dark background
        pctx.fillStyle = theme.btnBg;
        pctx.fillRect(0, 0, 256, 100);

        pctx.strokeStyle = '#00f0ff';
        pctx.lineWidth = 5;
        pctx.strokeRect(3, 3, 250, 94);

        pctx.font = 'bold 26px Outfit, sans-serif';
        pctx.textAlign = 'center';
        pctx.textBaseline = 'middle';
        pctx.strokeStyle = '#000000';
        pctx.lineWidth = 5;
        pctx.strokeText('◀ PREV (POKE)', 128, 50);
        pctx.fillStyle = '#00f0ff';
        pctx.fillText('◀ PREV (POKE)', 128, 50);
        prevBtnMesh.userData.texture.needsUpdate = true;
    }

    if (nextBtnMesh && nextBtnMesh.userData.ctx) {
        const nctx = nextBtnMesh.userData.ctx;
        // Solid opaque dark background
        nctx.fillStyle = theme.btnBg;
        nctx.fillRect(0, 0, 256, 100);

        nctx.strokeStyle = '#00f0ff';
        nctx.lineWidth = 5;
        nctx.strokeRect(3, 3, 250, 94);

        nctx.font = 'bold 26px Outfit, sans-serif';
        nctx.textAlign = 'center';
        nctx.textBaseline = 'middle';
        nctx.strokeStyle = '#000000';
        nctx.lineWidth = 5;
        nctx.strokeText('(POKE) NEXT ▶', 128, 50);
        nctx.fillStyle = '#00f0ff';
        nctx.fillText('(POKE) NEXT ▶', 128, 50);
        nextBtnMesh.userData.texture.needsUpdate = true;
    }
}

function updatePalmBookButtons() {
    const theme = bookThemes[currentBookTheme] || bookThemes.obsidian;
    const pageData = bookPages[currentPageIndex] || bookPages[0];
    const controls = pageData.controls || [];

    for (let i = 0; i < 4; i++) {
        const btnMesh = pageButtonMeshes[i];
        if (!btnMesh) continue;

        if (i < controls.length) {
            btnMesh.visible = true;
            const ctrl = controls[i];
            const label = ctrl.getLabel();
            const color = ctrl.getColor();

            btnMesh.userData.action = ctrl.id;
            btnMesh.userData.label = label;

            // Render Dynamic Button Texture
            const bctx = btnMesh.userData.ctx;
            const bw = btnMesh.userData.canvas.width;
            const bh = btnMesh.userData.canvas.height;

            // 1. SOLID OPAQUE DARK PILL BASE (NO MORE TRANSLUCENT GLITCH)
            bctx.fillStyle = theme.btnBg;
            bctx.fillRect(0, 0, bw, bh);

            // Subtle depth gradient
            const bgrad = bctx.createLinearGradient(0, 0, bw, 0);
            bgrad.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
            bgrad.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
            bctx.fillStyle = bgrad;
            bctx.fillRect(0, 0, bw, bh);

            // 2. VIBRANT BOLD COLORED BORDER
            bctx.strokeStyle = color;
            bctx.lineWidth = 6;
            bctx.strokeRect(3, 3, bw - 6, bh - 6);

            // Inner subtle highlight border
            bctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
            bctx.lineWidth = 2;
            bctx.strokeRect(7, 7, bw - 14, bh - 14);

            // 3. ICON ACCENT BOX
            bctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
            bctx.fillRect(10, 10, 85, bh - 20);
            bctx.strokeStyle = color;
            bctx.lineWidth = 3;
            bctx.strokeRect(10, 10, 85, bh - 20);

            bctx.font = 'bold 44px Outfit, sans-serif';
            bctx.textAlign = 'center';
            bctx.textBaseline = 'middle';
            bctx.fillStyle = '#ffffff';
            bctx.fillText(ctrl.icon || '⚡', 52, bh / 2);

            // 4. BUTTON TITLE - BOLD WHITE TEXT WITH HEAVY BLACK OUTLINE (ALWAYS CRISP & READABLE)
            bctx.font = 'bold 31px Outfit, sans-serif';
            bctx.textAlign = 'left';
            bctx.textBaseline = 'middle';

            bctx.strokeStyle = '#000000';
            bctx.lineWidth = 6;
            bctx.strokeText(label, 115, bh / 2);

            bctx.fillStyle = theme.btnText;
            bctx.fillText(label, 115, bh / 2);

            btnMesh.userData.texture.needsUpdate = true;
        } else {
            btnMesh.visible = false;
            btnMesh.userData.action = null;
        }
    }
}

function flipToNextPage() {
    if (isFlippingPage) return;
    ensureAudio();
    audio.playPageFlipSound();

    const oldIndex = currentPageIndex;
    currentPageIndex = (currentPageIndex + 1) % bookPages.length;

    startPageFlip(1, oldIndex, currentPageIndex);
}

function flipToPrevPage() {
    if (isFlippingPage) return;
    ensureAudio();
    audio.playPageFlipSound();

    const oldIndex = currentPageIndex;
    currentPageIndex = (currentPageIndex - 1 + bookPages.length) % bookPages.length;

    startPageFlip(-1, oldIndex, currentPageIndex);
}

function startPageFlip(dir, fromIndex, toIndex) {
    isFlippingPage = true;
    flipDirection = dir;
    flipProgress = 0;

    // Snapshot textures onto the flipping page
    renderPageSnapshot(flippingFrontCtx, fromIndex);
    renderPageSnapshot(flippingBackCtx, toIndex);
    flippingFrontTexture.needsUpdate = true;
    flippingBackTexture.needsUpdate = true;

    flippingHinge.visible = true;

    if (dir === 1) {
        // Flipping Next: starts flat on the right (angle = 0), turns left to -Math.PI
        flippingHinge.rotation.y = 0;
    } else {
        // Flipping Prev: starts on the left (-Math.PI), turns right to 0
        flippingHinge.rotation.y = -Math.PI;
    }

    // Immediately update background right page so new content is waiting beneath
    updatePalmBookUI();
}

function renderPageSnapshot(ctx, pageIdx) {
    if (!ctx) return;
    const theme = bookThemes[currentBookTheme] || bookThemes.obsidian;
    const w = 1024;
    const h = 1400;
    const pageData = bookPages[pageIdx] || bookPages[0];

    ctx.fillStyle = theme.pageBg;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = theme.pageBorder;
    ctx.lineWidth = 5;
    ctx.strokeRect(26, 26, w - 52, h - 52);

    ctx.font = 'bold 36px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 5;
    ctx.strokeText(pageData.chapter, w / 2, 85);
    ctx.fillStyle = theme.headerText;
    ctx.fillText(pageData.chapter, w / 2, 85);

    ctx.font = 'bold 24px Outfit, sans-serif';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeText(pageData.subtitle, w / 2, 120);
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(pageData.subtitle, w / 2, 120);

    // Draw buttons representation
    const ctrls = pageData.controls || [];
    const btnYOffsets = [240, 480, 720, 960];
    ctrls.forEach((ctrl, idx) => {
        if (idx < 4) {
            const y = btnYOffsets[idx];
            ctx.fillStyle = theme.btnBg;
            ctx.fillRect(60, y, w - 120, 180);
            ctx.strokeStyle = ctrl.getColor();
            ctx.lineWidth = 6;
            ctx.strokeRect(60, y, w - 120, 180);

            ctx.font = 'bold 36px Outfit, sans-serif';
            ctx.textAlign = 'center';
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 6;
            ctx.strokeText(ctrl.getLabel(), w / 2, y + 95);
            ctx.fillStyle = '#ffffff';
            ctx.fillText(ctrl.getLabel(), w / 2, y + 95);
        }
    });

    ctx.font = 'bold 26px Outfit, sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 4;
    const pStr = `PAGE ${pageIdx + 1} OF ${bookPages.length}`;
    ctx.strokeText(pStr, w / 2, h - 80);
    ctx.fillStyle = theme.accent;
    ctx.fillText(pStr, w / 2, h - 80);
}

function toggleBookPin() {
    isBookPinned = !isBookPinned;
    ensureAudio();
    audio.playButtonClick('default');

    if (isBookPinned && palmBookRoot) {
        // Freeze at current world position
        palmBookRoot.getWorldPosition(bookWorldPos);
        palmBookRoot.getWorldQuaternion(bookWorldQuat);
    }
    updatePalmBookUI();
}

function togglePalmBookDesktop() {
    isDesktopBookOpen = !isDesktopBookOpen;
    ensureAudio();
    audio.playButtonClick('default');

    const btnEl = document.getElementById('btn-toggle-palm-book');
    if (btnEl) btnEl.classList.toggle('active', isDesktopBookOpen);
}

function isPalmBookVisible() {
    return bookScale > 0.05;
}

// Backward-compatible alias
function updateVRMenuTexture() {
    updatePalmBookUI();
}

function repositionVRMenuInFrontOfUser() {
    togglePalmBookDesktop();
}
createQuantumPalmBook();

// =============================================================================
// INTERACTION & RAYCASTING (DESKTOP + VR)
// =============================================================================
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const tooltip = document.getElementById('tooltip-3d');
let hoveredObject = null;

function trigger3DAction(action) {
    ensureAudio();
    if (!action) return;

    if (action === 'toggle-book-theme') {
        const themeKeys = ['obsidian', 'parchment', 'tactical'];
        const nextIdx = (themeKeys.indexOf(currentBookTheme) + 1) % themeKeys.length;
        applyBookTheme(themeKeys[nextIdx]);
        audio.playButtonClick('default');
        return;
    } else if (action === 'exit-vr-to-hub') {
        audio.playButtonClick('power');
        if (renderer.xr.isPresenting) {
            const session = renderer.xr.getSession();
            if (session) session.end();
        }
        setAppView('portal');
        return;
    } else if (action === 'exit-vr-to-catalog') {
        audio.playButtonClick('power');
        if (renderer.xr.isPresenting) {
            const session = renderer.xr.getSession();
            if (session) session.end();
        }
        setAppView('experiments');
        return;
    } else if (action === 'exit-vr-to-theory') {
        audio.playButtonClick('power');
        if (renderer.xr.isPresenting) {
            const session = renderer.xr.getSession();
            if (session) session.end();
        }
        setAppView('theory');
        return;
    } else if (action === 'toggle-beam-mode') {
        state.beamMode = (state.beamMode === 'stream' ? 'single' : 'stream');
        audio.playButtonClick('default');
        updateVRMenuTexture();
        return;
    } else if (action === 'vr-height-up') {
        state.userHeightOffset = Math.min(2.5, state.userHeightOffset + 0.15);
        if (renderer.xr.isPresenting) xrRig.position.y = state.userHeightOffset;
        audio.playButtonClick('default');
        updateVRMenuTexture();
        return;
    } else if (action === 'vr-height-down') {
        state.userHeightOffset = Math.max(-0.6, state.userHeightOffset - 0.15);
        if (renderer.xr.isPresenting) xrRig.position.y = state.userHeightOffset;
        audio.playButtonClick('default');
        updateVRMenuTexture();
        return;
    } else if (action === 'vr-height-reset') {
        state.userHeightOffset = 0.0;
        if (renderer.xr.isPresenting) xrRig.position.y = 0.0;
        audio.playButtonClick('default');
        updateVRMenuTexture();
        return;
    } else if (action === 'summon-vr-menu' || action === 'toggle-palm-book') {
        togglePalmBookDesktop();
        return;
    } else if (action === 'book-next-page') {
        flipToNextPage();
        return;
    } else if (action === 'book-prev-page') {
        flipToPrevPage();
        return;
    } else if (action === 'toggle-book-pin') {
        toggleBookPin();
        return;
    } else if (action.startsWith('teleport-')) {
        const stationId = action.replace('teleport-', '');
        teleportToStation(stationId);
    } else if (action === 'toggle-emitter') {
        state.emitterActive = !state.emitterActive;
        audio.playButtonClick('power');
        pressButton('emitter');
        updateVisualState();
        updatePalmBookUI();
    } else if (action === 'toggle-detector') {
        state.detectorActive = !state.detectorActive;
        audio.playDetectorSweep(state.detectorActive);
        audio.playButtonClick('detector');
        pressButton('detector');
        updateVisualState();
        updatePalmBookUI();
    } else if (action === 'reset-screen') {
        clearScreenHits();
        audio.playButtonClick('reset');
        pressButton('reset');
        updatePalmBookUI();
    }

    // Tactile button bounce on book
    const hitBtn = pageButtonMeshes.find(b => b.userData && b.userData.action === action);
    if (hitBtn) {
        hitBtn.userData.targetZ = hitBtn.userData.baseZ - 0.0035;
        setTimeout(() => {
            hitBtn.userData.targetZ = hitBtn.userData.baseZ;
        }, 130);
    }
}

function pressButton(btnKey) {
    if (buttonAnimState[btnKey]) {
        buttonAnimState[btnKey].targetY = -0.06;
        setTimeout(() => {
            if (buttonAnimState[btnKey]) buttonAnimState[btnKey].targetY = 0;
        }, 150);
    }
}

// Mouse Move & Hover
window.addEventListener('mousemove', (e) => {
    if (state.currentAppView !== 'experiment') {
        if (tooltip) tooltip.style.display = 'none';
        return;
    }

    mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(interactiveObjects, true);

    if (intersects.length > 0) {
        let hitObj = intersects[0].object;
        while (hitObj && !hitObj.userData.action && hitObj.parent) {
            hitObj = hitObj.parent;
        }

        if (hitObj && hitObj.userData && hitObj.userData.label) {
            hoveredObject = hitObj;
            document.body.style.cursor = 'pointer';

            // Micro-elevation for hovered book buttons
            if (hitObj.userData.baseZ !== undefined) {
                hitObj.userData.targetZ = hitObj.userData.baseZ + 0.0028;
            }

            if (tooltip) {
                tooltip.style.display = 'block';
                tooltip.style.left = `${e.clientX}px`;
                tooltip.style.top = `${e.clientY}px`;
                tooltip.textContent = hitObj.userData.label;
            }
            return;
        }
    }

    if (hoveredObject && hoveredObject.userData && hoveredObject.userData.baseZ !== undefined) {
        hoveredObject.userData.targetZ = hoveredObject.userData.baseZ;
    }
    hoveredObject = null;
    document.body.style.cursor = 'default';
    if (tooltip) tooltip.style.display = 'none';
});

// Click Interaction
window.addEventListener('click', (e) => {
    // If clicking on UI DOM element, skip 3D raycast
    if (e.target.closest('.global-navbar') || e.target.closest('.portal-container') || e.target.closest('.theory-container') || e.target.closest('.hud-layer') || e.target.closest('.modal-backdrop') || e.target.closest('#VRButton')) return;

    if (hoveredObject && hoveredObject.userData && hoveredObject.userData.action) {
        trigger3DAction(hoveredObject.userData.action);
    }
});

// Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
    if (state.currentAppView !== 'experiment') return;
    if (e.code === 'Space') {
        e.preventDefault();
        trigger3DAction('toggle-emitter');
    } else if (e.code === 'KeyD') {
        trigger3DAction('toggle-detector');
    } else if (e.code === 'KeyR') {
        trigger3DAction('reset-screen');
    } else if (e.code === 'KeyB') {
        togglePalmBookDesktop();
    } else if (e.code === 'ArrowRight' && isPalmBookVisible()) {
        flipToNextPage();
    } else if (e.code === 'ArrowLeft' && isPalmBookVisible()) {
        flipToPrevPage();
    }
});

// =============================================================================
// WEBXR VR CONTROLLER SETUP & POINTER LASERS
// =============================================================================
const controller1 = renderer.xr.getController(0);
const controller2 = renderer.xr.getController(1);

function buildControllerRay() {
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -4.5)
    ]);
    const lineMat = new THREE.LineBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.75
    });
    const line = new THREE.Line(lineGeo, lineMat);

    // Glowing tip pointer
    const tipMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.012, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0x00f0ff })
    );
    tipMesh.position.set(0, 0, -4.5);
    line.add(tipMesh);

    return line;
}

const ray1 = buildControllerRay();
controller1.add(ray1);
const ray2 = buildControllerRay();
controller2.add(ray2);

xrRig.add(controller1);
xrRig.add(controller2);

// =============================================================================
// WEBXR HAND TRACKING SETUP (Quest 2, 3, 3S, Pro & Hand Tracking Systems)
// =============================================================================
const hand0 = renderer.xr.getHand(0);
const hand1 = renderer.xr.getHand(1);
const handModelFactory = new XRHandModelFactory();
const handModel0 = handModelFactory.createHandModel(hand0, 'mesh');
const handModel1 = handModelFactory.createHandModel(hand1, 'mesh');
hand0.add(handModel0);
hand1.add(handModel1);
xrRig.add(hand0);
xrRig.add(hand1);

let leftHand = null;
let rightHand = null;

function onHandConnected(e) {
    if (e.data.handedness === 'left') {
        leftHand = e.target;
    } else if (e.data.handedness === 'right') {
        rightHand = e.target;
    }
}
hand0.addEventListener('connected', onHandConnected);
hand1.addEventListener('connected', onHandConnected);

function updatePalmBook(delta, elapsedTime) {
    if (!palmBookRoot) return;

    // 1. Dynamic 3D Page Flip Curling & Rotation Physics
    if (isFlippingPage && flippingHinge) {
        flipProgress += delta / FLIP_DURATION;
        const p = Math.min(1.0, flipProgress);
        // Smooth Cubic S-Curve Easing
        const t = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;

        if (flipDirection === 1) {
            // Next: rotates from 0 to -Math.PI
            flippingHinge.rotation.y = -t * Math.PI;
        } else {
            // Prev: rotates from -Math.PI to 0
            flippingHinge.rotation.y = -(1.0 - t) * Math.PI;
        }

        // Realistic Flexible Paper Arching & Dynamic Curvature
        const flipMesh = flippingHinge.children[0];
        if (flipMesh && flipMesh.geometry && flipMesh.geometry.userData.origPositions) {
            const posAttr = flipMesh.geometry.attributes.position;
            const orig = flipMesh.geometry.userData.origPositions;
            const PAGE_W = 0.150;

            for (let i = 0; i < posAttr.count; i++) {
                const ox = orig[i * 3 + 0];
                const normX = Math.max(0, Math.min(1, ox / PAGE_W));

                // Arch curl peaks midway through flight (sin(t * PI)) and bows outward in center of page
                const curlArch = Math.sin(t * Math.PI) * Math.sin(normX * Math.PI) * 0.024;
                posAttr.array[i * 3 + 2] = curlArch;
            }
            posAttr.needsUpdate = true;
            flipMesh.geometry.computeVertexNormals();

            // Also mirror to back page mesh
            const backMesh = flippingHinge.children[1];
            if (backMesh && backMesh.geometry) {
                const bPosAttr = backMesh.geometry.attributes.position;
                for (let i = 0; i < bPosAttr.count; i++) {
                    bPosAttr.array[i * 3 + 2] = posAttr.array[i * 3 + 2];
                }
                bPosAttr.needsUpdate = true;
                backMesh.geometry.computeVertexNormals();
            }
        }

        if (flipProgress >= 1.0) {
            isFlippingPage = false;
            flippingHinge.visible = false;
            flippingHinge.rotation.y = 0;
            updatePalmBookUI();
        }
    }

    // 2. Micro-animation button elevation (hover / press springs)
    [...pageButtonMeshes, prevBtnMesh, nextBtnMesh, pinBtnMesh].forEach(mesh => {
        if (mesh && mesh.userData && mesh.userData.targetZ !== undefined) {
            mesh.userData.currentZ += (mesh.userData.targetZ - mesh.userData.currentZ) * 0.35;
            mesh.position.z = mesh.userData.currentZ;
        }
    });

    // 3. Ambient Floating Sparks Gentle Orbit Animation
    const sparks = bookPivot.getObjectByName('MagicSparks');
    if (sparks) {
        sparks.rotation.z += delta * 0.45;
        sparks.rotation.y = Math.sin(elapsedTime * 1.5) * 0.2;
    }

    // 4. Hand Tracking / Left Palm Gesture Detection & Placement
    let showBook = false;
    let targetPos = new THREE.Vector3();
    let targetQuat = new THREE.Quaternion();

    if (isBookPinned) {
        // Book stays locked at pinned world position
        showBook = true;
        targetPos.copy(bookWorldPos);
        targetQuat.copy(bookWorldQuat);
    } else if (renderer.xr.isPresenting) {
        // VR Presentation Mode: Check Left Palm / Hand
        let palmDetected = false;

        if (leftHand && leftHand.joints) {
            const wrist = leftHand.joints['wrist'];
            const middleKnuckle = leftHand.joints['middle-finger-metacarpal'] || leftHand.joints['middle-finger-phalanx-proximal'];
            const indexKnuckle = leftHand.joints['index-finger-phalanx-proximal'] || leftHand.joints['index-finger-metacarpal'];
            const pinkyKnuckle = leftHand.joints['pinky-finger-phalanx-proximal'] || leftHand.joints['pinky-finger-metacarpal'];

            if (wrist && middleKnuckle && indexKnuckle && pinkyKnuckle) {
                const wristPos = new THREE.Vector3();
                const middlePos = new THREE.Vector3();
                const indexPos = new THREE.Vector3();
                const pinkyPos = new THREE.Vector3();

                wrist.getWorldPosition(wristPos);
                middleKnuckle.getWorldPosition(middlePos);
                indexKnuckle.getWorldPosition(indexPos);
                pinkyKnuckle.getWorldPosition(pinkyPos);

                const headPos = new THREE.Vector3();
                camera.getWorldPosition(headPos);

                // Hand raised comfortably in front of user
                const handRelY = wristPos.y - xrRig.position.y;
                if (handRelY > 0.65) {
                    // Finger vector along hand (wrist to middle knuckle)
                    const vUp = new THREE.Vector3().subVectors(middlePos, wristPos).normalize();
                    // Across palm (pinky knuckle to index knuckle)
                    const vAcross = new THREE.Vector3().subVectors(indexPos, pinkyPos).normalize();
                    // Palm normal: points out from palm surface
                    const palmNormal = new THREE.Vector3().crossVectors(vUp, vAcross).normalize();

                    // Vector from palm center to player's eyes
                    const palmCenter = new THREE.Vector3().addVectors(wristPos, middlePos).multiplyScalar(0.5);
                    const dirToEyes = new THREE.Vector3().subVectors(headPos, palmCenter).normalize();

                    // Palm facing user's eyes (dot product > 0.35)
                    const palmFacingUser = palmNormal.dot(dirToEyes) > 0.35;

                    if (palmFacingUser) {
                        palmDetected = true;
                        showBook = true;

                        // Float 5.5cm directly above center of left palm
                        targetPos.copy(palmCenter).addScaledVector(palmNormal, 0.055);

                        // Align book orientation to face the user:
                        // +Z (pages surface) points towards user's eyes
                        // +Y (top of book) points along fingers (vUp)
                        // +X (right page) points across hand towards thumb
                        const zAxis = dirToEyes.clone().normalize();
                        const yAxis = vUp.clone().normalize();
                        const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
                        yAxis.crossVectors(zAxis, xAxis).normalize();

                        const rotMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
                        targetQuat.setFromRotationMatrix(rotMatrix);
                    }
                }
            }
        }

        // VR Controller Fallback (when holding Quest Touch Controller in left hand)
        if (!palmDetected) {
            const leftCtrl = controller1;
            const ctrlPos = new THREE.Vector3();
            leftCtrl.getWorldPosition(ctrlPos);
            const headPos = new THREE.Vector3();
            camera.getWorldPosition(headPos);

            const handRelY = ctrlPos.y - xrRig.position.y;
            if (handRelY > 0.70) {
                // Vector pointing up from controller top
                const ctrlUp = new THREE.Vector3(0, 1, 0).applyQuaternion(leftCtrl.quaternion);
                const dirToEyes = new THREE.Vector3().subVectors(headPos, ctrlPos).normalize();

                // If controller is tilted with face towards user's eyes
                if (ctrlUp.dot(dirToEyes) > 0.45) {
                    showBook = true;
                    targetPos.copy(ctrlPos).addScaledVector(ctrlUp, 0.09);

                    const zAxis = dirToEyes.clone().normalize();
                    const yAxis = ctrlUp.clone().normalize();
                    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
                    yAxis.crossVectors(zAxis, xAxis).normalize();

                    const rotMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
                    targetQuat.setFromRotationMatrix(rotMatrix);
                }
            }
        }
    } else {
        // Desktop / Non-VR Mode: Toggled via Key 'B' or HUD Button
        if (isDesktopBookOpen && state.currentAppView === 'experiment') {
            showBook = true;
            // Float comfortably at chest level in front of camera
            const fwd = new THREE.Vector3(0, 0, -0.62).applyQuaternion(camera.quaternion);
            const down = new THREE.Vector3(0, -0.16, 0);
            targetPos.copy(camera.position).add(fwd).add(down);

            // Pages (+Z) face the camera, +Y is up, +X is right
            const zAxis = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
            const yAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
            const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();

            const rotMatrix = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
            targetQuat.setFromRotationMatrix(rotMatrix);

            // Subtle reading angle tilt backwards
            const tilt = new THREE.Quaternion().setFromAxisAngle(xAxis, -0.32);
            targetQuat.premultiply(tilt);
        }
    }

    // 5. Smooth Transform & Scale Lerping
    targetBookScale = showBook ? 1.0 : 0.0;
    bookScale += (targetBookScale - bookScale) * Math.min(1.0, delta * 12);
    palmBookRoot.scale.setScalar(bookScale);
    palmBookRoot.visible = (bookScale > 0.01);

    if (palmBookRoot.visible && !isBookPinned) {
        palmBookRoot.position.lerp(targetPos, Math.min(1.0, delta * 14));
        palmBookRoot.quaternion.slerp(targetQuat, Math.min(1.0, delta * 14));

        // Subtle gentle levitation breathing bob
        bookPivot.position.y = Math.sin(elapsedTime * 2.2) * 0.0035;
        bookPivot.rotation.z = Math.sin(elapsedTime * 1.8) * 0.015;
    }

    // 6. Direct Finger & Controller Poke Interaction to Flip Pages & Trigger Controls
    if (directTouchCooldown > 0) {
        directTouchCooldown -= delta;
    }

    let cursorActive = false;

    if (showBook && (renderer.xr.isPresenting || isDesktopBookOpen)) {
        // Collect candidate poke pointers (hands index fingertips + controller tips)
        const pokePointers = [];

        if (renderer.xr.isPresenting) {
            // Hand Tracking Fingers
            const candidates = [rightHand, leftHand, hand0, hand1].filter(Boolean);
            const visitedHands = new Set();

            for (const h of candidates) {
                if (!h.joints || visitedHands.has(h)) continue;
                visitedHands.add(h);

                // If book is on left palm, only poke with right hand or opposite hand
                if (!isBookPinned && h === leftHand) continue;

                const tip = h.joints['index-finger-tip'] || h.joints['index-finger-phalanx-distal'];
                if (tip) {
                    const worldPos = new THREE.Vector3();
                    tip.getWorldPosition(worldPos);
                    pokePointers.push({ type: 'hand', worldPos });
                }
            }

            // Controller Tip (acts as physical stylus when using VR controllers)
            [controller1, controller2].forEach(ctrl => {
                if (ctrl && ctrl.matrixWorld) {
                    const worldPos = new THREE.Vector3(0, 0, -0.05);
                    worldPos.applyMatrix4(ctrl.matrixWorld);
                    pokePointers.push({ type: 'controller', worldPos });
                }
            });
        }

        for (const pointer of pokePointers) {
            const worldTip = pointer.worldPos;
            // Convert to bookPivot's local coordinate space
            const localTip = bookPivot.worldToLocal(worldTip.clone());

            // Check if pointer is within close proximity of the book (0.20m width, 0.15m height, 0.08m depth)
            const isNearBook = Math.abs(localTip.x) < 0.20 && Math.abs(localTip.y) < 0.15 && localTip.z > -0.03 && localTip.z < 0.08;

            if (isNearBook && pokeCursorMesh) {
                pokeCursorMesh.position.copy(worldTip);
                pokeCursorMesh.quaternion.copy(camera.quaternion);
                pokeCursorMesh.visible = true;
                cursorActive = true;

                // Contact detection: localTip.z penetrating the page plane (surface at z ≈ 0.0105 - 0.014)
                const isContactingPlane = (localTip.z >= -0.015 && localTip.z <= 0.020);
                const isWithinBookBounds = (Math.abs(localTip.y) <= 0.115 && Math.abs(localTip.x) <= 0.165);

                // Highlight cursor when touching surface
                if (isContactingPlane && isWithinBookBounds) {
                    if (pokeCursorMesh.material) pokeCursorMesh.material.color.setHex(0xffb703);
                    pokeCursorMesh.scale.setScalar(1.35);
                } else {
                    if (pokeCursorMesh.material) pokeCursorMesh.material.color.setHex(0x00f0ff);
                    pokeCursorMesh.scale.setScalar(1.0);
                }

                // Poke Action Triggering
                if (isContactingPlane && isWithinBookBounds && directTouchCooldown <= 0) {
                    let pokeHit = false;

                    // A. NEXT PAGE POKE (Poking NEXT button OR Right Page Dog-Ear / Outer Margin)
                    const isNextBtnPoke = (localTip.x >= 0.075 && localTip.x <= 0.155 && localTip.y >= -0.108 && localTip.y <= -0.065);
                    const isRightCornerPoke = (localTip.x > 0.055 && localTip.y < -0.065);
                    const isRightEdgePoke = (localTip.x > 0.125 && Math.abs(localTip.y) < 0.10);

                    if (isNextBtnPoke || isRightCornerPoke || isRightEdgePoke) {
                        flipToNextPage();
                        triggerPokeHaptics();
                        if (nextBtnMesh && nextBtnMesh.userData) {
                            nextBtnMesh.userData.targetZ = nextBtnMesh.userData.baseZ - 0.005;
                            setTimeout(() => { if (nextBtnMesh) nextBtnMesh.userData.targetZ = nextBtnMesh.userData.baseZ; }, 140);
                        }
                        directTouchCooldown = 0.38;
                        pokeHit = true;
                    }

                    // B. PREVIOUS PAGE POKE (Poking PREV button OR Left Page Dog-Ear / Outer Margin)
                    if (!pokeHit) {
                        const isPrevBtnPoke = (localTip.x >= 0.005 && localTip.x <= 0.072 && localTip.y >= -0.108 && localTip.y <= -0.065);
                        const isLeftCornerPoke = (localTip.x < -0.055 && localTip.y < -0.065);
                        const isLeftEdgePoke = (localTip.x < -0.125 && Math.abs(localTip.y) < 0.10);

                        if (isPrevBtnPoke || isLeftCornerPoke || isLeftEdgePoke) {
                            flipToPrevPage();
                            triggerPokeHaptics();
                            if (prevBtnMesh && prevBtnMesh.userData) {
                                prevBtnMesh.userData.targetZ = prevBtnMesh.userData.baseZ - 0.005;
                                setTimeout(() => { if (prevBtnMesh) prevBtnMesh.userData.targetZ = prevBtnMesh.userData.baseZ; }, 140);
                            }
                            directTouchCooldown = 0.38;
                            pokeHit = true;
                        }
                    }

                    // C. 3D ACTIVE CONTROL BUTTONS (Right Page 4 Control Slots)
                    if (!pokeHit) {
                        for (const btn of pageButtonMeshes) {
                            if (!btn.visible || !btn.userData || !btn.userData.action) continue;
                            const dx = Math.abs(localTip.x - btn.position.x);
                            const dy = Math.abs(localTip.y - btn.position.y);
                            if (dx < 0.072 && dy < 0.019) {
                                btn.userData.targetZ = btn.userData.baseZ - 0.005;
                                setTimeout(() => {
                                    if (btn.userData) btn.userData.targetZ = btn.userData.baseZ;
                                }, 140);

                                trigger3DAction(btn.userData.action);
                                triggerPokeHaptics();
                                directTouchCooldown = 0.35;
                                pokeHit = true;
                                break;
                            }
                        }
                    }

                    // D. PIN BOOK BUTTON (Left Page Bottom)
                    if (!pokeHit && pinBtnMesh && pinBtnMesh.visible) {
                        const dx = Math.abs(localTip.x - pinBtnMesh.position.x);
                        const dy = Math.abs(localTip.y - pinBtnMesh.position.y);
                        if (dx < 0.072 && dy < 0.016) {
                            pinBtnMesh.userData.targetZ = pinBtnMesh.userData.baseZ - 0.005;
                            setTimeout(() => {
                                if (pinBtnMesh.userData) pinBtnMesh.userData.targetZ = pinBtnMesh.userData.baseZ;
                            }, 140);

                            trigger3DAction('toggle-book-pin');
                            triggerPokeHaptics();
                            directTouchCooldown = 0.35;
                            pokeHit = true;
                        }
                    }
                }

                // E. SWIPE / DRAG INTERACTION (Flicking across the page)
                if (isContactingPlane && isWithinBookBounds) {
                    if (lastPokeLocalX !== null && directTouchCooldown <= 0) {
                        const deltaX = localTip.x - lastPokeLocalX;
                        if (deltaX < -0.038) {
                            // Swiped Leftwards -> Turn to Next Page
                            flipToNextPage();
                            triggerPokeHaptics();
                            directTouchCooldown = 0.42;
                        } else if (deltaX > 0.038) {
                            // Swiped Rightwards -> Turn to Previous Page
                            flipToPrevPage();
                            triggerPokeHaptics();
                            directTouchCooldown = 0.42;
                        }
                    }
                    lastPokeLocalX = localTip.x;
                } else {
                    lastPokeLocalX = null;
                }

                if (cursorActive) break; // processed closest interacting pointer
            }
        }
    }

    if (!cursorActive && pokeCursorMesh) {
        pokeCursorMesh.visible = false;
        lastPokeLocalX = null;
    }
}

function onVRSelect(e) {
    const controller = e.target;
    const tempMatrix = new THREE.Matrix4();
    tempMatrix.identity().extractRotation(controller.matrixWorld);

    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    const intersects = raycaster.intersectObjects(interactiveObjects, true);
    if (intersects.length > 0) {
        let hitObj = intersects[0].object;
        while (hitObj && !hitObj.userData.action && hitObj.parent) {
            hitObj = hitObj.parent;
        }
        if (hitObj && hitObj.userData && hitObj.userData.action) {
            trigger3DAction(hitObj.userData.action);

            // Controller Haptic Pulse
            const session = renderer.xr.getSession();
            if (session) {
                for (const source of session.inputSources) {
                    if (source.gamepad && source.gamepad.hapticActuators && source.gamepad.hapticActuators[0]) {
                        try {
                            source.gamepad.hapticActuators[0].pulse(0.6, 50);
                        } catch (err) {}
                    }
                }
            }
        }
    }
}

controller1.addEventListener('select', onVRSelect);
controller2.addEventListener('select', onVRSelect);

// VR Thumbstick Movement, Snap Turn & Quest Button Shortcuts
let snapTurnCooldown = 0;
let buttonCooldown = 0;

function handleVRMovement(delta) {
    const session = renderer.xr.getSession();
    if (!session) return;

    buttonCooldown -= delta;

    for (const source of session.inputSources) {
        if (!source.gamepad) continue;
        const axes = source.gamepad.axes;
        const buttons = source.gamepad.buttons;

        // Thumbstick axes
        const stickX = axes[2] !== undefined ? axes[2] : (axes[0] || 0);
        const stickY = axes[3] !== undefined ? axes[3] : (axes[1] || 0);

        if (source.handedness === 'left') {
            // Left Stick: Move in facing direction
            if (Math.abs(stickX) > 0.12 || Math.abs(stickY) > 0.12) {
                const moveSpeed = 3.0 * delta;
                const camDir = new THREE.Vector3();
                camera.getWorldDirection(camDir);
                camDir.y = 0;
                camDir.normalize();

                const camSide = new THREE.Vector3().crossVectors(camDir, new THREE.Vector3(0, 1, 0)).normalize();

                xrRig.position.addScaledVector(camDir, -stickY * moveSpeed);
                xrRig.position.addScaledVector(camSide, stickX * moveSpeed);
            }

            // Left 'X' button: Toggle Emitter
            if (buttons[4] && buttons[4].pressed && buttonCooldown <= 0) {
                trigger3DAction('toggle-emitter');
                buttonCooldown = 0.35;
            }
            // Left 'Y' button or Menu button: Jump to Console Workstation
            if ((buttons[5]?.pressed || buttons[3]?.pressed) && buttonCooldown <= 0) {
                teleportToStation('console');
                buttonCooldown = 0.35;
            }
        } else if (source.handedness === 'right') {
            // Right Stick: Snap Turn (30 degrees)
            snapTurnCooldown -= delta;
            if (Math.abs(stickX) > 0.6 && snapTurnCooldown <= 0) {
                const angle = (stickX > 0 ? -1 : 1) * (Math.PI / 6);
                xrRig.rotateY(angle);
                snapTurnCooldown = 0.35;
            }

            // Right Stick Y: Smooth User Height Adjustment in VR
            if (Math.abs(stickY) > 0.25) {
                state.userHeightOffset = Math.max(-0.6, Math.min(2.5, state.userHeightOffset - stickY * delta * 1.2));
                xrRig.position.y = state.userHeightOffset;
                updateVRMenuTexture();
            }

            // Right 'A' button: Toggle Detector
            if (buttons[4] && buttons[4].pressed && buttonCooldown <= 0) {
                trigger3DAction('toggle-detector');
                buttonCooldown = 0.35;
            }
            // Right 'B' button: Jump to Console Workstation
            if (buttons[5] && buttons[5].pressed && buttonCooldown <= 0) {
                teleportToStation('console');
                buttonCooldown = 0.35;
            }
        }
    }
}

// =============================================================================
// APP VIEW ROUTER & NAVIGATION (PORTAL / EXPERIMENTS CATALOG / 3D SIM / THEORY)
// =============================================================================
function setAppView(view) {
    state.currentAppView = view;
    document.body.className = `app-mode-${view}`;

    const portalEl = document.getElementById('portal-view');
    const catalogEl = document.getElementById('experiments-catalog-view');
    const hudEl = document.getElementById('experiment-hud');
    const theoryEl = document.getElementById('theory-view');

    const isPortal = (view === 'portal');
    const isCatalog = (view === 'experiments');
    const isExperiment = (view === 'experiment' || view === 'experiment-ydse');
    const isTheory = (view === 'theory');

    if (portalEl) {
        portalEl.classList.toggle('active', isPortal);
        portalEl.classList.toggle('hidden', !isPortal);
    }
    if (catalogEl) {
        catalogEl.classList.toggle('active', isCatalog);
        catalogEl.classList.toggle('hidden', !isCatalog);
    }
    if (hudEl) {
        hudEl.classList.toggle('hidden', !isExperiment);
    }
    if (theoryEl) {
        theoryEl.classList.toggle('hidden', !isTheory);
    }

    // Update Nav Tabs
    document.getElementById('nav-tab-portal')?.classList.toggle('active', isPortal);
    document.getElementById('nav-tab-portal')?.setAttribute('aria-selected', isPortal);

    document.getElementById('nav-tab-experiment')?.classList.toggle('active', isCatalog || isExperiment);
    document.getElementById('nav-tab-experiment')?.setAttribute('aria-selected', isCatalog || isExperiment);

    document.getElementById('nav-tab-theory')?.classList.toggle('active', isTheory);
    document.getElementById('nav-tab-theory')?.setAttribute('aria-selected', isTheory);

    ensureAudio();

    if (isExperiment) {
        updateVisualState();
        updateHUDStats();
        updateIntensityGraph();
    } else if (isTheory) {
        updateTheoryCalculator();
    } else if (isPortal || isCatalog) {
        if (!renderer.xr.isPresenting && !isCameraTransitioning) {
            switchCameraView('overview');
        }
    }
}

// =============================================================================
// THEORY INTERACTIVE MODULES & CALCULATOR
// =============================================================================
const theoryFringeCanvas = document.getElementById('theory-fringe-canvas');
const theoryFringeCtx = theoryFringeCanvas ? theoryFringeCanvas.getContext('2d') : null;

function updateTheoryCalculator() {
    const wlInput = document.getElementById('theory-slider-wl');
    const slitInput = document.getElementById('theory-slider-slit');
    const distInput = document.getElementById('theory-slider-dist');
    const widthInput = document.getElementById('theory-slider-width');

    if (!wlInput || !slitInput || !distInput || !widthInput) return;

    const lambdaNm = parseFloat(wlInput.value); // nm
    const dMm = parseFloat(slitInput.value);     // mm
    const DM = parseFloat(distInput.value);       // m
    const aMm = parseFloat(widthInput.value);    // mm

    const valWl = document.getElementById('theory-val-wl');
    const valSlit = document.getElementById('theory-val-slit');
    const valDist = document.getElementById('theory-val-dist');
    const valWidth = document.getElementById('theory-val-width');

    if (valWl) valWl.textContent = `${lambdaNm} nm`;
    if (valSlit) valSlit.textContent = `${dMm.toFixed(2)} mm`;
    if (valDist) valDist.textContent = `${DM.toFixed(2)} m`;
    if (valWidth) valWidth.textContent = `${aMm.toFixed(2)} mm`;

    // Fringe Width beta = (lambda * D) / d
    const betaMm = ((lambdaNm * 1e-9 * DM) / (dMm * 1e-3)) * 1000;
    const centralEnvelopeMm = ((2 * lambdaNm * 1e-9 * DM) / (aMm * 1e-3)) * 1000;
    const y1Mm = betaMm / 2;
    const numFringes = Math.max(1, Math.round((2 * dMm) / aMm) - 1);

    const calcFringe = document.getElementById('theory-calc-fringe');
    const metricBeta = document.getElementById('theory-metric-beta');
    const metricEnv = document.getElementById('theory-metric-envelope');
    const metricY1 = document.getElementById('theory-metric-y1');
    const metricFringes = document.getElementById('theory-metric-fringes');

    if (calcFringe) calcFringe.textContent = betaMm.toFixed(2);
    if (metricBeta) metricBeta.textContent = `${betaMm.toFixed(3)} mm`;
    if (metricEnv) metricEnv.textContent = `${centralEnvelopeMm.toFixed(2)} mm`;
    if (metricY1) metricY1.textContent = `±${y1Mm.toFixed(3)} mm`;
    if (metricFringes) metricFringes.textContent = `~${numFringes} bands`;

    const topFringe = document.getElementById('val-fringe-width-top');
    if (topFringe) topFringe.textContent = `${betaMm.toFixed(2)} mm`;

    // Render Canvas
    if (!theoryFringeCtx || !theoryFringeCanvas) return;
    const w = theoryFringeCanvas.width;
    const h = theoryFringeCanvas.height;

    theoryFringeCtx.fillStyle = '#03060e';
    theoryFringeCtx.fillRect(0, 0, w, h);

    const patternH = 80;
    const rgb = wavelengthToRGB(lambdaNm);

    // 1. Draw 2D Optical Laser Interference Pattern (Matching real laser double-slit screen)
    const lut = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        const I = i / 255.0;
        if (I <= 0.003) {
            lut[i] = 0xff000000;
            continue;
        }
        const lum = Math.pow(I, 0.85);
        let r = rgb.r * lum;
        let g = rgb.g * lum;
        let b = rgb.b * lum;
        if (lum > 0.60) {
            const core = Math.pow((lum - 0.60) / 0.40, 1.6);
            r = r + (255 - r) * core * 0.60;
            g = g + (255 - g) * core * 0.60;
            b = b + (255 - b) * core * 0.60;
        }
        lut[i] = (255 << 24) | (Math.min(255, Math.round(b)) << 16) | (Math.min(255, Math.round(g)) << 8) | Math.min(255, Math.round(r));
    }

    const Ix = new Float32Array(w);
    const spanMm = 6.0; // +/- 3mm span
    for (let px = 0; px < w; px++) {
        const yMm = ((px / w) * 2 - 1) * (spanMm / 2);
        const yM = yMm * 1e-3;
        const betaPhase = (Math.PI * (dMm * 1e-3) * yM) / (lambdaNm * 1e-9 * DM);
        const alpha = (Math.PI * (aMm * 1e-3) * yM) / (lambdaNm * 1e-9 * DM);
        const sinc = alpha === 0 ? 1 : Math.sin(alpha) / alpha;
        Ix[px] = Math.cos(betaPhase) * Math.cos(betaPhase) * (sinc * sinc);
    }

    const Iy = new Float32Array(patternH);
    for (let py = 0; py < patternH; py++) {
        const v = (py - patternH / 2) / (patternH / 2);
        Iy[py] = Math.exp(-(v * v) / (2 * 0.38 * 0.38)) * Math.max(0, 1 - Math.pow(v, 6));
    }

    const imgData = theoryFringeCtx.createImageData(w, patternH);
    const buf32 = new Uint32Array(imgData.data.buffer);
    for (let py = 0; py < patternH; py++) {
        const vy = Iy[py];
        const row = py * w;
        for (let px = 0; px < w; px++) {
            const idx = Math.min(255, Math.max(0, Math.floor(Ix[px] * vy * 255)));
            buf32[row + px] = lut[idx];
        }
    }
    theoryFringeCtx.putImageData(imgData, 0, 0);

    // Divider line between 2D optical pattern and 1D cross-section curve
    theoryFringeCtx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    theoryFringeCtx.lineWidth = 1;
    theoryFringeCtx.beginPath();
    theoryFringeCtx.moveTo(0, patternH + 2);
    theoryFringeCtx.lineTo(w, patternH + 2);
    theoryFringeCtx.stroke();

    // Axes & grid lines for bottom graph
    theoryFringeCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    theoryFringeCtx.beginPath();
    theoryFringeCtx.moveTo(w / 2, patternH + 2);
    theoryFringeCtx.lineTo(w / 2, h);
    theoryFringeCtx.moveTo(0, h - 22);
    theoryFringeCtx.lineTo(w, h - 22);
    theoryFringeCtx.stroke();

    // Plot Envelope (diffraction sinc^2) in dashed amber
    theoryFringeCtx.beginPath();
    theoryFringeCtx.strokeStyle = 'rgba(255, 183, 3, 0.55)';
    theoryFringeCtx.setLineDash([4, 4]);
    theoryFringeCtx.lineWidth = 1.5;

    const graphTop = patternH + 6;
    const graphBottom = h - 22;
    const graphHeight = graphBottom - graphTop;

    for (let px = 0; px < w; px++) {
        const yMm = ((px / w) * 2 - 1) * (spanMm / 2);
        const yM = yMm * 1e-3;
        const alpha = (Math.PI * (aMm * 1e-3) * yM) / (lambdaNm * 1e-9 * DM);
        const sinc = alpha === 0 ? 1 : Math.sin(alpha) / alpha;
        const env = sinc * sinc;

        const plotY = graphBottom - env * graphHeight;
        if (px === 0) theoryFringeCtx.moveTo(px, plotY);
        else theoryFringeCtx.lineTo(px, plotY);
    }
    theoryFringeCtx.stroke();
    theoryFringeCtx.setLineDash([]);

    // Plot Full Theoretical Intensity Curve with respective spectral color
    theoryFringeCtx.beginPath();
    theoryFringeCtx.strokeStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
    theoryFringeCtx.lineWidth = 2.2;
    theoryFringeCtx.shadowColor = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)`;
    theoryFringeCtx.shadowBlur = 8;

    for (let px = 0; px < w; px++) {
        const plotY = graphBottom - Ix[px] * graphHeight;
        if (px === 0) theoryFringeCtx.moveTo(px, plotY);
        else theoryFringeCtx.lineTo(px, plotY);
    }
    theoryFringeCtx.stroke();
    theoryFringeCtx.shadowBlur = 0;

    // Axis Labels
    theoryFringeCtx.fillStyle = '#64748b';
    theoryFringeCtx.font = '10px JetBrains Mono, monospace';
    theoryFringeCtx.fillText('-3 mm', 8, h - 7);
    theoryFringeCtx.fillText('Center (y=0)', w / 2 - 32, h - 7);
    theoryFringeCtx.fillText('+3 mm', w - 44, h - 7);
}

// 2D Wave vs Particle Simulator inside Theory (Chapter 2)
const theoryWaveCanvas = document.getElementById('theory-wave-canvas');
const theoryWaveCtx = theoryWaveCanvas ? theoryWaveCanvas.getContext('2d') : null;
let theoryObserverActive = false;
let theorySimTime = 0;

function drawTheoryWaveSim() {
    if (!theoryWaveCtx || !theoryWaveCanvas || state.currentAppView !== 'theory') return;

    const w = theoryWaveCanvas.width;
    const h = theoryWaveCanvas.height;

    theoryWaveCtx.fillStyle = '#03060d';
    theoryWaveCtx.fillRect(0, 0, w, h);

    const slitX = 90;
    const screenX = w - 40;
    const slitSpacing = 44;
    const s1Y = h / 2 - slitSpacing / 2;
    const s2Y = h / 2 + slitSpacing / 2;

    // Source Beam Emitter on Left
    theoryWaveCtx.fillStyle = '#00f0ff';
    theoryWaveCtx.fillRect(10, h / 2 - 6, 30, 12);
    theoryWaveCtx.beginPath();
    theoryWaveCtx.strokeStyle = 'rgba(0, 240, 255, 0.4)';
    theoryWaveCtx.lineWidth = 2;
    for (let x = 40; x < slitX; x += 12) {
        const offset = (theorySimTime * 60) % 12;
        theoryWaveCtx.moveTo(x + offset, h / 2 - 20);
        theoryWaveCtx.lineTo(x + offset, h / 2 + 20);
    }
    theoryWaveCtx.stroke();

    // Slit Barrier
    theoryWaveCtx.fillStyle = '#1e293b';
    theoryWaveCtx.fillRect(slitX - 6, 0, 12, s1Y - 8);
    theoryWaveCtx.fillRect(slitX - 6, s1Y + 8, 12, s2Y - s1Y - 16);
    theoryWaveCtx.fillRect(slitX - 6, s2Y + 8, 12, h - (s2Y + 8));

    // Slit Aperture Glows
    theoryWaveCtx.fillStyle = theoryObserverActive ? '#ff2d87' : '#00f0ff';
    theoryWaveCtx.beginPath();
    theoryWaveCtx.arc(slitX, s1Y, 4, 0, Math.PI * 2);
    theoryWaveCtx.arc(slitX, s2Y, 4, 0, Math.PI * 2);
    theoryWaveCtx.fill();

    // If Observer Active, draw detector badge
    if (theoryObserverActive) {
        theoryWaveCtx.fillStyle = '#ff2d87';
        theoryWaveCtx.font = 'bold 12px Outfit, sans-serif';
        theoryWaveCtx.fillText('👁️ OBSERVER ACTIVE', slitX - 25, s1Y - 14);
    }

    if (!theoryObserverActive) {
        // Wave Superposition: concentric ripples
        const k = 0.18;
        const omega = 4.0;
        const t = theorySimTime;

        const step = 4;
        for (let x = slitX + 6; x < screenX; x += step) {
            for (let y = 10; y < h - 10; y += step) {
                const r1 = Math.hypot(x - slitX, y - s1Y);
                const r2 = Math.hypot(x - slitX, y - s2Y);

                const psi1 = Math.sin(k * r1 - omega * t) / Math.sqrt(r1 * 0.1 + 1);
                const psi2 = Math.sin(k * r2 - omega * t) / Math.sqrt(r2 * 0.1 + 1);
                const totalPsi = psi1 + psi2;
                const intensity = (totalPsi * totalPsi) * 0.25;

                if (intensity > 0.08) {
                    const alpha = Math.min(1.0, intensity * 0.85);
                    theoryWaveCtx.fillStyle = `rgba(0, 240, 255, ${alpha.toFixed(2)})`;
                    theoryWaveCtx.fillRect(x, y, step, step);
                }
            }
        }
    } else {
        // Observer ON: Collimated classical rays
        const t = theorySimTime * 1.5;
        theoryWaveCtx.fillStyle = 'rgba(255, 45, 135, 0.85)';
        for (let i = 0; i < 24; i++) {
            const seed = (i * 137.5) % 1;
            const chosenSlitY = i % 2 === 0 ? s1Y : s2Y;
            const progress = (t + seed) % 1.0;
            const x = slitX + progress * (screenX - slitX);
            const spread = (Math.sin(i * 99) * 14) * progress;
            const y = chosenSlitY + spread;

            theoryWaveCtx.beginPath();
            theoryWaveCtx.arc(x, y, 2.5, 0, Math.PI * 2);
            theoryWaveCtx.fill();
        }
    }

    // Phosphor Screen on Right
    theoryWaveCtx.fillStyle = '#091510';
    theoryWaveCtx.strokeStyle = 'rgba(0, 255, 136, 0.4)';
    theoryWaveCtx.lineWidth = 2;
    theoryWaveCtx.fillRect(screenX, 10, 14, h - 20);
    theoryWaveCtx.strokeRect(screenX, 10, 14, h - 20);

    // Profile curve on right screen
    theoryWaveCtx.beginPath();
    theoryWaveCtx.strokeStyle = theoryObserverActive ? '#ff2d87' : '#00ff88';
    theoryWaveCtx.lineWidth = 2;
    for (let y = 15; y < h - 15; y += 2) {
        const normY = (y - h / 2);
        let profile = 0;
        if (!theoryObserverActive) {
            const phase = (Math.PI * slitSpacing * normY) / 1200;
            profile = Math.cos(phase) * Math.cos(phase) * Math.exp(-Math.pow(normY / 55, 2));
        } else {
            const g1 = Math.exp(-Math.pow((y - s1Y) / 16, 2));
            const g2 = Math.exp(-Math.pow((y - s2Y) / 16, 2));
            profile = (g1 + g2) * 0.5;
        }
        const px = screenX + 14 + profile * 20;
        if (y === 15) theoryWaveCtx.moveTo(px, y);
        else theoryWaveCtx.lineTo(px, y);
    }
    theoryWaveCtx.stroke();
}

// =============================================================================
// DOM UI EVENT LISTENERS & BINDINGS
// =============================================================================
function initUIBindings() {
    // 1. Entrance Portal Launch Actions
    document.getElementById('btn-enter-experiment')?.addEventListener('click', () => setAppView('experiments'));
    document.getElementById('portal-card-experiment')?.addEventListener('click', () => setAppView('experiments'));
    document.getElementById('btn-enter-theory')?.addEventListener('click', () => setAppView('theory'));
    document.getElementById('portal-card-theory')?.addEventListener('click', () => setAppView('theory'));

    // 2. Experiments Catalog Actions
    document.getElementById('btn-enter-ydse')?.addEventListener('click', (e) => {
        e.stopPropagation();
        setAppView('experiment');
    });
    document.getElementById('card-exp-ydse')?.addEventListener('click', () => setAppView('experiment'));
    document.getElementById('btn-catalog-back-hub')?.addEventListener('click', () => setAppView('portal'));
    document.getElementById('btn-back-to-catalog')?.addEventListener('click', () => setAppView('experiments'));

    // 3. Global Navigation Header Tabs
    document.getElementById('nav-brand-home')?.addEventListener('click', () => setAppView('portal'));
    document.getElementById('nav-tab-portal')?.addEventListener('click', () => setAppView('portal'));
    document.getElementById('nav-tab-experiment')?.addEventListener('click', () => setAppView('experiments'));
    document.getElementById('nav-tab-theory')?.addEventListener('click', () => setAppView('theory'));

    // 4. Theory Sidebar & Chapter Switcher
    document.querySelectorAll('.chapter-nav-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const chapterNum = btn.dataset.chapter;
            if (!chapterNum) return;

            document.querySelectorAll('.chapter-nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            document.querySelectorAll('.theory-article').forEach(art => art.classList.remove('active'));
            const targetArt = document.getElementById(`chapter-${chapterNum}`);
            if (targetArt) targetArt.classList.add('active');

            if (chapterNum === '6') {
                updateTheoryCalculator();
            }
        });
    });

    document.getElementById('theory-btn-launch-lab')?.addEventListener('click', () => setAppView('experiment'));

    // 5. Theory Interactive Wave Observer Toggle
    document.getElementById('theory-toggle-state')?.addEventListener('click', () => {
        theoryObserverActive = !theoryObserverActive;
        const lbl = document.getElementById('theory-state-label');
        if (lbl) {
            lbl.textContent = theoryObserverActive ? 'ON (Which-Way Observer)' : 'OFF (Wave Superposition)';
            lbl.className = theoryObserverActive ? 'text-magenta' : 'text-cyan';
        }
    });

    // 6. Theory Calculator Sliders
    ['theory-slider-wl', 'theory-slider-slit', 'theory-slider-dist', 'theory-slider-width'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', updateTheoryCalculator);
    });

    // 7. Sync Theory Parameters to 3D Lab
    document.getElementById('theory-btn-sync-lab')?.addEventListener('click', () => {
        const wlInput = document.getElementById('theory-slider-wl');
        const slitInput = document.getElementById('theory-slider-slit');

        if (wlInput) {
            state.wavelength = parseFloat(wlInput.value);
            const sliderWl = document.getElementById('slider-wavelength');
            const valWl = document.getElementById('val-wavelength');
            if (sliderWl) sliderWl.value = state.wavelength;
            if (valWl) valWl.textContent = `${state.wavelength} nm`;
        }

        if (slitInput) {
            state.slitSeparation = parseFloat(slitInput.value);
            const sliderSlit = document.getElementById('slider-slit-dist');
            const valSlit = document.getElementById('val-slit-dist');
            if (sliderSlit) sliderSlit.value = state.slitSeparation;
            if (valSlit) valSlit.textContent = `${state.slitSeparation.toFixed(2)} mm`;
        }

        updateVisualState();
        setAppView('experiment');
    });

    // 8. Experiment Action Buttons
    document.getElementById('ui-btn-emitter')?.addEventListener('click', () => trigger3DAction('toggle-emitter'));
    document.getElementById('ui-btn-detector')?.addEventListener('click', () => trigger3DAction('toggle-detector'));
    document.getElementById('ui-btn-reset')?.addEventListener('click', () => trigger3DAction('reset-screen'));
    document.getElementById('btn-toggle-palm-book')?.addEventListener('click', () => togglePalmBookDesktop());

    // Sound Toggle
    document.getElementById('btn-sound-toggle')?.addEventListener('click', () => {
        ensureAudio();
        const muted = audio.toggleMute();
        document.getElementById('icon-sound-on')?.classList.toggle('hidden', muted);
        document.getElementById('icon-sound-off')?.classList.toggle('hidden', !muted);
    });

    // Guide Modal
    const modal = document.getElementById('modal-guide');
    document.getElementById('btn-guide-toggle')?.addEventListener('click', () => {
        modal?.classList.remove('hidden');
    });
    document.getElementById('btn-close-modal')?.addEventListener('click', () => {
        modal?.classList.add('hidden');
    });
    document.getElementById('btn-modal-got-it')?.addEventListener('click', () => {
        modal?.classList.add('hidden');
    });

    // Graph Collapse Button
    document.getElementById('btn-collapse-graph')?.addEventListener('click', () => {
        document.getElementById('intensity-panel')?.classList.toggle('collapsed');
    });

    // Camera View Buttons
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            if (view) switchCameraView(view);
        });
    });

    // Beam Mode Toggle
    document.getElementById('mode-stream')?.addEventListener('click', () => {
        state.beamMode = 'stream';
        document.getElementById('mode-stream')?.classList.add('active');
        document.getElementById('mode-single')?.classList.remove('active');
    });
    document.getElementById('mode-single')?.addEventListener('click', () => {
        state.beamMode = 'single';
        document.getElementById('mode-single')?.classList.add('active');
        document.getElementById('mode-stream')?.classList.remove('active');
    });

    // Experiment Sliders
    const rateSlider = document.getElementById('slider-rate');
    rateSlider?.addEventListener('input', (e) => {
        state.emissionRate = parseFloat(e.target.value);
        const valRate = document.getElementById('val-rate');
        if (valRate) valRate.textContent = `${state.emissionRate} /s`;
    });

    const wlSlider = document.getElementById('slider-wavelength');
    wlSlider?.addEventListener('input', (e) => {
        state.wavelength = parseFloat(e.target.value);
        const valWl = document.getElementById('val-wavelength');
        if (valWl) valWl.textContent = `${state.wavelength} nm`;
        updateVisualState();
    });

    const slitSlider = document.getElementById('slider-slit-dist');
    slitSlider?.addEventListener('input', (e) => {
        state.slitSeparation = parseFloat(e.target.value);
        const valSlit = document.getElementById('val-slit-dist');
        if (valSlit) valSlit.textContent = `${state.slitSeparation.toFixed(2)} mm`;
        updateVisualState();
    });

    const scaleSlider = document.getElementById('slider-user-scale');
    scaleSlider?.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.userScale = val;
        state.userHeightOffset = (val - 1.0) * 1.5;
        const valScale = document.getElementById('val-user-scale');
        if (valScale) valScale.textContent = `${val.toFixed(2)}x (${state.userHeightOffset >= 0 ? '+' : ''}${state.userHeightOffset.toFixed(2)}m)`;

        if (renderer.xr.isPresenting) {
            xrRig.position.y = state.userHeightOffset;
        }
    });
}

initUIBindings();
updateVisualState();
setAppView(state.currentAppView);

// =============================================================================
// WINDOW RESIZE
// =============================================================================
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    updateIntensityGraph();
    if (state.currentAppView === 'theory') {
        updateTheoryCalculator();
    }
});

// =============================================================================
// ANIMATION & RENDER LOOP
// =============================================================================
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
    const delta = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();

    // 1. Smooth Camera Movement
    updateCameraTransition(delta);

    // 2. Button Press Spring Animation
    ['emitter', 'detector', 'reset'].forEach(key => {
        if (buttonNodes[key] && buttonAnimState[key]) {
            const anim = buttonAnimState[key];
            anim.currentY += (anim.targetY - anim.currentY) * 0.25;
            buttonNodes[key].position.y = anim.baseY + anim.currentY;
        }
    });

    // 3. Dynamic Particle Simulation
    updateParticles(delta);

    // 4. Animate Holographic Teleport Pads
    updateTeleportPads(delta, elapsedTime);

    // 5. Ambient Dynamic Pulsing Lights
    if (state.emitterActive) {
        emitterLight.intensity = 2.6 + Math.sin(elapsedTime * 6.0) * 0.3;
    }
    if (state.detectorActive) {
        detectorLight.intensity = 3.2 + Math.sin(elapsedTime * 12.0) * 0.5;
    }

    // 6. Animate Theory Wave Canvas if Theory View Active
    if (state.currentAppView === 'theory') {
        theorySimTime += delta;
        drawTheoryWaveSim();
    }

    // 7. WebXR Controls & Rendering
    if (renderer.xr.isPresenting) {
        handleVRMovement(delta);
    } else {
        if (state.currentAppView === 'experiment' || state.currentAppView === 'experiment-ydse') {
            controls.update();
        }
    }

    // 8. Update 3D Quantum Palm Book (Gesture Detection, Flipping Physics, Animations)
    updatePalmBook(delta, elapsedTime);

    renderer.render(scene, camera);
});