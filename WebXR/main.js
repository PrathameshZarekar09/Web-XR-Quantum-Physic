import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

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
    screenDistance: 6.6,
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
camera.position.set(1.0, 2.7, 5.8);

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

// Reset XR Rig when entering VR session
renderer.xr.addEventListener('sessionstart', () => {
    xrRig.position.set(1.0, state.userHeightOffset, 4.0);
    xrRig.rotation.set(0, 0, 0);
    if (vrMenuRoot) {
        updateVRMenuTexture();
    }
});

renderer.xr.addEventListener('sessionend', () => {
    xrRig.position.set(0, 0, 0);
    setAppView(state.currentAppView);
});

// VR Button
const vrBtn = VRButton.createButton(renderer);
document.body.appendChild(vrBtn);

// Orbit Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(1.0, 2.1, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI / 2 - 0.02; // prevent going below floor
controls.minDistance = 0.5;
controls.maxDistance = 18;
controls.update();

// =============================================================================
// COMPREHENSIVE LABORATORY LIGHTING SETUP
// =============================================================================
const ambientLight = new THREE.AmbientLight(0xdbeafe, 1.15);
scene.add(ambientLight);

const hemisphereLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 1.35);
scene.add(hemisphereLight);

const mainSun = new THREE.DirectionalLight(0xffffff, 2.4);
mainSun.position.set(4, 9, 5);
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
fillLight.position.set(-6, 7, 4);
scene.add(fillLight);

// Overhead Optical Bench Spotlight
const benchSpot = new THREE.SpotLight(0xffffff, 3.2, 16, Math.PI / 3, 0.45, 1);
benchSpot.position.set(0, 5.5, 1.2);
benchSpot.target.position.set(0, 1.6, 0);
scene.add(benchSpot);
scene.add(benchSpot.target);

// Console Desk Task Light
const consoleSpot = new THREE.SpotLight(0x60a5fa, 2.0, 8, Math.PI / 4, 0.3);
consoleSpot.position.set(-1.5, 4.0, 2.5);
consoleSpot.target.position.set(-1.5, 1.4, 2.3);
scene.add(consoleSpot);
scene.add(consoleSpot.target);

// Dynamic Accent Lights
const emitterLight = new THREE.PointLight(0x00f0ff, 2.8, 4.5);
emitterLight.position.set(-3.1, 2.1, 0);
scene.add(emitterLight);

const detectorLight = new THREE.PointLight(0xff2d87, 0, 4.0);
detectorLight.position.set(3.0, 2.45, 0.5);
scene.add(detectorLight);

const screenGlowLight = new THREE.PointLight(0x00ff88, 1.6, 4.5);
screenGlowLight.position.set(6.38, 2.7, 0);
scene.add(screenGlowLight);

// Pendant Lamps
[-4, 0, 4].forEach(x => {
    const lampLight = new THREE.PointLight(0xffe8cc, 1.4, 8.0);
    lampLight.position.set(x, 4.2, -1.5);
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
        scene.add(modelRoot);

        // Screen spatial coordinates: cleanly separated apart from the optical bench and detector
        const SCREEN_X = 6.60;
        const dx = SCREEN_X - 5.30; // 1.30m separation offset

        // High-Tech Laboratory Floor Pedestal for the Separated Screen Station
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

        // Dual Heavy Vertical Support Columns
        const pillarMat = new THREE.MeshStandardMaterial({
            color: 0x223046,
            metalness: 0.8,
            roughness: 0.25
        });
        const leftPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 1.15, 24), pillarMat);
        leftPillar.position.set(0, 0.65, -0.5);
        leftPillar.castShadow = true;
        const rightPillar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 1.15, 24), pillarMat);
        rightPillar.position.set(0, 0.65, 0.5);
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

        scene.add(screenPedestalGroup);

        modelRoot.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;

                // Enhanced PBR Materials: Ensure rich lighting, reflection, and visible contrast
                if (child.material) {
                    child.material.envMapIntensity = 1.35;
                    child.material.needsUpdate = true;

                    if (child.material.isMeshStandardMaterial) {
                        // Prevent pitch-black surfaces on dark metallic parts
                        child.material.roughness = Math.max(0.28, Math.min(0.85, child.material.roughness));
                        child.material.metalness = Math.min(0.65, child.material.metalness);

                        // Brighten very dark materials for clear laboratory visibility
                        if (child.material.color) {
                            const hsl = {};
                            child.material.color.getHSL(hsl);
                            if (hsl.l < 0.12) {
                                child.material.color.setHSL(hsl.h, hsl.s, Math.max(0.18, hsl.l * 2.2));
                            }
                        }
                    }
                }

                // Interactive Buttons & Apparatus Nodes
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
                    // Apply dynamic phosphor canvas
                    child.material = screenMaterial;
                    child.castShadow = false;
                    // Position screen panel apart from the detector and optical bench
                    child.position.x = SCREEN_X - 0.005;
                } else if (child.name === 'Screen_Stand') {
                    // Position the heavy stand apart alongside the screen panel
                    child.position.x = SCREEN_X;
                } else if (child.name.startsWith('Screen_Frame_')) {
                    // Move all outer framing edges flush around the newly positioned screen
                    child.position.x = 5.16 + dx;
                } else if (child.name === 'Screen_Label') {
                    // Move overhead screen identification label
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
                    // Position and scale beam cylinder so it starts at emitter and terminates cleanly at the separated screen
                    child.position.x = 1.68;
                    child.scale.set(1, 1.136, 1);
                } else if (child.name.startsWith('SlitGlow_')) {
                    buttonNodes.slitGlows.push(child);
                    child.material = new THREE.MeshBasicMaterial({
                        color: 0x00ff88,
                        transparent: true,
                        opacity: 0.8,
                        blending: THREE.AdditiveBlending
                    });
                } else if (child.name.startsWith('InterferenceBand_')) {
                    // Rectangular pattern bands cleanly positioned in front of screen panel with zero clipping
                    buttonNodes.bands.push(child);
                    child.material = new THREE.MeshBasicMaterial({
                        color: 0x00ff88,
                        transparent: true,
                        opacity: 0.75,
                        blending: THREE.AdditiveBlending,
                        depthWrite: false
                    });
                    child.position.x = 5.15 + dx - 0.005;
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

const particleGroup = new THREE.Group();
scene.add(particleGroup);

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
        startY: 2.1,
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

    // Emitter Aperture Position: x = -3.1, y = 2.1, z = 0
    p.mesh.position.set(-3.1, 2.1, 0);
}

function updateParticles(delta) {
    const spawnInterval = 1000 / state.emissionRate;
    const now = performance.now();

    if (state.emitterActive && now - lastSpawnTime > spawnInterval) {
        spawnParticle();
        lastSpawnTime = now;
    }

    // Update active particles along 3-stage path:
    // Stage 1: Emitter (x = -3.1) -> Slit Barrier (x = 0)
    // Stage 2: Slit Barrier (x = 0) -> Screen Panel (x = 5.25)
    for (let i = 0; i < particlesPool.length; i++) {
        const p = particlesPool[i];
        if (!p.active) continue;

        p.progress += p.speed * (delta * 60);

        if (p.progress >= 1.0) {
            // Impact Screen!
            recordScreenHit(p.targetNormZ, p.targetNormY);
            p.active = false;
            p.mesh.visible = false;
            updateHUDStats();
            continue;
        }

        let posX, posY, posZ;
        const xEmitter = -3.1;
        const xSlits = 0.0;
        const xScreen = 6.475;

        if (p.progress < 0.35) {
            // Stage 1: Heading toward slits
            const t = p.progress / 0.35;
            posX = THREE.MathUtils.lerp(xEmitter, xSlits, t);
            posY = 2.1 + Math.sin(t * Math.PI) * 0.02;
            posZ = (Math.random() - 0.5) * 0.04;
        } else {
            // Stage 2: Passing through slits and traveling to screen
            const t = (p.progress - 0.35) / 0.65;
            posX = THREE.MathUtils.lerp(xSlits, xScreen, t);

            const targetWorldZ = p.targetNormZ * 1.5;
            const targetWorldY = 2.7 + p.targetNormY * 1.1;

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
            posY = THREE.MathUtils.lerp(2.1, targetWorldY, t);
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
const teleportStations = {
    overview: {
        id: 'overview',
        name: 'Lab Overview',
        vrPos: new THREE.Vector3(1.0, 0, 4.0),
        camPos: new THREE.Vector3(1.0, 2.7, 5.8),
        target: new THREE.Vector3(1.0, 2.1, 0)
    },
    console: {
        id: 'console',
        name: 'Control Desk',
        vrPos: new THREE.Vector3(-1.5, 0, 3.2),
        camPos: new THREE.Vector3(-1.5, 2.3, 3.2),
        target: new THREE.Vector3(-1.5, 1.9, 0.5)
    },
    emitter: {
        id: 'emitter',
        name: 'Quantum Emitter',
        vrPos: new THREE.Vector3(-3.2, 0, 1.5),
        camPos: new THREE.Vector3(-3.4, 2.5, 2.2),
        target: new THREE.Vector3(-3.8, 2.1, 0)
    },
    beamline: {
        id: 'beamline',
        name: 'Beamline POV',
        vrPos: new THREE.Vector3(-4.8, 0, 1.2),
        camPos: new THREE.Vector3(-5.4, 2.2, 0),
        target: new THREE.Vector3(6.6, 2.1, 0)
    },
    slits: {
        id: 'slits',
        name: 'Double Slits',
        vrPos: new THREE.Vector3(0, 0, 1.4),
        camPos: new THREE.Vector3(0.3, 2.7, 1.6),
        target: new THREE.Vector3(0, 2.1, 0)
    },
    detector: {
        id: 'detector',
        name: 'Which-Way Detector',
        vrPos: new THREE.Vector3(2.8, 0, 1.6),
        camPos: new THREE.Vector3(2.3, 2.6, 1.9),
        target: new THREE.Vector3(3.0, 2.1, 0)
    },
    screen: {
        id: 'screen',
        name: 'Phosphor Screen',
        vrPos: new THREE.Vector3(5.4, 0, 2.2),
        camPos: new THREE.Vector3(4.5, 2.7, 2.8),
        target: new THREE.Vector3(6.5, 2.7, 0)
    },
    screen_front: {
        id: 'screen_front',
        name: 'Target Frontal',
        vrPos: new THREE.Vector3(5.0, 0, 1.2),
        camPos: new THREE.Vector3(4.8, 2.7, 0),
        target: new THREE.Vector3(6.6, 2.7, 0)
    },
    chalkboard: {
        id: 'chalkboard',
        name: 'Theory Blackboard',
        vrPos: new THREE.Vector3(0, 0, -3.8),
        camPos: new THREE.Vector3(0, 2.5, -2.6),
        target: new THREE.Vector3(0, 3.6, -5.6)
    },
    rear: {
        id: 'rear',
        name: 'Rear Lab Angle',
        vrPos: new THREE.Vector3(0.8, 0, -2.6),
        camPos: new THREE.Vector3(0.8, 2.7, -3.8),
        target: new THREE.Vector3(0.8, 2.0, 0.5)
    },
    storage: {
        id: 'storage',
        name: 'Equipment Corner',
        vrPos: new THREE.Vector3(4.8, 0, 4.4),
        camPos: new THREE.Vector3(5.2, 2.5, 4.8),
        target: new THREE.Vector3(1.5, 2.0, 0.5)
    },
    aerial: {
        id: 'aerial',
        name: 'Balcony Overview',
        vrPos: new THREE.Vector3(1.0, 0, 5.0),
        camPos: new THREE.Vector3(2.2, 5.0, 6.2),
        target: new THREE.Vector3(0.8, 1.8, 0)
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
}

// =============================================================================
// IN-VR 3D STATIONARY EXPERIMENT CONTROLLER WORKSTATION
// =============================================================================
let vrMenuRoot = null;
let vrMenuTexture = null;
let vrMenuCanvas = null;
let vrMenuCtx = null;
const vrInteractiveButtons = [];

function createVRInGameMenu() {
    vrMenuRoot = new THREE.Group();
    vrMenuRoot.name = 'VR_Stationary_Controller';

    // 1. High Resolution Canvas UI for VR Terminal Display
    vrMenuCanvas = document.createElement('canvas');
    vrMenuCanvas.width = 1024;
    vrMenuCanvas.height = 512;
    vrMenuCtx = vrMenuCanvas.getContext('2d');

    vrMenuTexture = new THREE.CanvasTexture(vrMenuCanvas);
    vrMenuTexture.generateMipmaps = true;
    vrMenuTexture.minFilter = THREE.LinearMipmapLinearFilter;

    // 2. 3D Terminal Screen Panel
    const panelGeo = new THREE.PlaneGeometry(1.2, 0.6);
    const panelMat = new THREE.MeshStandardMaterial({
        map: vrMenuTexture,
        transparent: true,
        roughness: 0.2,
        metalness: 0.1,
        emissive: 0x061525,
        emissiveMap: vrMenuTexture,
        emissiveIntensity: 0.85,
        side: THREE.DoubleSide
    });
    const panelMesh = new THREE.Mesh(panelGeo, panelMat);
    vrMenuRoot.add(panelMesh);

    // Frame border for terminal
    const frameGeo = new THREE.BoxGeometry(1.24, 0.64, 0.02);
    const frameMat = new THREE.MeshStandardMaterial({
        color: 0x0a1628,
        roughness: 0.3,
        metalness: 0.85
    });
    const frameMesh = new THREE.Mesh(frameGeo, frameMat);
    frameMesh.position.z = -0.012;
    vrMenuRoot.add(frameMesh);

    // Physical Pedestal Stand grounding the terminal permanently at the console
    const standMat = new THREE.MeshStandardMaterial({
        color: 0x141f32,
        roughness: 0.35,
        metalness: 0.75
    });
    const columnMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 1.45, 16), standMat);
    columnMesh.position.set(0, -0.72, -0.02);
    vrMenuRoot.add(columnMesh);

    const basePlate = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.04, 24), standMat);
    basePlate.position.set(0, -1.45, -0.02);
    vrMenuRoot.add(basePlate);

    // 3. Helper to create interactive 3D Buttons on the terminal
    function addVRButton(x, y, w, h, action, label, colorHex = 0x00f0ff) {
        const btnGeo = new THREE.PlaneGeometry(w, h);
        const btnMat = new THREE.MeshBasicMaterial({
            color: colorHex,
            transparent: true,
            opacity: 0.01,
            side: THREE.DoubleSide
        });
        const btnMesh = new THREE.Mesh(btnGeo, btnMat);
        btnMesh.position.set(x, y, 0.008);
        btnMesh.userData = { action, label };
        vrMenuRoot.add(btnMesh);
        interactiveObjects.push(btnMesh);
        vrInteractiveButtons.push({ mesh: btnMesh, action, label });
    }

    // Top Row: Navigation (Home / Hub, Catalog, Theory)
    addVRButton(-0.38, 0.18, 0.32, 0.1, 'exit-vr-to-hub', '🏠 Return to Portal Hub', 0x00f0ff);
    addVRButton(0.0, 0.18, 0.32, 0.1, 'exit-vr-to-catalog', '🔬 Experiments Catalog', 0xa855f7);
    addVRButton(0.38, 0.18, 0.32, 0.1, 'exit-vr-to-theory', '📚 Quantum Theory', 0xff2d87);

    // Middle Row: Core Controls (Emitter, Detector, Reset, Mode)
    addVRButton(-0.42, 0.04, 0.24, 0.09, 'toggle-emitter', '⚡ Emitter Toggle', 0x00f0ff);
    addVRButton(-0.14, 0.04, 0.28, 0.09, 'toggle-detector', '👁️ Detector Toggle', 0xff2d87);
    addVRButton(0.16, 0.04, 0.24, 0.09, 'reset-screen', '🔄 Clear Screen', 0xffb703);
    addVRButton(0.42, 0.04, 0.22, 0.09, 'toggle-beam-mode', '🌊 Beam Mode', 0x00ff88);

    // Station Teleport Row 1 (Apparatus Line)
    addVRButton(-0.475, -0.05, 0.17, 0.065, 'teleport-overview', 'Teleport: Overview', 0x00f0ff);
    addVRButton(-0.285, -0.05, 0.17, 0.065, 'teleport-console', 'Teleport: Console', 0x00f0ff);
    addVRButton(-0.095, -0.05, 0.17, 0.065, 'teleport-emitter', 'Teleport: Emitter', 0x00f0ff);
    addVRButton(0.095, -0.05, 0.17, 0.065, 'teleport-beamline', 'Teleport: Beamline', 0x00f0ff);
    addVRButton(0.285, -0.05, 0.17, 0.065, 'teleport-slits', 'Teleport: Slits', 0x00f0ff);
    addVRButton(0.475, -0.05, 0.17, 0.065, 'teleport-detector', 'Teleport: Detector', 0x00f0ff);

    // Station Teleport Row 2 (Target & Environment)
    addVRButton(-0.475, -0.13, 0.17, 0.065, 'teleport-screen', 'Teleport: Screen', 0x00f0ff);
    addVRButton(-0.285, -0.13, 0.17, 0.065, 'teleport-screen_front', 'Teleport: Target Front', 0x00f0ff);
    addVRButton(-0.095, -0.13, 0.17, 0.065, 'teleport-chalkboard', 'Teleport: Chalkboard', 0x00f0ff);
    addVRButton(0.095, -0.13, 0.17, 0.065, 'teleport-rear', 'Teleport: Rear Lab', 0x00f0ff);
    addVRButton(0.285, -0.13, 0.17, 0.065, 'teleport-storage', 'Teleport: Storage', 0x00f0ff);
    addVRButton(0.475, -0.13, 0.17, 0.065, 'teleport-aerial', 'Teleport: Balcony', 0x00f0ff);

    // Bottom Row: Eye Level & Teleport Shortcuts
    addVRButton(-0.35, -0.22, 0.24, 0.075, 'vr-height-up', '▲ Raise Eye Level', 0x00f0ff);
    addVRButton(-0.08, -0.22, 0.24, 0.075, 'vr-height-down', '▼ Lower Eye Level', 0x00f0ff);
    addVRButton(0.18, -0.22, 0.22, 0.075, 'vr-height-reset', '⟲ Reset Height', 0x94a3b8);
    addVRButton(0.42, -0.22, 0.22, 0.075, 'teleport-overview', '🔭 Lab Overview', 0x00f0ff);

    // Permanent Stationary Location: Separately in the corner near the experiment control desk
    vrMenuRoot.position.set(-3.6, 1.45, 2.6);
    vrMenuRoot.rotation.set(0, 0.45, 0);
    scene.add(vrMenuRoot);

    updateVRMenuTexture();
}

function updateVRMenuTexture() {
    if (!vrMenuCtx || !vrMenuCanvas) return;
    const w = vrMenuCanvas.width;
    const h = vrMenuCanvas.height;

    // Background Cyber Glass Panel
    vrMenuCtx.fillStyle = 'rgba(8, 14, 28, 0.95)';
    vrMenuCtx.fillRect(0, 0, w, h);

    // Outer Glow Border
    vrMenuCtx.strokeStyle = '#00f0ff';
    vrMenuCtx.lineWidth = 4;
    vrMenuCtx.strokeRect(6, 6, w - 12, h - 12);

    // Header Bar
    vrMenuCtx.fillStyle = 'rgba(0, 240, 255, 0.12)';
    vrMenuCtx.fillRect(10, 10, w - 20, 50);

    vrMenuCtx.font = 'bold 22px Outfit, sans-serif';
    vrMenuCtx.fillStyle = '#00f0ff';
    vrMenuCtx.textAlign = 'left';
    vrMenuCtx.fillText('⚡ QUANTUM XR — VR EXPERIMENT CONTROLLER', 25, 42);

    // Status Badge Top Right
    vrMenuCtx.textAlign = 'right';
    if (state.detectorActive) {
        vrMenuCtx.fillStyle = '#ff2d87';
        vrMenuCtx.fillText('👁️ OBSERVED (Wavefunction Collapsed)', w - 25, 42);
    } else {
        vrMenuCtx.fillStyle = '#00ff88';
        vrMenuCtx.fillText('🌊 WAVE SUPERPOSITION (Interference)', w - 25, 42);
    }

    // SECTION 1: PRIMARY NAVIGATION BUTTONS (Top Row)
    drawVRCanvasButton(25, 75, 290, 75, '🏠 EXIT VR TO HUB', '#00f0ff', 'rgba(0, 240, 255, 0.2)');
    drawVRCanvasButton(340, 75, 340, 75, '🔬 ALL EXPERIMENTS', '#a855f7', 'rgba(168, 85, 247, 0.2)');
    drawVRCanvasButton(705, 75, 294, 75, '📚 QUANTUM THEORY', '#ff2d87', 'rgba(255, 45, 135, 0.2)');

    // SECTION 2: SIMULATION CONTROLS (Middle Row)
    const emitterLabel = state.emitterActive ? '⚡ EMITTER: ON' : '⚡ EMITTER: OFF';
    const emitterColor = state.emitterActive ? '#00f0ff' : '#64748b';
    drawVRCanvasButton(25, 175, 220, 65, emitterLabel, emitterColor, state.emitterActive ? 'rgba(0, 240, 255, 0.25)' : 'rgba(100, 116, 139, 0.2)');

    const detectorLabel = state.detectorActive ? '👁️ DETECTOR: ON' : '👁️ DETECTOR: OFF';
    const detectorColor = state.detectorActive ? '#ff2d87' : '#64748b';
    drawVRCanvasButton(265, 175, 250, 65, detectorLabel, detectorColor, state.detectorActive ? 'rgba(255, 45, 135, 0.25)' : 'rgba(100, 116, 139, 0.2)');

    drawVRCanvasButton(535, 175, 220, 65, '🔄 CLEAR SCREEN', '#ffb703', 'rgba(255, 183, 3, 0.2)');

    const modeLabel = state.beamMode === 'stream' ? '🌊 MODE: STREAM' : '🎯 MODE: SINGLE';
    drawVRCanvasButton(775, 175, 224, 65, modeLabel, '#00ff88', 'rgba(0, 255, 136, 0.2)');

    // SECTION 3: TELEPORTATION PRESETS (Row 3 & 4)
    vrMenuCtx.font = 'bold 13px Outfit, sans-serif';
    vrMenuCtx.fillStyle = '#94a3b8';
    vrMenuCtx.textAlign = 'left';
    vrMenuCtx.fillText('TELEPORT STATIONS — APPARATUS & FACILITY:', 25, 256);

    const stationsListRow1 = [
        { name: 'Overview', x: 25, w: 146 },
        { name: 'Console', x: 187, w: 146 },
        { name: 'Emitter', x: 349, w: 146 },
        { name: 'Beamline', x: 511, w: 146 },
        { name: 'Slits', x: 673, w: 146 },
        { name: 'Detector', x: 835, w: 164 }
    ];

    stationsListRow1.forEach(st => {
        drawVRCanvasButton(st.x, 268, st.w, 46, st.name, '#00f0ff', 'rgba(0, 240, 255, 0.15)', 14);
    });

    const stationsListRow2 = [
        { name: 'Screen', x: 25, w: 146 },
        { name: 'Target Front', x: 187, w: 146 },
        { name: 'Chalkboard', x: 349, w: 146 },
        { name: 'Rear Lab', x: 511, w: 146 },
        { name: 'Storage', x: 673, w: 146 },
        { name: 'Balcony', x: 835, w: 164 }
    ];

    stationsListRow2.forEach(st => {
        drawVRCanvasButton(st.x, 322, st.w, 46, st.name, '#00f0ff', 'rgba(0, 240, 255, 0.15)', 14);
    });

    // SECTION 4: VIEW HEIGHT & SHORTCUTS
    vrMenuCtx.font = 'bold 13px Outfit, sans-serif';
    vrMenuCtx.fillStyle = '#94a3b8';
    vrMenuCtx.textAlign = 'left';
    vrMenuCtx.fillText(`EYE LEVEL HEIGHT (+${state.userHeightOffset.toFixed(2)}m):`, 25, 394);

    drawVRCanvasButton(25, 408, 220, 52, '▲ RAISE (+0.15m)', '#00f0ff', 'rgba(0, 240, 255, 0.15)', 15);
    drawVRCanvasButton(265, 408, 220, 52, '▼ LOWER (-0.15m)', '#00f0ff', 'rgba(0, 240, 255, 0.15)', 15);
    drawVRCanvasButton(505, 408, 220, 52, '⟲ RESET HEIGHT', '#94a3b8', 'rgba(148, 163, 184, 0.15)', 15);
    drawVRCanvasButton(745, 408, 254, 52, '🔭 LAB OVERVIEW', '#00f0ff', 'rgba(0, 240, 255, 0.25)', 15);

    // Bottom Telemetry Footer
    vrMenuCtx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    vrMenuCtx.fillRect(10, 475, w - 20, 28);
    vrMenuCtx.font = '12px JetBrains Mono, monospace';
    vrMenuCtx.fillStyle = '#64748b';
    vrMenuCtx.textAlign = 'center';
    vrMenuCtx.fillText(`HITS: ${state.totalHits}  |  WAVELENGTH: ${state.wavelength}nm  |  SLIT SEP: ${state.slitSeparation}mm  |  QUEST SHORTCUT: 'B' / 'Y' TO JUMP TO CONSOLE`, w / 2, 494);

    if (vrMenuTexture) vrMenuTexture.needsUpdate = true;
}

function drawVRCanvasButton(x, y, w, h, text, strokeColor, bgColor, fontSize = 20) {
    vrMenuCtx.fillStyle = bgColor;
    vrMenuCtx.strokeStyle = strokeColor;
    vrMenuCtx.lineWidth = 2;
    vrMenuCtx.beginPath();
    vrMenuCtx.roundRect(x, y, w, h, 8);
    vrMenuCtx.fill();
    vrMenuCtx.stroke();

    vrMenuCtx.font = `bold ${fontSize}px Outfit, sans-serif`;
    vrMenuCtx.fillStyle = strokeColor;
    vrMenuCtx.textAlign = 'center';
    vrMenuCtx.textBaseline = 'middle';
    vrMenuCtx.fillText(text, x + w / 2, y + h / 2);
}

createVRInGameMenu();

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

    if (action === 'exit-vr-to-hub') {
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
    } else if (action === 'summon-vr-menu') {
        repositionVRMenuInFrontOfUser();
        audio.playButtonClick('default');
        return;
    } else if (action.startsWith('teleport-')) {
        const stationId = action.replace('teleport-', '');
        teleportToStation(stationId);
    } else if (action === 'toggle-emitter') {
        state.emitterActive = !state.emitterActive;
        audio.playButtonClick('power');
        pressButton('emitter');
        updateVisualState();
    } else if (action === 'toggle-detector') {
        state.detectorActive = !state.detectorActive;
        audio.playDetectorSweep(state.detectorActive);
        audio.playButtonClick('detector');
        pressButton('detector');
        updateVisualState();
    } else if (action === 'reset-screen') {
        clearScreenHits();
        audio.playButtonClick('reset');
        pressButton('reset');
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
            if (tooltip) {
                tooltip.style.display = 'block';
                tooltip.style.left = `${e.clientX}px`;
                tooltip.style.top = `${e.clientY}px`;
                tooltip.textContent = hitObj.userData.label;
            }
            return;
        }
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
        state.userHeightOffset = (val - 1.0) * 1.6;
        const valScale = document.getElementById('val-user-scale');
        if (valScale) valScale.textContent = `${val.toFixed(2)}x (+${state.userHeightOffset.toFixed(2)}m)`;

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

    renderer.render(scene, camera);
});