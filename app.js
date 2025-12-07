/**
 * Nassau Shift - RNBO Web Audio Interface
 * Tropical Noir Edition
 */

class NassauShift {
  constructor() {
    this.audioContext = null;
    this.device = null;
    this.isPlaying = false;
    this.analyser = null;
    this.dataArray = null;

    // Parameter mappings
    this.parameterMap = {
      'LPF_Cutoff': { index: 0, min: 0, max: 4000, format: v => `${Math.round(v)} Hz` },
      'HPF_Cutoff': { index: 1, min: 0, max: 2000, format: v => `${Math.round(v)} Hz` },
      'HPF_Res': { index: 2, min: 0, max: 1, format: v => `${Math.round(v * 100)}%` },
      'Room_Size': { index: 3, min: 0, max: 100, format: v => `${Math.round(v)}%` },
      'LPF_Res': { index: 4, min: 0, max: 1, format: v => `${Math.round(v * 100)}%` },
      'Rev_Mix': { index: 5, min: 0, max: 100, format: v => `${Math.round(v)}%` },
      'Rev_Damp': { index: 6, min: 0, max: 100, format: v => `${Math.round(v)}%` },
      'On_Off': { index: 7, min: 0, max: 1, format: v => v > 0.5 ? 'On' : 'Off' },
      'TimeStretch': { index: 8, min: 1, max: 6, format: v => `${Math.round(v)}×` },
      'Rev_Decay': { index: 9, min: 0, max: 100, format: v => `${Math.round(v)}%` },
      'Rev_Jitter': { index: 10, min: 0, max: 100, format: v => `${Math.round(v)}%` },
    };

    // Buffer file mappings (skip 32B - too large for browser decoding)
    this.bufferFiles = {
      'b_NassauMusic_1B_mp3': 'media/NassauMusic_1B.mp3',
      'b_NassauMusic_2B_mp3': 'media/NassauMusic_2B.mp3',
      'b_NassauMusic_4B_mp3': 'media/NassauMusic_4B.mp3',
      'b_NassauMusic_8B_mp3': 'media/NassauMusic_8B.mp3',
      'b_NassauMusic_16B_mp3': 'media/NassauMusic_16B.mp3',
      // 'b_NassauMusic_32B_mp3': 'media/NassauMusic_32B.mp3', // Skipped - too large
    };

    this.isLoaded = false;

    this.knobs = new Map();
    this.activeKnob = null;
    this.startY = 0;
    this.startValue = 0;

    this.init();
  }

  async init() {
    this.setupUI();
    this.setupKnobs();
    this.setupTemporalShift();
    this.setupPowerButton();
  }

  setupUI() {
    // Cache DOM elements
    this.loadBtn = document.getElementById('loadBtn');
    this.powerBtn = document.getElementById('powerBtn');
    this.statusDot = document.getElementById('statusDot');
    this.statusText = document.getElementById('statusText');
    this.canvas = document.getElementById('waveform');
    this.canvasCtx = this.canvas.getContext('2d');
    this.meterL = document.getElementById('meterL');
    this.meterR = document.getElementById('meterR');
    this.progressContainer = document.getElementById('progressContainer');
    this.progressBar = document.getElementById('progressBar');
    this.progressText = document.getElementById('progressText');

    // Set canvas size
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
  }

  // Fetch with progress tracking
  fetchWithProgress(url, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'arraybuffer';

      xhr.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = (event.loaded / event.total) * 100;
          const loadedMB = (event.loaded / (1024 * 1024)).toFixed(1);
          const totalMB = (event.total / (1024 * 1024)).toFixed(1);
          onProgress(percent, loadedMB, totalMB);
        } else {
          // If length not computable, show bytes loaded
          const loadedMB = (event.loaded / (1024 * 1024)).toFixed(1);
          onProgress(-1, loadedMB, '?');
        }
      };

      xhr.onload = () => {
        if (xhr.status === 200) {
          resolve(xhr.response);
        } else {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error'));
      xhr.send();
    });
  }

  resizeCanvas() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.canvas.width = rect.width * window.devicePixelRatio;
    this.canvas.height = rect.height * window.devicePixelRatio;
    this.canvasCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
  }

  setupKnobs() {
    const knobElements = document.querySelectorAll('.knob');

    knobElements.forEach(knob => {
      const param = knob.dataset.param;
      const min = parseFloat(knob.dataset.min);
      const max = parseFloat(knob.dataset.max);
      const value = parseFloat(knob.dataset.value);

      // Store knob data
      this.knobs.set(knob.id, {
        element: knob,
        param,
        min,
        max,
        value,
        normalized: (value - min) / (max - min)
      });

      // Set initial rotation
      this.updateKnobVisual(knob.id);

      // Event listeners
      knob.addEventListener('mousedown', e => this.onKnobStart(e, knob.id));
      knob.addEventListener('touchstart', e => this.onKnobStart(e, knob.id), { passive: false });
    });

    // Global mouse/touch move and end
    document.addEventListener('mousemove', e => this.onKnobMove(e));
    document.addEventListener('mouseup', () => this.onKnobEnd());
    document.addEventListener('touchmove', e => this.onKnobMove(e), { passive: false });
    document.addEventListener('touchend', () => this.onKnobEnd());
  }

  onKnobStart(e, knobId) {
    e.preventDefault();
    this.activeKnob = knobId;
    const knobData = this.knobs.get(knobId);
    knobData.element.classList.add('active');

    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    this.startY = clientY;
    this.startValue = knobData.normalized;
  }

  onKnobMove(e) {
    if (!this.activeKnob) return;
    e.preventDefault();

    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const deltaY = this.startY - clientY;
    const sensitivity = 0.005;

    const knobData = this.knobs.get(this.activeKnob);
    let newNormalized = this.startValue + (deltaY * sensitivity);
    newNormalized = Math.max(0, Math.min(1, newNormalized));

    knobData.normalized = newNormalized;
    knobData.value = knobData.min + (newNormalized * (knobData.max - knobData.min));

    this.updateKnobVisual(this.activeKnob);
    this.setParameter(knobData.param, knobData.value);
  }

  onKnobEnd() {
    if (this.activeKnob) {
      const knobData = this.knobs.get(this.activeKnob);
      knobData.element.classList.remove('active');
      this.activeKnob = null;
    }
  }

  updateKnobVisual(knobId) {
    const knobData = this.knobs.get(knobId);
    const rotation = -135 + (knobData.normalized * 270);
    const knobHead = knobData.element.querySelector('.knob-head');
    const knobFill = knobData.element.querySelector('.knob-fill');

    knobHead.style.transform = `rotate(${rotation}deg)`;
    knobFill.style.setProperty('--rotation', knobData.normalized * 270);

    // Update value display
    const valueEl = document.getElementById(`val-${knobId.replace('knob-', '')}`);
    if (valueEl && this.parameterMap[knobData.param]) {
      valueEl.textContent = this.parameterMap[knobData.param].format(knobData.value);
    }
  }

  setupTemporalShift() {
    this.sliderTrack = document.getElementById('sliderTrack');
    this.sliderFill = document.getElementById('sliderFill');
    this.sliderThumb = document.getElementById('sliderThumb');
    this.sliderValue = document.getElementById('sliderValue');

    this.temporalShiftValue = 0; // 0-1 normalized
    this.isDraggingSlider = false;

    const barLabels = ['1×', '2×', '4×', '8×', '16×'];

    const updateSlider = (normalizedValue) => {
      // Clamp to 0-1
      normalizedValue = Math.max(0, Math.min(1, normalizedValue));
      this.temporalShiftValue = normalizedValue;

      // Update visuals (continuous)
      const percent = normalizedValue * 100;
      this.sliderFill.style.width = `${percent}%`;
      this.sliderThumb.style.left = `${percent}%`;

      // Calculate which integer value (1-5) this maps to
      const intValue = Math.round(normalizedValue * 4) + 1; // 1 to 5

      // Update display label
      this.sliderValue.textContent = barLabels[intValue - 1];

      // Set RNBO parameter (only responds to integers 1-5)
      this.setParameter('TimeStretch', intValue);
    };

    // Mouse/touch event handlers
    const getPositionFromEvent = (e) => {
      const rect = this.sliderTrack.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      return (clientX - rect.left) / rect.width;
    };

    const onStart = (e) => {
      e.preventDefault();
      this.isDraggingSlider = true;
      this.sliderThumb.classList.add('dragging');
      updateSlider(getPositionFromEvent(e));
    };

    const onMove = (e) => {
      if (!this.isDraggingSlider) return;
      e.preventDefault();
      updateSlider(getPositionFromEvent(e));
    };

    const onEnd = () => {
      this.isDraggingSlider = false;
      this.sliderThumb.classList.remove('dragging');
    };

    // Track clicks
    this.sliderTrack.addEventListener('mousedown', onStart);
    this.sliderTrack.addEventListener('touchstart', onStart, { passive: false });

    // Document-level move/end for smooth dragging
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);

    // Initialize at first position
    updateSlider(0);
  }

  setupPowerButton() {
    // Load button - initializes audio and loads samples
    this.loadBtn.addEventListener('click', () => this.loadSamples());

    // Play button - toggles playback (only works after loading)
    this.powerBtn.addEventListener('click', () => this.togglePlayback());
  }

  async loadSamples() {
    if (this.isLoaded) return;

    this.loadBtn.disabled = true;
    this.statusText.textContent = 'Initializing...';

    try {
      await this.initAudio();
      this.isLoaded = true;
      this.loadBtn.classList.add('loaded');
      this.powerBtn.disabled = false;
      this.statusText.textContent = 'Ready - Press Play';
    } catch (error) {
      console.error('Load failed:', error);
      this.statusText.textContent = 'Error: ' + error.message;
      this.loadBtn.disabled = false;
    }
  }

  togglePlayback() {
    if (!this.isLoaded) return;

    if (this.isPlaying) {
      this.stop();
    } else {
      this.start();
    }
  }

  async initAudio() {
    this.statusText.textContent = 'Initializing...';

    try {
      // Create audio context
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();

      // Setup analyser for visualization
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

      // Fetch the RNBO patcher
      const response = await fetch('nassau_engine.export.json');
      const patcher = await response.json();

      // Create RNBO device
      this.device = await RNBO.createDevice({ context: this.audioContext, patcher });

      // Load audio buffers
      await this.loadBuffers();

      // Initialize all parameters to their UI default values
      this.initializeParameters();

      // Connect device to output and analyser
      this.device.node.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);

      // Setup output port listeners
      this.device.messageEvent.subscribe(e => {
        if (e.tag === 'atten' || e.tag === 'compens') {
          // Handle output messages if needed
        }
      });

      this.statusText.textContent = 'Ready';

    } catch (error) {
      console.error('Failed to initialize audio:', error);
      this.statusText.textContent = 'Error: ' + error.message;
    }
  }

  async loadBuffers() {
    this.statusText.textContent = 'Loading samples...';
    this.progressContainer.classList.add('visible');

    // Get the data buffer descriptions from the device
    const dataBufferDescriptions = this.device.dataBufferDescriptions;
    console.log('Buffer descriptions:', dataBufferDescriptions);

    const totalBuffers = dataBufferDescriptions.length;
    let loadedCount = 0;

    for (const desc of dataBufferDescriptions) {
      const bufferId = desc.id;
      const filePath = this.bufferFiles[bufferId];

      if (!filePath) {
        console.warn(`No file mapping for buffer: ${bufferId}`);
        loadedCount++;
        continue;
      }

      const fileName = filePath.split('/').pop();

      try {
        this.statusText.textContent = 'Loading Environment';
        this.progressBar.style.width = '0%';
        this.progressText.textContent = `${loadedCount + 1} / ${totalBuffers}`;

        // Fetch with progress
        const arrayBuffer = await this.fetchWithProgress(filePath, (percent, loadedMB, totalMB) => {
          if (percent >= 0) {
            const overallProgress = ((loadedCount + percent / 100) / totalBuffers) * 100;
            this.progressBar.style.width = `${overallProgress}%`;
            this.progressText.textContent = `${loadedCount + 1} / ${totalBuffers}`;
          }
        });

        const sizeMB = (arrayBuffer.byteLength / (1024 * 1024)).toFixed(1);
        console.log(`Decoding ${fileName} (${sizeMB}MB)...`);

        // Decode with timeout for large files
        const decodePromise = this.audioContext.decodeAudioData(arrayBuffer);
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Decode timeout - file too large')), 60000)
        );

        console.log(`Starting decode for ${fileName}...`);
        const audioBuffer = await Promise.race([decodePromise, timeoutPromise]);
        console.log(`Decode complete for ${fileName}`);

        // Set the buffer using RNBO's API - pass AudioBuffer directly
        console.log(`Setting buffer ${bufferId}...`);
        await this.device.setDataBuffer(bufferId, audioBuffer);
        console.log(`Buffer ${bufferId} set successfully`);

        loadedCount++;
        console.log(`✓ Loaded: ${bufferId} (${audioBuffer.length} samples, ${audioBuffer.numberOfChannels}ch, ${audioBuffer.sampleRate}Hz)`);
      } catch (error) {
        console.error(`✗ Failed to load buffer ${bufferId}:`, error);
        this.statusText.textContent = `Error: ${error.message}`;
        this.progressText.textContent = error.message;
        loadedCount++;
      }
    }

    this.progressContainer.classList.remove('visible');
    this.statusText.textContent = `Ready - Click to Play`;
    console.log('All buffers loaded!');
  }

  start() {
    if (!this.device) return;

    this.isPlaying = true;
    this.powerBtn.classList.add('active');
    this.statusDot.classList.add('active');
    this.statusText.textContent = 'Playing';
    this.meterL.classList.add('active');
    this.meterR.classList.add('active');

    // Resume audio context if suspended
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    // Force all filter resonances to their UI values before turning on
    // This ensures the RNBO device has the correct values
    const hpfResKnob = this.knobs.get('knob-hpf-res');
    const lpfResKnob = this.knobs.get('knob-lpf-res');
    if (hpfResKnob) this.setRNBOParam('HPF_Res', hpfResKnob.value);
    if (lpfResKnob) this.setRNBOParam('LPF_Res', lpfResKnob.value);

    // Turn on the device
    this.setParameter('On_Off', 1);

    // Re-send resonance values after a short delay (some RNBO devices need this)
    setTimeout(() => {
      if (hpfResKnob) this.setRNBOParam('HPF_Res', hpfResKnob.value);
      if (lpfResKnob) this.setRNBOParam('LPF_Res', lpfResKnob.value);
    }, 100);

    // Start visualization
    this.drawWaveform();
  }

  stop() {
    if (!this.device) return;

    this.isPlaying = false;
    this.powerBtn.classList.remove('active');
    this.statusDot.classList.remove('active');
    this.statusText.textContent = 'Stopped';
    this.meterL.classList.remove('active');
    this.meterR.classList.remove('active');

    // Turn off the device
    this.setParameter('On_Off', 0);
  }

  // Direct parameter setter - sets value on RNBO device
  setRNBOParam(name, value) {
    if (!this.device) return;
    const params = this.device.parameters;
    for (let param of params) {
      if (param.name === name || param.id === name) {
        param.value = value;
        console.log(`RNBO: ${name} = ${value}`);
        break;
      }
    }
  }

  setParameter(name, value) {
    if (!this.device) return;

    const paramInfo = this.parameterMap[name];
    if (!paramInfo) return;

    // For filter parameters, always send both cutoff and resonance together
    // Send Res BEFORE Cutoff (matching how LPF seems to work internally)
    if (name === 'HPF_Cutoff' || name === 'HPF_Res') {
      const hpfCutoffKnob = this.knobs.get('knob-hpf-cutoff');
      const hpfResKnob = this.knobs.get('knob-hpf-res');

      // Use the new value for the parameter being changed, current value for the other
      const cutoffVal = (name === 'HPF_Cutoff') ? value : (hpfCutoffKnob ? hpfCutoffKnob.value : 0);
      const resVal = (name === 'HPF_Res') ? value : (hpfResKnob ? hpfResKnob.value : 0);

      // Send Res first, then Cutoff (order matters for some filter implementations)
      this.setRNBOParam('HPF_Res', resVal);
      this.setRNBOParam('HPF_Cutoff', cutoffVal);
      return;
    }

    if (name === 'LPF_Cutoff' || name === 'LPF_Res') {
      const lpfCutoffKnob = this.knobs.get('knob-lpf-cutoff');
      const lpfResKnob = this.knobs.get('knob-lpf-res');

      const cutoffVal = (name === 'LPF_Cutoff') ? value : (lpfCutoffKnob ? lpfCutoffKnob.value : 4000);
      const resVal = (name === 'LPF_Res') ? value : (lpfResKnob ? lpfResKnob.value : 0);

      this.setRNBOParam('LPF_Cutoff', cutoffVal);
      this.setRNBOParam('LPF_Res', resVal);
      return;
    }

    // For all other parameters, just set directly
    this.setRNBOParam(name, value);
  }

  initializeParameters() {
    // Sync all knob values to RNBO device
    console.log('Initializing parameters from UI values...');

    for (const [knobId, knobData] of this.knobs) {
      this.setParameter(knobData.param, knobData.value);
      console.log(`  ${knobData.param} = ${knobData.value}`);
    }

    // Also set TimeStretch to initial value
    this.setParameter('TimeStretch', 1);

    // Ensure On_Off is off initially
    this.setParameter('On_Off', 0);
  }

  drawWaveform() {
    if (!this.isPlaying) {
      // Clear canvas when stopped
      this.canvasCtx.fillStyle = 'rgba(20, 28, 38, 1)';
      this.canvasCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }

    requestAnimationFrame(() => this.drawWaveform());

    this.analyser.getByteFrequencyData(this.dataArray);

    const width = this.canvas.width / window.devicePixelRatio;
    const height = this.canvas.height / window.devicePixelRatio;

    // Clear with fade effect
    this.canvasCtx.fillStyle = 'rgba(20, 28, 38, 0.3)';
    this.canvasCtx.fillRect(0, 0, width, height);

    // Draw frequency bars
    const barWidth = width / this.dataArray.length * 2.5;
    let x = 0;

    for (let i = 0; i < this.dataArray.length; i++) {
      const barHeight = (this.dataArray[i] / 255) * height * 0.8;

      // Create gradient for each bar
      const gradient = this.canvasCtx.createLinearGradient(0, height, 0, height - barHeight);
      gradient.addColorStop(0, 'rgba(0, 210, 211, 0.8)');
      gradient.addColorStop(0.5, 'rgba(84, 160, 255, 0.6)');
      gradient.addColorStop(1, 'rgba(255, 107, 107, 0.4)');

      this.canvasCtx.fillStyle = gradient;
      this.canvasCtx.fillRect(x, height - barHeight, barWidth - 1, barHeight);

      x += barWidth;
    }

    // Update level meters
    const avgLevel = this.dataArray.reduce((a, b) => a + b, 0) / this.dataArray.length;
    const levelPercent = (avgLevel / 255) * 100;
    this.meterL.style.setProperty('--level', `${levelPercent}%`);
    this.meterR.style.setProperty('--level', `${levelPercent * 0.9}%`);
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.nassauShift = new NassauShift();
});
