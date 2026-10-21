import sys
import os
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.enum.shapes import MSO_SHAPE

def create_deck():
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank_layout = prs.slide_layouts[6]

    # Theme Colors
    BG_DARK = RGBColor(10, 15, 29)         # #0A0F1D Deep space navy
    CARD_BG = RGBColor(17, 24, 39)         # #111827 Dark card surface
    CARD_BORDER = RGBColor(30, 41, 59)     # #1E293B Border
    CARD_BORDER_CYAN = RGBColor(14, 116, 144) # #0E7490 Subtle cyan border
    
    TEXT_WHITE = RGBColor(241, 245, 249)   # #F1F5F9 Primary text
    TEXT_MUTED = RGBColor(148, 163, 184)   # #94A3B8 Secondary text
    TEXT_DIM = RGBColor(100, 116, 139)     # #64748B Dim subtext
    
    CYAN = RGBColor(0, 242, 254)           # #00F2FE Electric Cyan
    GREEN = RGBColor(0, 255, 136)          # #00FF88 Laser Green
    MAGENTA = RGBColor(255, 45, 135)       # #FF2D87 Quantum Magenta
    AMBER = RGBColor(245, 158, 11)         # #F59E0B Amber
    PURPLE = RGBColor(168, 85, 247)        # #A855F7 Royal Purple
    BLUE = RGBColor(59, 130, 246)          # #3B82F6 Bright Blue

    def set_slide_background(slide):
        bg = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, 0, 0, Inches(13.333), Inches(7.5))
        bg.fill.solid()
        bg.fill.fore_color.rgb = BG_DARK
        bg.line.fill.background()
        return bg

    def add_header(slide, tag_text, title_text, subtitle_text=None, tag_color=CYAN):
        # Header Badge
        tag_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.42), Inches(11.7), Inches(0.35))
        tf_tag = tag_box.text_frame
        tf_tag.word_wrap = True
        tf_tag.margin_left = tf_tag.margin_top = tf_tag.margin_right = tf_tag.margin_bottom = 0
        p_tag = tf_tag.paragraphs[0]
        p_tag.text = tag_text.upper()
        p_tag.font.size = Pt(10)
        p_tag.font.bold = True
        p_tag.font.color.rgb = tag_color
        p_tag.font.name = "Arial"

        # Main Title
        title_box = slide.shapes.add_textbox(Inches(0.8), Inches(0.72), Inches(11.7), Inches(0.65))
        tf_title = title_box.text_frame
        tf_title.word_wrap = True
        tf_title.margin_left = tf_title.margin_top = tf_title.margin_right = tf_title.margin_bottom = 0
        p_title = tf_title.paragraphs[0]
        p_title.text = title_text
        p_title.font.size = Pt(23)
        p_title.font.bold = True
        p_title.font.color.rgb = TEXT_WHITE
        p_title.font.name = "Arial"

        # Subtitle
        if subtitle_text:
            sub_box = slide.shapes.add_textbox(Inches(0.8), Inches(1.36), Inches(11.7), Inches(0.35))
            tf_sub = sub_box.text_frame
            tf_sub.word_wrap = True
            tf_sub.margin_left = tf_sub.margin_top = tf_sub.margin_right = tf_sub.margin_bottom = 0
            p_sub = tf_sub.paragraphs[0]
            p_sub.text = subtitle_text
            p_sub.font.size = Pt(11.5)
            p_sub.font.color.rgb = TEXT_MUTED
            p_sub.font.name = "Arial"

    def add_card(slide, left, top, width, height, bg_color=CARD_BG, border_color=CARD_BORDER, border_width=1.0):
        card = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(left), Inches(top), Inches(width), Inches(height))
        card.fill.solid()
        card.fill.fore_color.rgb = bg_color
        card.line.color.rgb = border_color
        card.line.width = Pt(border_width)
        return card

    # =========================================================================
    # SLIDE 1: EXECUTIVE VISION & PLATFORM OVERVIEW
    # =========================================================================
    slide1 = prs.slides.add_slide(blank_layout)
    set_slide_background(slide1)
    add_header(
        slide1,
        "Project Architecture & Vision • Quantum XR Suite",
        "Quantum XR — Young's Double Slit & Wave-Particle Duality Platform",
        "Immersive 6DoF WebXR Spatial Computing Laboratory Bringing Quantum Mechanics & Measurement Paradox to Life"
    )

    # 3 Main Columns
    col_w = 3.65
    gap = 0.38
    top_y = 1.85
    card_h = 5.15

    # Column 1: Core Mission & Paradigm
    c1 = add_card(slide1, 0.8, top_y, col_w, card_h, border_color=CARD_BORDER_CYAN)
    tb1 = slide1.shapes.add_textbox(Inches(1.0), Inches(top_y + 0.2), Inches(col_w - 0.4), Inches(card_h - 0.4))
    tf1 = tb1.text_frame
    tf1.word_wrap = True

    p = tf1.paragraphs[0]
    p.text = "🔬 Core Mission & Philosophy"
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = CYAN

    items_c1 = [
        ("Bridging Abstract Theory to Reality", "Transforms counter-intuitive quantum principles (wavefunction, superposition, quantum collapse) into a tangible, manipulable 3D physical apparatus."),
        ("Zero-Install WebXR Architecture", "Operates entirely within modern browsers (Meta Quest Browser & Chromium). No native APKs or installations required."),
        ("Dual Audience Alignment", "Architected both for academic research/pedagogy and high-engagement spatial computing exhibitions."),
        ("Core Paradox Simulation", "Enables direct observation of the central mystery of quantum physics: particles behaving as waves until an observer looks.")
    ]
    for title, desc in items_c1:
        p_t = tf1.add_paragraph()
        p_t.space_before = Pt(12)
        p_t.text = f"• {title}"
        p_t.font.bold = True
        p_t.font.size = Pt(11)
        p_t.font.color.rgb = TEXT_WHITE

        p_d = tf1.add_paragraph()
        p_d.text = desc
        p_d.font.size = Pt(9.5)
        p_d.font.color.rgb = TEXT_MUTED

    # Column 2: Dual Experiential Gateways
    c2 = add_card(slide1, 0.8 + col_w + gap, top_y, col_w, card_h, border_color=PURPLE)
    tb2 = slide1.shapes.add_textbox(Inches(0.8 + col_w + gap + 0.2), Inches(top_y + 0.2), Inches(col_w - 0.4), Inches(card_h - 0.4))
    tf2 = tb2.text_frame
    tf2.word_wrap = True

    p = tf2.paragraphs[0]
    p.text = "🏛️ Multi-View Application Suite"
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = PURPLE

    items_c2 = [
        ("Central Entrance Portal Hub", "A sleek dark-mode navigation dashboard featuring animated glassmorphic cards, telemetry pills, and view router."),
        ("3D & VR Experimental Lab", "Real-time interactive optical bench with electron/photon emitters, movable detector sensors, and phosphor target screen."),
        ("Experiments Catalog", "Modular hub designed to scale across upcoming quantum experiments: Photoelectric Effect & Stern-Gerlach."),
        ("Comprehensive Quantum Syllabus", "Interactive textbook featuring 6 rigorous academic modules, dynamic math callouts, and live parameter sync.")
    ]
    for title, desc in items_c2:
        p_t = tf2.add_paragraph()
        p_t.space_before = Pt(12)
        p_t.text = f"• {title}"
        p_t.font.bold = True
        p_t.font.size = Pt(11)
        p_t.font.color.rgb = TEXT_WHITE

        p_d = tf2.add_paragraph()
        p_d.text = desc
        p_d.font.size = Pt(9.5)
        p_d.font.color.rgb = TEXT_MUTED

    # Column 3: Platform Ecosystem & Targets
    c3 = add_card(slide1, 0.8 + (col_w + gap) * 2, top_y, col_w, card_h, border_color=GREEN)
    tb3 = slide1.shapes.add_textbox(Inches(0.8 + (col_w + gap) * 2 + 0.2), Inches(top_y + 0.2), Inches(col_w - 0.4), Inches(card_h - 0.4))
    tf3 = tb3.text_frame
    tf3.word_wrap = True

    p = tf3.paragraphs[0]
    p.text = "⚡ Target Platforms & Hardware"
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = GREEN

    items_c3 = [
        ("Meta Quest 3 & 3S Native", "Optimized 6DoF room-scale tracking, dual controller raycasting, and in-VR ergonomic workstation."),
        ("Desktop 3D WebGL Fallback", "High-performance smooth OrbitControls, keyboard shortcuts (Space, D, R), and 12-camera perspective bar."),
        ("High-Fidelity PBR Rendering", "Real-time PCF soft shadows, ACES filmic tone mapping, and PMREM environment reflections."),
        ("Sub-Millisecond Feedback", "WebGL canvas draw buffer and Web Audio API synthesized response without external network latency.")
    ]
    for title, desc in items_c3:
        p_t = tf3.add_paragraph()
        p_t.space_before = Pt(12)
        p_t.text = f"• {title}"
        p_t.font.bold = True
        p_t.font.size = Pt(11)
        p_t.font.color.rgb = TEXT_WHITE

        p_d = tf3.add_paragraph()
        p_d.text = desc
        p_d.font.size = Pt(9.5)
        p_d.font.color.rgb = TEXT_MUTED


    # =========================================================================
    # SLIDE 2: QUANTUM PHYSICS SIMULATION & THE MEASUREMENT PARADOX
    # =========================================================================
    slide2 = prs.slides.add_slide(blank_layout)
    set_slide_background(slide2)
    add_header(
        slide2,
        "Physics Engine & Theoretical Modeling",
        "Wavefunction Superposition vs. Measurement Collapse",
        "Mathematical Rigor, Born's Rule Probability Sampling, and Real-Time Optical Fringe Generation"
    )

    # 2 Main Columns: Left = The Mathematical Model, Right = Dynamic Laser & Simulation Engine
    w_left = 5.7
    w_right = 5.7
    col_gap = 0.33
    top_y = 1.85
    card_h = 5.15

    # Left Column: Quantum Equations & States
    c_l = add_card(slide2, 0.8, top_y, w_left, card_h, border_color=CARD_BORDER_CYAN)
    tb_l = slide2.shapes.add_textbox(Inches(1.0), Inches(top_y + 0.2), Inches(w_left - 0.4), Inches(card_h - 0.4))
    tf_l = tb_l.text_frame
    tf_l.word_wrap = True

    p = tf_l.paragraphs[0]
    p.text = "⚛️ Quantum State & Wave Interference Math"
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = CYAN

    math_sections = [
        ("Wave Superposition (Detector OFF)", 
         "State: |Ψ⟩ = (|Slit₁⟩ + |Slit₂⟩) / √2\n"
         "Born's Rule: I(y) ∝ |ψ₁ + ψ₂|² = |ψ₁|² + |ψ₂|² + 2 Re(ψ₁* ψ₂)\n"
         "The cross-term 2 Re(ψ₁* ψ₂) produces the iconic bright/dark fringe interference pattern. Even firing one particle at a time, each particle interferes with itself!"),
        ("Wavefunction Collapse (Detector ON - Which-Way Observer)", 
         "State: Collapsed into either |Slit₁⟩ OR |Slit₂⟩\n"
         "Observed Intensity: I_obs(y) = |ψ₁|² + |ψ₂|²\n"
         "Phase coherence is completely destroyed (cross-term → 0). Particles behave as classical macroscopic bullets, forming two Gaussian clumps directly behind the slits."),
        ("Physical Optics & Fringe Width Formula",
         "Path difference: Δx = d · sin θ ≈ (y · d) / D\n"
         "Constructive Maxima: Δx = m λ  |  Destructive Minima: Δx = (m + 0.5) λ\n"
         "Fringe Spacing: β = (λ · D) / d  (Calculated live in HUD as parameters shift).")
    ]
    for title, desc in math_sections:
        p_t = tf_l.add_paragraph()
        p_t.space_before = Pt(10)
        p_t.text = f"• {title}"
        p_t.font.bold = True
        p_t.font.size = Pt(11)
        p_t.font.color.rgb = GREEN if "Detector OFF" in title else (MAGENTA if "Detector ON" in title else AMBER)

        p_d = tf_l.add_paragraph()
        p_d.text = desc
        p_d.font.size = Pt(9.5)
        p_d.font.color.rgb = TEXT_WHITE

    # Right Column: Monte Carlo Sampling & Phosphor Screen Engine
    c_r = add_card(slide2, 0.8 + w_left + col_gap, top_y, w_right, card_h, border_color=PURPLE)
    tb_r = slide2.shapes.add_textbox(Inches(0.8 + w_left + col_gap + 0.2), Inches(top_y + 0.2), Inches(w_right - 0.4), Inches(card_h - 0.4))
    tf_r = tb_r.text_frame
    tf_r.word_wrap = True

    p = tf_r.paragraphs[0]
    p.text = "🎯 Real-Time Sampling & Optical Shader Pipeline"
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = PURPLE

    sim_sections = [
        ("Monte Carlo Rejection Sampling Algorithm",
         "Particles are spawned and assigned landing coordinates via numerical rejection sampling against the exact theoretical wavefunction distribution:\n"
         "I(z) = cos²(π d z / λ D) · sinc²(π a z / λ D)\n"
         "Ensures strict physical fidelity matching real double-slit laser experiments."),
        ("High-Dynamic-Range Phosphor Screen Canvas",
         "Dynamic 512x512 CanvasTexture with 256-level optical bloom Look-Up Table (LUT), gamma expansion (pow 0.85), and laser core bloom whitening.\n"
         "Features green phosphor luminescence (0x00FF88) in wave mode, shifting dynamically to magenta (0xFF2D87) when observed."),
        ("Live Cross-Section Profile & 120-Bin Histogram",
         "Real-time graph dock displays measured physical impact counts alongside theoretical probability curves, dynamically accumulating particle hits up to 250/s.")
    ]
    for title, desc in sim_sections:
        p_t = tf_r.add_paragraph()
        p_t.space_before = Pt(11)
        p_t.text = f"• {title}"
        p_t.font.bold = True
        p_t.font.size = Pt(11)
        p_t.font.color.rgb = TEXT_WHITE

        p_d = tf_r.add_paragraph()
        p_d.text = desc
        p_d.font.size = Pt(9.5)
        p_d.font.color.rgb = TEXT_MUTED


    # =========================================================================
    # SLIDE 3: 3D LABORATORY BENCH & WEBXR INTERACTION ARCHITECTURE
    # =========================================================================
    slide3 = prs.slides.add_slide(blank_layout)
    set_slide_background(slide3)
    add_header(
        slide3,
        "Spatial Computing & Virtual Reality",
        "Immersive 3D Laboratory & WebXR Interaction System",
        "Blender Optical Bench Rail, 6DoF Controller Teleportation, and In-VR Spatial Workstation"
    )

    col_w3 = 3.65
    gap3 = 0.38
    top_y = 1.85
    card_h = 5.15

    # Column 1: Physical Optical Bench & 3D Assets
    c31 = add_card(slide3, 0.8, top_y, col_w3, card_h, border_color=CARD_BORDER_CYAN)
    tb31 = slide3.shapes.add_textbox(Inches(1.0), Inches(top_y + 0.2), Inches(col_w3 - 0.4), Inches(card_h - 0.4))
    tf31 = tb31.text_frame
    tf31.word_wrap = True

    p = tf31.paragraphs[0]
    p.text = "🏗️ 3D Optical Bench & Environment"
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = CYAN

    items_31 = [
        ("Custom Blender 3D Model", "Built with Blender (YDSE1.glb, 1.5MB), featuring a precision heavy-duty optical bench rail, emitter housing, slit barrier, detector sensor, and phosphor screen."),
        ("Isolated Screen Pedestal", "Detection target positioned at x=6.60m with a custom heavy laboratory floor pedestal to avoid optical bench overlap."),
        ("Comprehensive Lighting Rig", "Overhead optical spotlights (3.2 intensity), console task lights, dynamic cyan/magenta point lights, and warm pendant lamps."),
        ("Interactive Table Console", "Physical 3D buttons on the bench desk (Emitter, Detector, Reset) with spring-damper compression animations upon click.")
    ]
    for title, desc in items_31:
        p_t = tf31.add_paragraph()
        p_t.space_before = Pt(12)
        p_t.text = f"• {title}"
        p_t.font.bold = True
        p_t.font.size = Pt(11)
        p_t.font.color.rgb = TEXT_WHITE

        p_d = tf31.add_paragraph()
        p_d.text = desc
        p_d.font.size = Pt(9.5)
        p_d.font.color.rgb = TEXT_MUTED

    # Column 2: WebXR 6DoF & Controller System
    c32 = add_card(slide3, 0.8 + col_w3 + gap3, top_y, col_w3, card_h, border_color=BLUE)
    tb32 = slide3.shapes.add_textbox(Inches(0.8 + col_w3 + gap3 + 0.2), Inches(top_y + 0.2), Inches(col_w3 - 0.4), Inches(card_h - 0.4))
    tf32 = tb32.text_frame
    tf32.word_wrap = True

    p = tf32.paragraphs[0]
    p.text = "🥽 6DoF WebXR Spatial Interaction"
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = BLUE

    items_32 = [
        ("Meta Quest 3/3S Hardware Support", "Full native 6-Degrees-of-Freedom spatial tracking with zero driver installation via the Meta Quest Browser."),
        ("Dual Controller Pointer Rays", "Cyan interactive laser pointer rays emitting from left and right controllers (THREE.Line with glow blending)."),
        ("Haptic & Raycast Feedback", "Precise collision raycasting against table buttons, sliders, in-VR menus, and holographic floor teleport pads."),
        ("Stationary In-VR 3D Workstation", "A curved floating 3D control console positioned at arm's reach in VR, enabling complete parameter control without removing the headset.")
    ]
    for title, desc in items_32:
        p_t = tf32.add_paragraph()
        p_t.space_before = Pt(12)
        p_t.text = f"• {title}"
        p_t.font.bold = True
        p_t.font.size = Pt(11)
        p_t.font.color.rgb = TEXT_WHITE

        p_d = tf32.add_paragraph()
        p_d.text = desc
        p_d.font.size = Pt(9.5)
        p_d.font.color.rgb = TEXT_MUTED

    # Column 3: Holographic Teleportation & Cameras
    c33 = add_card(slide3, 0.8 + (col_w3 + gap3) * 2, top_y, col_w3, card_h, border_color=AMBER)
    tb33 = slide3.shapes.add_textbox(Inches(0.8 + (col_w3 + gap3) * 2 + 0.2), Inches(top_y + 0.2), Inches(col_w3 - 0.4), Inches(card_h - 0.4))
    tf33 = tb33.text_frame
    tf33.word_wrap = True

    p = tf33.paragraphs[0]
    p.text = "🚀 Teleportation & 12 Preset Views"
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = AMBER

    items_33 = [
        ("Holographic Ground Teleport Pads", "Pulsing concentric cyan circles on the lab floor allowing instant controller point-and-trigger teleportation."),
        ("12 Dedicated Scientific Perspectives", "Overview, Console, Emitter Sight, Down-the-Barrel Beamline, Double Slits, Detector Sensor, Target Screen, Blackboard, Balcony, and Rear."),
        ("Smooth Position Interpolation", "Vector3 slerp/lerp transitions preventing VR motion sickness during desktop and immersive camera maneuvers."),
        ("Adaptive VR Rig Offset", "Adjustable eye-level slider (0.8x - 2.2x) calibrating user physical standing height seamlessly into the virtual room.")
    ]
    for title, desc in items_33:
        p_t = tf33.add_paragraph()
        p_t.space_before = Pt(12)
        p_t.text = f"• {title}"
        p_t.font.bold = True
        p_t.font.size = Pt(11)
        p_t.font.color.rgb = TEXT_WHITE

        p_d = tf33.add_paragraph()
        p_d.text = desc
        p_d.font.size = Pt(9.5)
        p_d.font.color.rgb = TEXT_MUTED


    # =========================================================================
    # SLIDE 4: THEORETICAL SYLLABUS, CALCULATOR & FUTURE ROADMAP
    # =========================================================================
    slide4 = prs.slides.add_slide(blank_layout)
    set_slide_background(slide4)
    add_header(
        slide4,
        "Pedagogical Curriculum & Mathematical Tooling",
        "Deep Quantum Theory Suite, Interactive Wave Calculator & Roadmap",
        "6 Academic Learning Modules, Dynamic Fringe Computations, and Laboratory Expansions"
    )

    w_half = 5.7
    top_y = 1.85
    card_h = 5.15

    # Left: 6 Core Academic Modules
    c41 = add_card(slide4, 0.8, top_y, w_half, card_h, border_color=CARD_BORDER_CYAN)
    tb41 = slide4.shapes.add_textbox(Inches(1.0), Inches(top_y + 0.2), Inches(w_half - 0.4), Inches(card_h - 0.4))
    tf41 = tb41.text_frame
    tf41.word_wrap = True

    p = tf41.paragraphs[0]
    p.text = "📚 6-Module Quantum Physics Syllabus"
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = CYAN

    modules = [
        ("01. Wave Interference & Young's Experiment", "Huygens-Fresnel secondary wavelets, optical path difference Δx = d sin θ, and fringe width derivation β = λD/d."),
        ("02. The Measurement Paradox & Decoherence", "Superposition |Ψ⟩ = (|Slit₁⟩ + |Slit₂⟩)/√2, Born's probability density, and live 2D wave vs collapsed particle visualizer."),
        ("03. De Broglie Matter Waves & Davisson-Germer", "Electron de Broglie wavelength λ = h/p = h/√(2mE_k). Proof that electrons and heavy molecules possess wave nature."),
        ("04. Heisenberg Uncertainty & Bohr Complementarity", "Δx · Δp_x ≥ ℏ/2. Why observing which slit a particle enters imparts a momentum kick that destroys fringe coherence."),
        ("05. Feynman Path Integrals & Quantum Erasers", "Sum over histories K(b,a) = ∫ D[x(t)] e^(iS/ℏ), and Scully-Drühl quantum erasure restoring destroyed fringes."),
        ("06. Interactive Live Calculator", "Dynamic slider control of λ (380-750nm), slit spacing d (0.1-0.8mm), and screen distance D, plotting real-time curves.")
    ]
    for title, desc in modules:
        p_t = tf41.add_paragraph()
        p_t.space_before = Pt(8)
        p_t.text = f"• {title}"
        p_t.font.bold = True
        p_t.font.size = Pt(10.5)
        p_t.font.color.rgb = TEXT_WHITE

        p_d = tf41.add_paragraph()
        p_d.text = desc
        p_d.font.size = Pt(9)
        p_d.font.color.rgb = TEXT_MUTED

    # Right: Live Calculator & Roadmap
    c42 = add_card(slide4, 0.8 + w_half + 0.33, top_y, w_half, card_h, border_color=PURPLE)
    tb42 = slide4.shapes.add_textbox(Inches(0.8 + w_half + 0.33 + 0.2), Inches(top_y + 0.2), Inches(w_half - 0.4), Inches(card_h - 0.4))
    tf42 = tb42.text_frame
    tf42.word_wrap = True

    p = tf42.paragraphs[0]
    p.text = "🧮 Interactive Calculator & Future Expansions"
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = PURPLE

    right_sections = [
        ("Real-Time Analytical Fringe Engine",
         "The built-in calculator continuously solves the diffraction-envelope equation:\n"
         "I(y) = I₀ cos²(π d y / λ D) · sinc²(π a y / λ D)\n"
         "Computes exact fringe width β, central envelope width, 1st dark fringe position, and total visible bands within the central peak."),
        ("One-Click 3D Lab Parameter Synchronization",
         "Users can adjust optical parameters theoretically, then click 'Launch 3D Lab with these Parameters' to transfer exact values into the live Three.js beam simulation."),
        ("Experiment 02: Photoelectric Effect (Upcoming)",
         "Simulation of photon energy quantization (E = hν - Φ), variable UV/visible monochromatic sources, and stopping potential voltage measurements."),
        ("Experiment 03: Stern-Gerlach Experiment (Upcoming)",
         "Spatial quantization of atomic angular momentum: silver atoms passing through an inhomogeneous magnetic field splitting into discrete spin-up and spin-down states.")
    ]
    for title, desc in right_sections:
        p_t = tf42.add_paragraph()
        p_t.space_before = Pt(10)
        p_t.text = f"• {title}"
        p_t.font.bold = True
        p_t.font.size = Pt(10.5)
        p_t.font.color.rgb = AMBER if "Upcoming" in title else (GREEN if "Synchronization" in title else CYAN)

        p_d = tf42.add_paragraph()
        p_d.text = desc
        p_d.font.size = Pt(9)
        p_d.font.color.rgb = TEXT_WHITE if "Upcoming" not in title else TEXT_MUTED


    # =========================================================================
    # SLIDE 5: INFRASTRUCTURE, PROCEDURAL AUDIO & PRODUCTION DEPLOYMENT
    # =========================================================================
    slide5 = prs.slides.add_slide(blank_layout)
    set_slide_background(slide5)
    add_header(
        slide5,
        "System Architecture & Production Deployment",
        "Procedural Audio Engine, HTTPS Infrastructure & Technology Stack",
        "Web Audio Synthesis, Dual Node.js SSL Security, HTTP 206 Streaming, and Enterprise Reliability"
    )

    col_w5 = 3.65
    gap5 = 0.38
    top_y = 1.85
    card_h = 5.15

    # Column 1: Web Audio Procedural Synthesizer
    c51 = add_card(slide5, 0.8, top_y, col_w5, card_h, border_color=CARD_BORDER_CYAN)
    tb51 = slide5.shapes.add_textbox(Inches(1.0), Inches(top_y + 0.2), Inches(col_w5 - 0.4), Inches(card_h - 0.4))
    tf51 = tb51.text_frame
    tf51.word_wrap = True

    p = tf51.paragraphs[0]
    p.text = "🎵 Procedural Web Audio Engine"
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = CYAN

    items_51 = [
        ("Zero Audio Asset Footprint", "100% synthesized in real time via Web Audio API oscillators and filters. Zero MP3/WAV download overhead."),
        ("55Hz Ambient Laboratory Hum", "Low-frequency sine wave through a 120Hz lowpass filter providing deep tactile presence inside VR."),
        ("Geiger Particle Impact Clicks", "Randomized frequency bursts (1800-2600Hz) with exponential decays (15ms), giving authentic Geiger counter feedback upon phosphor hit."),
        ("Dynamic Sweep & Teleport Tones", "Sawtooth sweeps (300Hz ↔ 1200Hz) for detector activation and resonant sine swooshes for spatial teleportation.")
    ]
    for title, desc in items_51:
        p_t = tf51.add_paragraph()
        p_t.space_before = Pt(12)
        p_t.text = f"• {title}"
        p_t.font.bold = True
        p_t.font.size = Pt(11)
        p_t.font.color.rgb = TEXT_WHITE

        p_d = tf51.add_paragraph()
        p_d.text = desc
        p_d.font.size = Pt(9.5)
        p_d.font.color.rgb = TEXT_MUTED

    # Column 2: Dual HTTPS Server & WebXR Security
    c52 = add_card(slide5, 0.8 + col_w5 + gap5, top_y, col_w5, card_h, border_color=MAGENTA)
    tb52 = slide5.shapes.add_textbox(Inches(0.8 + col_w5 + gap5 + 0.2), Inches(top_y + 0.2), Inches(col_w5 - 0.4), Inches(card_h - 0.4))
    tf52 = tb52.text_frame
    tf52.word_wrap = True

    p = tf52.paragraphs[0]
    p.text = "🔒 HTTPS & WebXR Infrastructure"
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = MAGENTA

    items_52 = [
        ("Strict WebXR SSL Requirements", "W3C WebXR specifications strictly mandate HTTPS origin for camera, motion tracking, and VR display access."),
        ("Dual Protocol Architecture", "Simultaneous Node.js server: Port 3443 (HTTPS with key.pem/cert.pem for Meta Quest) and Port 3000 (HTTP fallback for desktop)."),
        ("HTTP 206 Partial Content Streaming", "Implements Range Request parsing for chunked, non-blocking delivery of heavy 3D GLB assets."),
        ("Network Broadcast Ready", "Binds to 0.0.0.0 allowing wireless local Wi-Fi pairing directly into Meta Quest 3/3S headsets at full gigabit speeds.")
    ]
    for title, desc in items_52:
        p_t = tf52.add_paragraph()
        p_t.space_before = Pt(12)
        p_t.text = f"• {title}"
        p_t.font.bold = True
        p_t.font.size = Pt(11)
        p_t.font.color.rgb = TEXT_WHITE

        p_d = tf52.add_paragraph()
        p_d.text = desc
        p_d.font.size = Pt(9.5)
        p_d.font.color.rgb = TEXT_MUTED

    # Column 3: Full Technology Stack Summary
    c53 = add_card(slide5, 0.8 + (col_w5 + gap5) * 2, top_y, col_w5, card_h, border_color=GREEN)
    tb53 = slide5.shapes.add_textbox(Inches(0.8 + (col_w5 + gap5) * 2 + 0.2), Inches(top_y + 0.2), Inches(col_w5 - 0.4), Inches(card_h - 0.4))
    tf53 = tb53.text_frame
    tf53.word_wrap = True

    p = tf53.paragraphs[0]
    p.text = "💻 Complete Technology Stack"
    p.font.size = Pt(14)
    p.font.bold = True
    p.font.color.rgb = GREEN

    items_53 = [
        ("Rendering & Graphics", "Three.js (r185), WebGL2, PBR materials, custom CanvasTexture shaders, and PCF soft shadow maps."),
        ("Spatial API Layer", "WebXR Device API, VRButton, XRController, and raycast event listeners."),
        ("Interface & Design System", "Vanilla CSS3 Glassmorphism, CSS Custom Properties, Outfit & JetBrains Mono typography, responsive grid layout."),
        ("Runtime & Tooling", "Node.js HTTPS server, ES Modules with native import maps, Blender 3D modeling suite, zero external build-step overhead.")
    ]
    for title, desc in items_53:
        p_t = tf53.add_paragraph()
        p_t.space_before = Pt(12)
        p_t.text = f"• {title}"
        p_t.font.bold = True
        p_t.font.size = Pt(11)
        p_t.font.color.rgb = TEXT_WHITE

        p_d = tf53.add_paragraph()
        p_d.text = desc
        p_d.font.size = Pt(9.5)
        p_d.font.color.rgb = TEXT_MUTED

    output_path = os.path.join(os.path.dirname(__file__), "Quantum_XR_Presentation.pptx")
    prs.save(output_path)
    print(f"Presentation successfully created at: {output_path}")

if __name__ == "__main__":
    create_deck()
