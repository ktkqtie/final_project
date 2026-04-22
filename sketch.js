/*
 * =============================================================================
 * 3D AUDIO VISUALIZER — p5.js + WEBGL + p5.sound
 * =============================================================================
 *
 * What this sketch does (high level):
 * 1. User uploads an MP3 via the HTML overlay (hidden file input + visible button).
 * 2. p5.sound plays the file and runs two analyzers in parallel:
 *    - FFT: splits the signal into frequency bands (bass / mid / treble).
 *    - Amplitude: overall loudness (RMS-style level), good for “punch” and scale.
 * 3. Each frame, draw() reads those numbers and maps them to visual parameters:
 *    line thickness, rotation speed, colors, wave motion, etc.
 * 4. orbitControl() lets the viewer drag to rotate the camera and scroll to zoom,
 *    so the line ribbons read clearly in 3D.
 *
 * Architecture (why it is split this way):
 * - Audio plumbing: setupUploadFlow, loadAndPlayFile, togglePlayPause
 * - Numbers from audio: getAudioMetrics
 * - Drawing: drawGradientBackdrop (background), renderLineSystem (lines)
 * This separation makes it easier to swap visuals or add stem separation later.
 * =============================================================================
 */

// -----------------------------------------------------------------------------
// STATE: audio + DOM references
// -----------------------------------------------------------------------------

/** The currently loaded p5.SoundFile (null until user picks a file successfully). */
let audioFile = null;

/**
 * Blob URL for the selected file (e.g. blob:http://...).
 * We revoke the old URL when replacing a file to avoid memory leaks.
 */
let audioObjectUrl = null;

/**
 * Fast Fourier Transform analyzer: turns the waveform into frequency “bins”.
 * Used here for bass / mid / treble energy (see getAudioMetrics).
 */
let fftAnalyzer = null;

/**
 * Tracks overall volume (loudness) of whatever is connected as input.
 * getLevel() returns roughly 0..1; spikes on beats — good for scale / stroke.
 */
let amplitudeAnalyzer = null;

// Cached references to HTML elements (defined in index.html).
// We grab them once at load time so event listeners stay simple.
const overlayEl = document.getElementById("uploadOverlay");
const uploadButtonEl = document.getElementById("uploadButton");
const audioInputEl = document.getElementById("audioInput");
const playbackControlsEl = document.getElementById("playbackControls");
const pauseButtonEl = document.getElementById("pauseButton");

/**
 * Accumulated rotation angle for the line scene (radians).
 * Increases faster when the music is energetic; frozen while paused (see renderLineSystem).
 */
let sceneRotation = 0;

/** Number of concentric ribbon loops (each is a closed 3D polyline). */
const RIBBON_LAYERS = 5;

/** Vertices per ribbon loop; more = smoother curve, slightly heavier CPU. */
const RIBBON_POINTS = 140;

/** Number of extra open “trail” polylines orbiting in the scene. */
const ORBIT_TRAILS = 12;

// -----------------------------------------------------------------------------
// p5 LIFECYCLE
// -----------------------------------------------------------------------------

/**
 * p5 calls setup() once before the first draw().
 * Here we create the WebGL canvas, configure drawing modes, and wire UI events.
 */
function setup() {
  // WEBGL = 3D renderer: vertices are in world space; camera + lights apply.
  const canvas = createCanvas(windowWidth, windowHeight, WEBGL);
  canvas.parent("app");

  // HSB: Hue 0–360°, Saturation/Brightness/Alpha 0–100. Easier for “cool vs warm” colors from pitch.
  colorMode(HSB, 360, 100, 100, 100);
  angleMode(RADIANS);

  // Ribbons are drawn as stroked polylines, not filled meshes.
  noFill();
  strokeCap(ROUND);

  // FFT: first arg = smoothing (0..1), higher = smoother but slower to react.
  // Second arg = bins; 1024 is a common balance of detail vs cost.
  fftAnalyzer = new p5.FFT(0.85, 1024);

  // Amplitude smoothing: similar idea — slightly laggy but less jittery.
  amplitudeAnalyzer = new p5.Amplitude(0.85);

  setupUploadFlow();
  setupPauseButton();
}

/**
 * p5 calls draw() every frame (~60 fps).
 * Order matters:
 * 1) Clear / background
 * 2) Pull audio metrics (zeros if nothing playing)
 * 3) Draw full-screen gradient (not affected by orbitControl below — see comment in draw)
 * 4) orbitControl — updates camera from mouse / scroll
 * 5) Draw the 3D line system in the current camera view
 */
function draw() {
  // Dark purplish base (HSB: hue ~236, low brightness) — reads as deep space.
  background(236, 48, 5);

  const metrics = getAudioMetrics();

  // Draw soft gradient planes behind everything. Done BEFORE orbitControl so the
  // backdrop stays more “environmental”; only the line field is orbited/zoomed.
  drawGradientBackdrop(metrics);

  // Sensitivity: (x, y, z) — drag rotates; third value enables scroll-to-zoom.
  orbitControl(1.1, 1.1, 0.12);

  renderLineSystem(metrics);
}

// -----------------------------------------------------------------------------
// FILE UPLOAD + PLAYBACK (bridges HTML ↔ p5.sound)
// -----------------------------------------------------------------------------

/**
 * Wires the visible “Choose file” button to the hidden <input type="file">.
 * On file selection, validates MIME/extension, unlocks Web Audio (browser rule),
 * then loads and plays via loadAndPlayFile.
 */
function setupUploadFlow() {
  // Programmatic .click() on the hidden input is allowed because it follows a real user click.
  uploadButtonEl.addEventListener("click", () => {
    audioInputEl.click();
  });

  audioInputEl.addEventListener("change", async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    // Some OSes leave type empty; fall back on .mp3 extension.
    if (!file.type.startsWith("audio/") && !file.name.toLowerCase().endsWith(".mp3")) {
      window.alert("Please upload a valid audio file (MP3 recommended).");
      return;
    }

    // Browsers require a user gesture before audio can run; p5 exposes this helper.
    await userStartAudio();
    loadAndPlayFile(file);
  });
}

/**
 * Loads a File object into p5.sound, connects analyzers, starts playback,
 * and updates UI (hide overlay, show pause controls).
 */
function loadAndPlayFile(file) {
  // Tear down previous sound so we do not leak nodes or keep two songs loaded.
  if (audioFile) {
    audioFile.stop();
    audioFile.disconnect();
    audioFile = null;
  }

  if (audioObjectUrl) {
    URL.revokeObjectURL(audioObjectUrl);
    audioObjectUrl = null;
  }

  // Object URL lets p5 load the file as if it were a remote URL, without uploading to a server.
  audioObjectUrl = URL.createObjectURL(file);

  loadSound(
    audioObjectUrl,
    (loaded) => {
      audioFile = loaded;

      // Route analyzer inputs to this specific sound (default mic is not used).
      fftAnalyzer.setInput(audioFile);
      amplitudeAnalyzer.setInput(audioFile);

      audioFile.play();

      // CSS class hides the upload overlay (opacity + no pointer events).
      overlayEl.classList.add("is-hidden");
      playbackControlsEl.hidden = false;
      updatePauseButtonLabel();
    },
    (err) => {
      console.error("Error loading audio:", err);
      window.alert("Audio could not be loaded. Try another MP3 file.");
    }
  );
}

/** Pause / Play button in the corner — calls the same toggle logic. */
function setupPauseButton() {
  pauseButtonEl.addEventListener("click", () => {
    togglePlayPause();
  });
}

/** Toggles p5.SoundFile play state and syncs the button label. */
function togglePlayPause() {
  if (!audioFile) return;

  if (audioFile.isPlaying()) {
    audioFile.pause();
  } else {
    audioFile.play();
    // If overlay was ever shown again, dismiss it on resume.
    overlayEl.classList.add("is-hidden");
  }
  updatePauseButtonLabel();
}

/** Sets button text to “Pause” or “Play” and aria-pressed for accessibility. */
function updatePauseButtonLabel() {
  if (!audioFile) return;
  const playing = audioFile.isPlaying();
  pauseButtonEl.textContent = playing ? "Pause" : "Play";
  pauseButtonEl.setAttribute("aria-pressed", playing ? "true" : "false");
}

// -----------------------------------------------------------------------------
// AUDIO → NUMBERS (single place to read FFT + amplitude)
// -----------------------------------------------------------------------------

/**
 * Returns one object per frame with everything the visuals need.
 * When no file is loaded, returns zeros so the scene idles quietly.
 *
 * @returns {{ amp: number, bass: number, mid: number, treble: number, energy: number }}
 */
function getAudioMetrics() {
  if (!audioFile) {
    return { amp: 0, bass: 0, mid: 0, treble: 0, energy: 0 };
  }

  // Overall loudness; typical range ~0 .. 0.3+ for loud material.
  const amp = amplitudeAnalyzer.getLevel();

  // p5 maps named bands to energy 0..255 (not raw FFT bins — convenient abstraction).
  const bass = fftAnalyzer.getEnergy("bass");
  const mid = fftAnalyzer.getEnergy("mid");
  const treble = fftAnalyzer.getEnergy("treble");

  // Simple “how busy is the spectrum” scalar — drives rotation speed.
  const energy = (bass + mid + treble) / 3;

  return { amp, bass, mid, treble, energy };
}

// -----------------------------------------------------------------------------
// VISUALS: background (2D-ish planes in 3D space)
// -----------------------------------------------------------------------------

/**
 * Two stacked semi-transparent planes far on -Z, tinted by bass/treble and brightness by energy.
 * resetMatrix() inside push/pop isolates this from the rotation applied to ribbons later
 * (and from orbit — drawn before orbitControl in draw()).
 */
function drawGradientBackdrop(metrics) {
  // Bass-heavy → shift hue toward cool blues; treble-heavy → warmer yellow-orange.
  const bassHue = map(metrics.bass, 0, 255, 250, 210, true);
  const trebleHue = map(metrics.treble, 0, 255, 25, 55, true);
  const energyBoost = map(metrics.energy, 0, 255, 10, 36, true);

  push();
  resetMatrix();
  translate(0, 0, -900);
  noStroke();
  // Fourth arg is alpha (HSB mode with alpha max 100).
  fill(bassHue, 70, 16 + energyBoost, 42);
  plane(width * 2.2, height * 2.2);
  translate(0, 0, 120);
  fill(trebleHue, 52, 22 + energyBoost, 26);
  plane(width * 1.8, height * 1.8);
  pop();

  // Restore stroke mode for line drawing in renderLineSystem.
  noFill();
}

// -----------------------------------------------------------------------------
// VISUALS: 3D line ribbons + trails (audio-mapped)
// -----------------------------------------------------------------------------

/**
 * Draws all stroked 3D geometry for the music viz.
 *
 * Audio mappings (explain these when presenting):
 * 1) Amplitude → ampScale & lineWeight: louder = thicker strokes + slightly larger layout.
 * 2) Spectral energy → rotationSpeed: busier spectrum = faster sceneRotation increment.
 *    Only while isPlaying() so pausing freezes the “music-driven” spin (user can still orbit).
 * 3) Treble vs bass → hueFromPitch & brightnessFromPitch: “cold” vs “hot” palette.
 *
 * Geometry idea:
 * - Each “ribbon” is a closed loop in the XZ plane with Y wiggle (vertex loop).
 * - “Trails” are open curves that orbit at different phases for depth.
 */
function renderLineSystem(metrics) {
  // --- Mapping 1: loudness → size of the structure and stroke weight ---
  // map(..., true) clamps output to the target range if input exceeds expected max.
  const ampScale = map(metrics.amp, 0, 0.35, 0.8, 1.85, true);
  const lineWeight = map(metrics.amp, 0, 0.35, 0.8, 3.6, true);

  // --- Mapping 2: overall spectral activity → how fast the world spins ---
  const rotationSpeed = map(metrics.energy, 0, 255, 0.002, 0.045, true);
  if (audioFile && audioFile.isPlaying()) {
    sceneRotation += rotationSpeed;
  }

  // Global model rotation (in addition to whatever orbitControl did to the camera).
  // Small sine on X keeps a gentle tilt so depth is readable from more angles.
  rotateY(sceneRotation * 0.9);
  rotateX(sin(frameCount * 0.0025) * 0.2);

  // --- Mapping 3: pitch balance → color ---
  // treble - bass: if treble wins, map toward warm hues (second pair); if bass wins, cool.
  const hueFromPitch = map(metrics.treble - metrics.bass, -255, 255, 245, 35, true);
  const brightnessFromPitch = map(metrics.treble, 0, 255, 55, 100, true);

  // ----- Layered ribbon loops (closed shapes) -----
  for (let layer = 0; layer < RIBBON_LAYERS; layer += 1) {
    const layerPhase = layer * 0.7;
    const baseRadius = 120 + layer * 36;
    const hue = (hueFromPitch + layer * 16 + frameCount * 0.18) % 360;
    stroke(hue, 70, brightnessFromPitch, 75);
    strokeWeight(lineWeight + layer * 0.18);

    beginShape();
    for (let i = 0; i <= RIBBON_POINTS; i += 1) {
      // Parameter around the loop 0..2π
      const a = map(i, 0, RIBBON_POINTS, 0, TWO_PI);
      // Radial wobble: sine adds lobes; scales slightly with ampScale so beats “breathe”.
      const wave = sin(a * 3 + frameCount * 0.03 + layerPhase) * (20 + ampScale * 18);
      // Second wobble tied to mid frequencies for finer detail in the silhouette.
      const drift = cos(a * 2 + frameCount * 0.02 + layerPhase) * (12 + metrics.mid * 0.07);
      const radius = (baseRadius + wave + drift) * ampScale;
      const x = cos(a) * radius;
      // Y offset: second sine on parameter a + time + treble pushes vertical motion on highs.
      const y = sin(a * 2.1 + frameCount * 0.02 + layerPhase) * (35 + metrics.treble * 0.22);
      const z = sin(a) * radius;
      vertex(x, y, z);
    }
    endShape(CLOSE);
  }

  // ----- Orbiting open trails (extra motion, different hue family) -----
  for (let t = 0; t < ORBIT_TRAILS; t += 1) {
    const trailHue = (hueFromPitch + 120 + t * 9) % 360;
    stroke(trailHue, 60, 100, 42);
    strokeWeight(max(0.6, lineWeight * 0.55));
    beginShape();
    for (let j = 0; j < 46; j += 1) {
      const p = j / 45;
      // Angle advances with sceneRotation so trails “follow” the music-driven spin.
      const a = p * TWO_PI + sceneRotation * (1.4 + t * 0.03) + t * 0.45;
      const radius = 170 + sin(frameCount * 0.03 + t + p * 9) * (22 + metrics.bass * 0.09);
      const x = cos(a) * radius;
      const z = sin(a) * radius;
      const y = sin(p * TWO_PI * 2 + frameCount * 0.04 + t) * (22 + metrics.mid * 0.15);
      vertex(x, y, z);
    }
    endShape();
  }
}

/**
 * p5 calls this when the browser window is resized — keep canvas matched to full window.
 */
function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}
