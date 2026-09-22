import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRButton } from 'three/addons/webxr/VRButton.js';

// =============================================================================
// QUANTUM SIMULATION STATE
// =============================================================================
const state = {
    emitterActive: true,
    detectorActive: false,
    beamMode: 'stream', // 'stream' | 'single'
    emissionRate: 60,   // particles per sec
    wavelength: 500,    // nm
    slitSeparation: 0.28, // mm (physical model distance roughly 0.28m mapped)
    slitWidth: 0.06,
    screenDistance: 5.3,
    totalHits: 0,
    audioEnabled: false,
    audioMuted: false,
    userScale: 1.45,       // Scale multiplier for user / avatar vs experiment
    userHeightOffset: 0.85, // Height offset in meters to bring Quest 3S eyes to natural lab bench eye-level
    histogramBins: 120,
    hitHistogram: new Array(120).fill(0),
    maxHistCount: 1,
    activeView: 'overview'
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
// SCENE, CAMERA, RENDERER
// =============================================================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0f1d);
scene.fog = new THREE.FogExp2(0x0a0f1d, 0.025);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.05, 100);
camera.position.set(0, 2.7, 5.4);

const xrRig = new THREE.Group();
xrRig.position.set(0, state.userHeightOffset, 3.8); // Optimal VR viewpoint: elevated eye-level with the optical bench
scene.add(xrRig);
xrRig.add(camera);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

// Reset XR Rig when entering VR session
renderer.xr.addEventListener('sessionstart', () => {
    xrRig.position.set(0, state.userHeightOffset, 3.8);
    xrRig.rotation.set(0, 0, 0);
});

// VR Button
const vrBtn = VRButton.createButton(renderer);
document.body.appendChild(vrBtn);

// Orbit Controls
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2.2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.maxPolarAngle = Math.PI / 2 - 0.02; // prevent going below floor
controls.minDistance = 0.5;
controls.maxDistance = 18;
controls.update();

// =============================================================================
// LIGHTING SETUP
// =============================================================================
const ambientLight = new THREE.AmbientLight(0xd0e0ff, 0.6);
scene.add(ambientLight);

const hemisphereLight = new THREE.HemisphereLight(0x7090ff, 0x111625, 1.2);
scene.add(hemisphereLight);

const mainSun = new THREE.DirectionalLight(0xffffff, 1.8);
mainSun.position.set(4, 8, 6);
mainSun.castShadow = true;
mainSun.shadow.mapSize.width = 2048;
mainSun.shadow.mapSize.height = 2048;
mainSun.shadow.camera.near = 0.5;
mainSun.shadow.camera.far = 25;
mainSun.shadow.camera.left = -7;
mainSun.shadow.camera.right = 7;
mainSun.shadow.camera.top = 7;
mainSun.shadow.camera.bottom = -7;
mainSun.shadow.bias = -0.0005;
scene.add(mainSun);

// Dynamic Accent Lights
const emitterLight = new THREE.PointLight(0x00f0ff, 2.0, 3.5);
emitterLight.position.set(-3.1, 2.1, 0);
scene.add(emitterLight);

const detectorLight = new THREE.PointLight(0xff2d87, 0, 3.0);
detectorLight.position.set(3.0, 2.45, 0.5);
scene.add(detectorLight);

const screenGlowLight = new THREE.PointLight(0x00ff88, 1.2, 4.0);
screenGlowLight.position.set(5.1, 2.7, 0);
scene.add(screenGlowLight);

// Pendant Lamps
[-4, 0, 4].forEach(x => {
    const lampLight = new THREE.PointLight(0xffe8cc, 1.2, 7.0);
    lampLight.position.set(x, 4.0, -1.5);
    scene.add(lampLight);
});

// =============================================================================
// PHOSPHOR DETECTION SCREEN (DYNAMIC CANVAS TEXTURE)
// =============================================================================
const screenCanvas = document.createElement('canvas');
screenCanvas.width = 512;
screenCanvas.height = 512;
const screenCtx = screenCanvas.getContext('2d');

function initScreenTexture() {
    screenCtx.fillStyle = '#060d0a';
    screenCtx.fillRect(0, 0, 512, 512);

    // Subtle grid lines on phosphor screen
    screenCtx.strokeStyle = 'rgba(0, 255, 136, 0.08)';
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
}
initScreenTexture();

const screenTexture = new THREE.CanvasTexture(screenCanvas);
screenTexture.generateMipmaps = true;
screenTexture.minFilter = THREE.LinearMipmapLinearFilter;

// Screen Panel Material
const screenMaterial = new THREE.MeshStandardMaterial({
    map: screenTexture,
    emissive: 0x003322,
    emissiveMap: screenTexture,
    emissiveIntensity: 0.85,
    roughness: 0.35,
    metalness: 0.1
});

// Particle Screen Hit Drawer
function recordScreenHit(normZ, normY) {
    // normZ in [-1, 1], normY in [-1, 1]
    const px = Math.floor(((normZ + 1) / 2) * 512);
    const py = Math.floor(((1 - normY) / 2) * 512);

    if (px >= 0 && px < 512 && py >= 0 && py < 512) {
        const rad = 2.5;
        const grad = screenCtx.createRadialGradient(px, py, 0, px, py, rad);
        const color = state.detectorActive ? 'rgba(255, 45, 135,' : 'rgba(0, 255, 170,';

        grad.addColorStop(0, color + ' 0.95)');
        grad.addColorStop(0.5, color + ' 0.45)');
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
    initScreenTexture();
    screenTexture.needsUpdate = true;
    state.hitHistogram.fill(0);
    state.maxHistCount = 1;
    state.totalHits = 0;
    updateHUDStats();
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
// LOAD GLB MODEL
// =============================================================================
const loader = new GLTFLoader();
const progressBar = document.getElementById('loading-progress');

loader.load(
    './models/YDSE1.glb',
    function (gltf) {
        modelRoot = gltf.scene;
        scene.add(modelRoot);

        modelRoot.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;

                // Better materials handling
                if (child.material) {
                    child.material.envMapIntensity = 1.0;
                }

                // Interactive Buttons
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
                        color: 0x00f0ff,
                        transparent: true,
                        opacity: 0.45,
                        blending: THREE.AdditiveBlending
                    });
                } else if (child.name.startsWith('SlitGlow_')) {
                    buttonNodes.slitGlows.push(child);
                    child.material = new THREE.MeshBasicMaterial({
                        color: 0x00f0ff,
                        transparent: true,
                        opacity: 0.8,
                        blending: THREE.AdditiveBlending
                    });
                } else if (child.name.startsWith('InterferenceBand_')) {
                    buttonNodes.bands.push(child);
                    child.material = new THREE.MeshBasicMaterial({
                        color: 0x00f0ff,
                        transparent: true,
                        opacity: 0.6,
                        blending: THREE.AdditiveBlending
                    });
                } else if (child.name.startsWith('Electron_') || child.name.startsWith('WavePath_')) {
                    // Hide static blender preview placeholder meshes in favor of our dynamic particle system
                    child.visible = false;
                }
            }
        });

        // Hide loading screen
        const loadingEl = document.getElementById('loading');
        loadingEl.style.opacity = '0';
        setTimeout(() => { loadingEl.style.display = 'none'; }, 500);

        updateVisualState();
        console.log('YDSE 3D Physics Lab loaded and initialized successfully!');
    },
    function (progress) {
        if (progress.total > 0) {
            const percent = (progress.loaded / progress.total) * 100;
            if (progressBar) progressBar.style.width = `${percent}%`;
        }
    },
    function (error) {
        console.error('Error loading YDSE GLB:', error);
        document.getElementById('loading').innerHTML = '<div style="color:red">Failed to load 3D laboratory assets. Please refresh.</div>';
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
    color: 0x00f0ff,
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
    const D = 5.3; // distance to screen
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
        const xScreen = 5.25;

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
    const waveColor = new THREE.Color(colorHex);

    if (buttonNodes.beam) {
        buttonNodes.beam.visible = state.emitterActive;
        buttonNodes.beam.material.color.set(state.detectorActive ? 0xff2d87 : colorHex);
        buttonNodes.beam.material.opacity = state.emitterActive ? 0.45 : 0;
    }

    buttonNodes.slitGlows.forEach(glow => {
        glow.visible = state.emitterActive;
        glow.material.color.set(state.detectorActive ? 0xff2d87 : colorHex);
    });

    // Interference Bands on 3D Screen Frame
    buttonNodes.bands.forEach(band => {
        // When detector is active, interference fringes disappear!
        band.visible = !state.detectorActive && state.emitterActive;
        band.material.color.set(colorHex);
    });

    // Lights
    emitterLight.intensity = state.emitterActive ? 2.5 : 0;
    emitterLight.color.set(colorHex);

    detectorLight.intensity = state.detectorActive ? 3.0 : 0;
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

    updateIntensityGraph();
}

function updateHUDStats() {
    const hitEl = document.getElementById('val-hit-count');
    if (hitEl) hitEl.textContent = state.totalHits.toLocaleString();
}

// Wavelength to RGB Hex
function wavelengthToHex(wl) {
    let r, g, b;
    if (wl >= 380 && wl < 440) {
        r = -(wl - 440) / (440 - 380);
        g = 0.0;
        b = 1.0;
    } else if (wl >= 440 && wl < 490) {
        r = 0.0;
        g = (wl - 440) / (490 - 440);
        b = 1.0;
    } else if (wl >= 490 && wl < 510) {
        r = 0.0;
        g = 1.0;
        b = -(wl - 510) / (510 - 490);
    } else if (wl >= 510 && wl < 580) {
        r = (wl - 510) / (580 - 510);
        g = 1.0;
        b = 0.0;
    } else if (wl >= 580 && wl < 645) {
        r = 1.0;
        g = -(wl - 645) / (645 - 580);
        b = 0.0;
    } else if (wl >= 645 && wl <= 750) {
        r = 1.0;
        g = 0.0;
        b = 0.0;
    } else {
        r = 0.0;
        g = 0.9;
        b = 1.0;
    }
    const hexR = Math.round(r * 255).toString(16).padStart(2, '0');
    const hexG = Math.round(g * 255).toString(16).padStart(2, '0');
    const hexB = Math.round(b * 255).toString(16).padStart(2, '0');
    return parseInt(`0x${hexR}${hexG}${hexB}`, 16);
}

// =============================================================================
// 2D REAL-TIME INTENSITY GRAPH PLOTTER
// =============================================================================
const graphCanvas = document.getElementById('intensity-canvas');
const graphCtx = graphCanvas ? graphCanvas.getContext('2d') : null;

function updateIntensityGraph() {
    if (!graphCtx) return;
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

    graphCtx.fillStyle = state.detectorActive ? 'rgba(255, 45, 135, 0.65)' : 'rgba(0, 240, 255, 0.65)';
    for (let i = 0; i < binCount; i++) {
        const count = state.hitHistogram[i];
        if (count > 0) {
            const barH = (count / maxVal) * (h - 40);
            graphCtx.fillRect(i * barW, h - 20 - barH, barW + 0.5, barH);
        }
    }

    // 2. Draw Theoretical Quantum Curve
    graphCtx.beginPath();
    graphCtx.strokeStyle = state.detectorActive ? '#ffaa00' : '#00ff88';
    graphCtx.lineWidth = 2.5;

    const d = state.slitSeparation;
    const lambda = (state.wavelength * 1e-9) * 8e5;
    const D = 5.3;
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
        vrPos: new THREE.Vector3(0, 0, 5.2),
        camPos: new THREE.Vector3(0, 2.7, 5.4),
        target: new THREE.Vector3(0, 2.2, 0)
    },
    console: {
        id: 'console',
        name: 'Console Desk',
        vrPos: new THREE.Vector3(-1.5, 0, 3.4),
        camPos: new THREE.Vector3(-1.5, 2.3, 3.2),
        target: new THREE.Vector3(-1.5, 2.0, 0.5)
    },
    slits: {
        id: 'slits',
        name: 'Double Slits Close-Up',
        vrPos: new THREE.Vector3(0, 0, 1.3),
        camPos: new THREE.Vector3(0.3, 2.9, 1.6),
        target: new THREE.Vector3(0, 2.7, 0)
    },
    emitter: {
        id: 'emitter',
        name: 'Quantum Emitter Gun',
        vrPos: new THREE.Vector3(-3.8, 0, 1.6),
        camPos: new THREE.Vector3(-3.6, 2.5, 2.2),
        target: new THREE.Vector3(-4.5, 2.2, 0)
    },
    detector: {
        id: 'detector',
        name: 'Which-Way Detector',
        vrPos: new THREE.Vector3(2.6, 0, 1.4),
        camPos: new THREE.Vector3(2.5, 2.6, 1.5),
        target: new THREE.Vector3(3.0, 2.3, 0)
    },
    screen: {
        id: 'screen',
        name: 'Phosphor Screen Target',
        vrPos: new THREE.Vector3(4.5, 0, 1.4),
        camPos: new THREE.Vector3(4.2, 2.9, 0.8),
        target: new THREE.Vector3(5.3, 2.7, 0)
    },
    side: {
        id: 'side',
        name: 'Side Profile',
        vrPos: new THREE.Vector3(0.5, 0, 4.8),
        camPos: new THREE.Vector3(0.5, 2.5, 4.8),
        target: new THREE.Vector3(0.5, 2.2, 0)
    }
};

// =============================================================================
// HOLOGRAPHIC TELEPORTATION PADS
// =============================================================================
const teleportPadsGroup = new THREE.Group();
scene.add(teleportPadsGroup);
const animatedPads = [];

function createTeleportPads() {
    Object.values(teleportStations).forEach(station => {
        const padGroup = new THREE.Group();
        padGroup.position.copy(station.vrPos);

        // 1. Floor Outer Ring
        const ringGeo = new THREE.RingGeometry(0.38, 0.48, 32);
        ringGeo.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0x00f0ff,
            transparent: true,
            opacity: 0.8,
            side: THREE.DoubleSide
        });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.position.y = 0.02;
        padGroup.add(ringMesh);

        // 2. Floor Inner Pulsing Disc
        const discGeo = new THREE.CircleGeometry(0.34, 32);
        discGeo.rotateX(-Math.PI / 2);
        const discMat = new THREE.MeshBasicMaterial({
            color: 0x00f0ff,
            transparent: true,
            opacity: 0.35,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide
        });
        const discMesh = new THREE.Mesh(discGeo, discMat);
        discMesh.position.y = 0.022;
        padGroup.add(discMesh);

        // 3. Vertical Light Beam Column
        const beamGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.8, 24, 1, true);
        const beamMat = new THREE.MeshBasicMaterial({
            color: 0x00f0ff,
            transparent: true,
            opacity: 0.12,
            blending: THREE.AdditiveBlending,
            side: THREE.DoubleSide,
            depthWrite: false
        });
        const beamMesh = new THREE.Mesh(beamGeo, beamMat);
        beamMesh.position.y = 0.9;
        padGroup.add(beamMesh);

        // 4. Floating 3D Text Badge
        const badgeCanvas = document.createElement('canvas');
        badgeCanvas.width = 256;
        badgeCanvas.height = 64;
        const bCtx = badgeCanvas.getContext('2d');
        bCtx.fillStyle = 'rgba(14, 20, 36, 0.85)';
        bCtx.strokeStyle = '#00f0ff';
        bCtx.lineWidth = 3;
        bCtx.roundRect(4, 4, 248, 56, 12);
        bCtx.fill();
        bCtx.stroke();
        bCtx.font = 'bold 22px Outfit, sans-serif';
        bCtx.fillStyle = '#ffffff';
        bCtx.textAlign = 'center';
        bCtx.textBaseline = 'middle';
        bCtx.fillText(station.name, 128, 32);

        const badgeTex = new THREE.CanvasTexture(badgeCanvas);
        const badgeMat = new THREE.SpriteMaterial({ map: badgeTex, transparent: true });
        const badgeSprite = new THREE.Sprite(badgeMat);
        badgeSprite.position.set(0, 1.2, 0);
        badgeSprite.scale.set(0.9, 0.225, 1.0);
        padGroup.add(badgeSprite);

        // Raycasting & Interaction Data
        ringMesh.userData = {
            action: `teleport-${station.id}`,
            label: `⚡ Teleport to: ${station.name}`
        };
        discMesh.userData = ringMesh.userData;
        beamMesh.userData = ringMesh.userData;

        interactiveObjects.push(ringMesh);
        interactiveObjects.push(discMesh);
        interactiveObjects.push(beamMesh);

        teleportPadsGroup.add(padGroup);
        animatedPads.push({
            ring: ringMesh,
            disc: discMesh,
            beam: beamMesh,
            badge: badgeSprite,
            baseY: 1.2
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
        // VR Teleportation: smoothly position user rig with elevated eye level
        xrRig.position.set(station.vrPos.x, state.userHeightOffset, station.vrPos.z);
        const lookDir = new THREE.Vector3().subVectors(station.target, station.vrPos);
        xrRig.rotation.y = Math.atan2(-lookDir.x, -lookDir.z);
    } else {
        // Desktop / Mobile Camera Transition
        camStartPos.copy(camera.position);
        camEndPos.copy(station.camPos);

        camStartTarget.copy(controls.target);
        camEndTarget.copy(station.target);

        camTransitionProgress = 0;
        isCameraTransitioning = true;
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

// Update Holographic Teleport Pads in Loop
function updateTeleportPads(delta, elapsedTime) {
    animatedPads.forEach((pad, idx) => {
        pad.ring.rotation.z += delta * 0.4;
        const pulse = 0.35 + Math.sin(elapsedTime * 3.0 + idx) * 0.15;
        pad.disc.material.opacity = pulse;
        pad.beam.material.opacity = 0.10 + Math.sin(elapsedTime * 2.5 + idx) * 0.05;
        pad.badge.position.y = pad.baseY + Math.sin(elapsedTime * 2.0 + idx) * 0.04;
    });
}

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

    if (action.startsWith('teleport-')) {
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
    if (e.target.closest('#hud') || e.target.closest('#modal-guide') || e.target.closest('#VRButton')) return;

    if (hoveredObject && hoveredObject.userData && hoveredObject.userData.action) {
        trigger3DAction(hoveredObject.userData.action);
    }
});

// Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
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
// WEBXR VR CONTROLLER SETUP
// =============================================================================
const controller1 = renderer.xr.getController(0);
const controller2 = renderer.xr.getController(1);

function buildControllerRay() {
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -3.5)
    ]);
    const lineMat = new THREE.LineBasicMaterial({
        color: 0x00f0ff,
        transparent: true,
        opacity: 0.6
    });
    return new THREE.Line(lineGeo, lineMat);
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
        }
    }
}

controller1.addEventListener('select', onVRSelect);
controller2.addEventListener('select', onVRSelect);

// VR Thumbstick Smooth Locomotion & Snap Turning
let snapTurnCooldown = 0;

function handleVRMovement(delta) {
    const session = renderer.xr.getSession();
    if (!session) return;

    for (const source of session.inputSources) {
        if (!source.gamepad) continue;
        const axes = source.gamepad.axes;
        // Standard XR Gamepad: axes[2] is Thumbstick X, axes[3] is Thumbstick Y
        const stickX = axes[2] !== undefined ? axes[2] : 0;
        const stickY = axes[3] !== undefined ? axes[3] : 0;

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
        } else if (source.handedness === 'right') {
            // Right Stick: Snap Turn (30 degrees)
            snapTurnCooldown -= delta;
            if (Math.abs(stickX) > 0.6 && snapTurnCooldown <= 0) {
                const angle = (stickX > 0 ? -1 : 1) * (Math.PI / 6);
                xrRig.rotateY(angle);
                snapTurnCooldown = 0.35;
            }

            // Right Stick Y: Smooth User Height / Scale Calibration in VR
            if (Math.abs(stickY) > 0.25) {
                state.userHeightOffset = Math.max(-0.2, Math.min(2.2, state.userHeightOffset - stickY * delta * 1.2));
                xrRig.position.y = state.userHeightOffset;
                state.userScale = 1.0 + (state.userHeightOffset / 1.88);
                const sliderScale = document.getElementById('slider-user-scale');
                const valScale = document.getElementById('val-user-scale');
                if (sliderScale) sliderScale.value = state.userScale.toFixed(2);
                if (valScale) valScale.textContent = `${state.userScale.toFixed(2)}x (+${state.userHeightOffset.toFixed(2)}m)`;
            }
        }
    }
}

// =============================================================================
// DOM UI EVENT LISTENERS & BINDINGS
// =============================================================================
function initUIBindings() {
    // Action Buttons
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

    // Sliders
    const rateSlider = document.getElementById('slider-rate');
    rateSlider?.addEventListener('input', (e) => {
        state.emissionRate = parseFloat(e.target.value);
        document.getElementById('val-rate').textContent = `${state.emissionRate} /s`;
    });

    const wlSlider = document.getElementById('slider-wavelength');
    wlSlider?.addEventListener('input', (e) => {
        state.wavelength = parseFloat(e.target.value);
        document.getElementById('val-wavelength').textContent = `${state.wavelength} nm`;
        updateVisualState();
    });

    const slitSlider = document.getElementById('slider-slit-dist');
    slitSlider?.addEventListener('input', (e) => {
        state.slitSeparation = parseFloat(e.target.value);
        document.getElementById('val-slit-dist').textContent = `${state.slitSeparation.toFixed(2)} mm`;
        updateVisualState();
    });

    const scaleSlider = document.getElementById('slider-user-scale');
    scaleSlider?.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.userScale = val;
        state.userHeightOffset = (val - 1.0) * 1.88;
        document.getElementById('val-user-scale').textContent = `${val.toFixed(2)}x (+${state.userHeightOffset.toFixed(2)}m)`;

        if (renderer.xr.isPresenting) {
            xrRig.position.y = state.userHeightOffset;
        }
    });
}
initUIBindings();
updateVisualState();

// =============================================================================
// WINDOW RESIZE
// =============================================================================
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    updateIntensityGraph();
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

    // 5. Subtle Ambient Pulsing Lights
    if (state.emitterActive) {
        emitterLight.intensity = 2.2 + Math.sin(elapsedTime * 6.0) * 0.3;
    }
    if (state.detectorActive) {
        detectorLight.intensity = 2.8 + Math.sin(elapsedTime * 12.0) * 0.5;
    }

    // 5. Controls & Rendering
    if (renderer.xr.isPresenting) {
        handleVRMovement(delta);
    } else {
        updateCameraTransition(delta);
        controls.update();
    }

    renderer.render(scene, camera);
});