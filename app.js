/**
 * STEM Smart Labs Bluetooth Controller - app.js
 * Implements Web Bluetooth client for BBC micro:bit and custom UI bindings.
 */

// Bluetooth Service & Characteristic UUIDs (Nordic UART Service - NUS)
const UART_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const UART_RX_CHARACTERISTIC_UUID = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Swapped for LOFI by default (Write to 0003)
const UART_TX_CHARACTERISTIC_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Swapped for LOFI by default (Read from 0002)

// App State Management
const state = {
  bluetooth: {
    device: null,
    server: null,
    service: null,
    rxCharacteristic: null,
    txCharacteristic: null,
    connected: false,
  },
  controlMode: 'dpad', // 'dpad', 'joystick', 'mixed', 'tilt'
  tiltEnabled: false,
  joystick: {
    active: false,
    x: 0, // -100 to 100
    y: 0, // -100 to 100
    lastSentX: 0,
    lastSentY: 0,
    activeDir: null // null, 'UP', 'DOWN', 'LEFT', 'RIGHT'
  },
  sliders: {
    s1: 90,
    s2: 90,
    lastSentS1: 90,
    lastSentS2: 90
  },
  tilt: {
    roll: 0, // steering (-100 to 100)
    pitch: 0, // speed (-100 to 100)
    lastSentRoll: 0,
    lastSentPitch: 0,
    activeDir: null // null, 'UP', 'DOWN', 'LEFT', 'RIGHT'
  },
  lastTransmissionTime: 0,
  minTransmitInterval: 60, // ms between consecutive continuous commands (throttling)
  logCount: 0
};

// DOM Elements
let elConnectBtn, elStatusBadge, elStatusText, elLogList, elTiltToggle, elLiveMonitorValue;
let elDpadButtons = {};
let elJoystickOuter, elJoystickHandle, elJoystickValX, elJoystickValY;
let elSliderS1, elSliderS2, elSliderValS1, elSliderValS2;
let elActionButtons = {};

// Initialize App on DOM Load
document.addEventListener('DOMContentLoaded', () => {
  initDOMElements();
  checkBluetoothSupport();
  setupEventListeners();
  initJoystickEngine();
  initTiltControl();
  startTransmitTick();
});

function checkBluetoothSupport() {
  if (!navigator.bluetooth) {
    const banner = document.getElementById('ble-warning-banner');
    if (banner) banner.style.display = 'flex';
    elConnectBtn.disabled = true;
    elConnectBtn.title = "Web Bluetooth not supported in this browser/context";
    addLog("WARNING: Web Bluetooth is not supported or is restricted in this browser context (requires HTTPS or localhost).");
  }
}

// Cache DOM References
function initDOMElements() {
  elConnectBtn = document.getElementById('connect-btn');
  elStatusBadge = document.getElementById('status-badge');
  elStatusText = document.getElementById('status-text');
  elLogList = document.getElementById('log-list');
  elTiltToggle = document.getElementById('tilt-toggle');
  elLiveMonitorValue = document.getElementById('live-monitor-value');

  // Dpad buttons
  elDpadButtons.up = document.querySelector('.dpad-up');
  elDpadButtons.left = document.querySelector('.dpad-left');
  elDpadButtons.stop = document.querySelector('.dpad-stop');
  elDpadButtons.right = document.querySelector('.dpad-right');
  elDpadButtons.down = document.querySelector('.dpad-down');

  // Joystick
  elJoystickOuter = document.querySelector('.joystick-outer');
  elJoystickHandle = document.querySelector('.joystick-handle');
  elJoystickValX = document.getElementById('joy-val-x');
  elJoystickValY = document.getElementById('joy-val-y');

  // Sliders
  elSliderS1 = document.getElementById('slider-s1');
  elSliderS2 = document.getElementById('slider-s2');
  elSliderValS1 = document.getElementById('slider-val-s1');
  elSliderValS2 = document.getElementById('slider-val-s2');

  // Action buttons
  elActionButtons.a = document.getElementById('btn-a');
  elActionButtons.b = document.getElementById('btn-b');
  elActionButtons.c = document.getElementById('btn-c');
  elActionButtons.d = document.getElementById('btn-d');
}

// Bind Events
function setupEventListeners() {
  // Bluetooth Connection Button
  elConnectBtn.addEventListener('click', toggleConnection);

  // Mode Switch Tabs
  document.querySelectorAll('.tab-btn').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const mode = e.currentTarget.dataset.mode;
      switchMode(mode);
    });
  });

  // Clear Logs
  document.getElementById('clear-logs').addEventListener('click', () => {
    elLogList.innerHTML = '';
    state.logCount = 0;
  });

  // Copy Code Blocks
  document.querySelectorAll('.code-copy-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const codeId = e.currentTarget.dataset.target;
      const codeText = document.getElementById(codeId).innerText;
      navigator.clipboard.writeText(codeText).then(() => {
        const originalText = e.currentTarget.innerText;
        e.currentTarget.innerText = 'COPIED!';
        e.currentTarget.style.borderColor = 'var(--neon-green)';
        setTimeout(() => {
          e.currentTarget.innerText = originalText;
          e.currentTarget.style.borderColor = '';
        }, 1500);
      });
    });
  });

  // Dpad Actions
  setupDpadActions();

  // Keyboard Bindings
  setupKeyboardActions();

  // Sliders
  elSliderS1.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    state.sliders.s1 = val;
    elSliderValS1.innerText = val + '°';
  });
  elSliderS2.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    state.sliders.s2 = val;
    elSliderValS2.innerText = val + '°';
  });

  // Action Buttons
  Object.keys(elActionButtons).forEach(key => {
    const btn = elActionButtons[key];
    const pressCmd = key.toUpperCase() + '\n';
    const releaseCmd = key.toLowerCase() + '\n';

    // Mouse Events
    btn.addEventListener('mousedown', () => {
      btn.classList.add('active');
      transmitImmediate(pressCmd);
    });
    const releaseAction = () => {
      if (btn.classList.contains('active')) {
        btn.classList.remove('active');
        transmitImmediate(releaseCmd);
      }
    };
    btn.addEventListener('mouseup', releaseAction);
    btn.addEventListener('mouseleave', releaseAction);

    // Touch Events
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      btn.classList.add('active');
      transmitImmediate(pressCmd);
    });
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      releaseAction();
    });
  });

  // Modal Help Window
  const modal = document.getElementById('help-modal');
  document.getElementById('btn-show-help').addEventListener('click', () => {
    modal.classList.add('active');
  });
  document.getElementById('modal-close').addEventListener('click', () => {
    modal.classList.remove('active');
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.remove('active');
  });


}

// Switch Interface Mode
function switchMode(mode) {
  state.controlMode = mode;

  // Update Tab Styling
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  // Update View Visibility
  document.querySelectorAll('.view-content').forEach(view => {
    view.classList.toggle('active', view.id === `view-${mode}`);
  });

  // Disable accelerometer orientation updates if we switch away from tilt
  if (mode !== 'tilt' && state.tiltEnabled) {
    toggleTilt(false);
  }

  // If switching to Dpad, make sure robot is stopped
  if (mode === 'dpad') {
    transmitImmediate('up\n');
  }

  // Send mode update command to micro:bit
  const modeMessage = {
    dpad: 'mode_dpad\n',
    joystick: 'mode_analog\n',
    tilt: 'mode_accelerometer\n',
    mixed: 'mode_mixed\n'
  }[mode];
  if (modeMessage) {
    transmitImmediate(modeMessage);
  }

  addLog(`Switched control mode to: ${mode.toUpperCase()}`);
}

/* ==========================================
   WEB BLUETOOTH DRIVER
   ========================================== */

async function toggleConnection() {
  if (state.bluetooth.connected) {
    disconnectDevice();
  } else {
    await connectDevice();
  }
}

async function connectDevice() {
  addLog('Scanning for micro:bit BLE devices...');
  elConnectBtn.disabled = true;

  try {
    // Request device with the Nordic UART Service
    state.bluetooth.device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: 'Calliope mini' },
        { namePrefix: 'BBC micro:bit' },
        { namePrefix: 'micro:bit' }
      ],
      optionalServices: [UART_SERVICE_UUID]
    });

    addLog(`Device found: ${state.bluetooth.device.name}. Connecting...`);

    // Connect to GATT Server
    state.bluetooth.device.addEventListener('gattserverdisconnected', onDisconnected);
    state.bluetooth.server = await state.bluetooth.device.gatt.connect();

    // Get UART Service
    addLog('Requesting UART service...');
    state.bluetooth.service = await state.bluetooth.server.getPrimaryService(UART_SERVICE_UUID);

    // Get TX Characteristic (0002) first and start notifications immediately.
    // This sequence matches the official LOFI Control app exactly and is crucial
    // for triggering the micro:bit's internal UART buffer initialization.
    addLog('Acquiring notification characteristic...');
    state.bluetooth.txCharacteristic = await state.bluetooth.service.getCharacteristic(UART_TX_CHARACTERISTIC_UUID);

    addLog('Enabling micro:bit UART feedback loop...');
    await state.bluetooth.txCharacteristic.startNotifications();
    state.bluetooth.txCharacteristic.addEventListener('characteristicvaluechanged', handleIncomingData);
    addLog('Feedback channel active.');

    // Get RX Characteristic (0003) for sending commands
    addLog('Acquiring write characteristic...');
    state.bluetooth.rxCharacteristic = await state.bluetooth.service.getCharacteristic(UART_RX_CHARACTERISTIC_UUID);
    addLog('Write channel active.');

    // Update Connection State
    state.bluetooth.connected = true;
    updateConnectionUI(true);
    addLog('CONNECTED successfully! Control interface active.');

  } catch (error) {
    addLog(`Connection failed: ${error.message}`);
    elConnectBtn.disabled = false;
    disconnectDevice();
  }
}

function disconnectDevice() {
  if (state.bluetooth.device && state.bluetooth.device.gatt.connected) {
    addLog('Disconnecting Bluetooth connection...');
    state.bluetooth.device.gatt.disconnect();
  } else {
    // Manually trigger cleanup if connection state went out of sync
    onDisconnected();
  }
}

function onDisconnected() {
  state.bluetooth.device = null;
  state.bluetooth.server = null;
  state.bluetooth.service = null;
  state.bluetooth.rxCharacteristic = null;
  state.bluetooth.txCharacteristic = null;
  state.bluetooth.connected = false;

  updateConnectionUI(false);
  addLog('DISCONNECTED. Controller is offline.');
}

function updateConnectionUI(connected) {
  elConnectBtn.disabled = false;

  if (connected) {
    elConnectBtn.textContent = 'Disconnect';
    elConnectBtn.className = 'btn btn-danger';

    elStatusBadge.className = 'status-badge connected';
    elStatusText.textContent = 'CONNECTED';
  } else {
    elConnectBtn.textContent = 'Pair Micro:bit';
    elConnectBtn.className = 'btn btn-primary';

    elStatusBadge.className = 'status-badge disconnected';
    elStatusText.textContent = 'OFFLINE';
  }

  // Update mobile status ticker
  if (elLiveMonitorValue) {
    if (connected) {
      elLiveMonitorValue.textContent = 'CONNECTED';
      elLiveMonitorValue.style.color = 'var(--neon-cyan)';
      elLiveMonitorValue.style.textShadow = '0 0 5px rgba(0, 240, 255, 0.3)';
    } else {
      elLiveMonitorValue.textContent = 'OFFLINE';
      elLiveMonitorValue.style.color = '#ffffff';
      elLiveMonitorValue.style.textShadow = 'none';
    }
  }
}

// Receive feedback from Micro:bit
function handleIncomingData(event) {
  const value = event.target.value;
  const decoder = new TextDecoder('utf-8');
  const message = decoder.decode(value);
  addLog(`[RX] ${message.trim()}`);
}

// Send data over BLE (immediately - e.g. for key down / click)
function transmitImmediate(payload) {
  if (!state.bluetooth.connected || !state.bluetooth.rxCharacteristic) {
    // Show in log locally even if disconnected to verify UI functions
    addLocalLog(payload);
    return;
  }

  sendData(payload);
}

let gattWriteQueue = Promise.resolve();

function queueGattWrite(bytes, payload) {
  gattWriteQueue = gattWriteQueue.then(async () => {
    if (!state.bluetooth.connected || !state.bluetooth.rxCharacteristic) return;

    try {
      if (state.bluetooth.rxCharacteristic.writeValue) {
        await state.bluetooth.rxCharacteristic.writeValue(bytes);
      } else if (state.bluetooth.rxCharacteristic.writeValueWithoutResponse) {
        await state.bluetooth.rxCharacteristic.writeValueWithoutResponse(bytes);
      } else if (state.bluetooth.rxCharacteristic.writeValueWithResponse) {
        await state.bluetooth.rxCharacteristic.writeValueWithResponse(bytes);
      }

      addLocalLog(payload);
      state.lastTransmissionTime = Date.now();
    } catch (err) {
      addLog(`Send error: ${err.message}`);
    }
  }).catch(() => { });
}

// Actually write bytes to GATT characteristic
async function sendData(payload) {
  try {
    // If payload doesn't end with a newline, append it
    let msg = payload;
    if (!msg.endsWith('\n')) {
      msg += '\n';
    }
    const encoder = new TextEncoder('utf-8');
    const bytes = encoder.encode(msg);
    queueGattWrite(bytes, msg);
  } catch (err) {
    addLog(`Encoding error: ${err.message}`);
  }
}

// Local scrolling logger
function addLocalLog(payload) {
  addLog(`[TX] ${payload.replace('\n', '\\n')}`);
}

function addLog(message) {
  const time = new Date().toLocaleTimeString([], { hour12: false, fractionGroupDigits: 3 });

  const entry = document.createElement('div');
  entry.className = 'log-entry';

  const timeEl = document.createElement('span');
  timeEl.className = 'log-time';
  timeEl.textContent = time;

  const payloadEl = document.createElement('span');
  if (message.startsWith('[TX]')) {
    payloadEl.className = 'log-direction';
    payloadEl.style.color = 'var(--neon-orange)';
  } else if (message.startsWith('[RX]')) {
    payloadEl.className = 'log-direction';
    payloadEl.style.color = 'var(--neon-cyan)';
  } else {
    payloadEl.className = 'log-data';
    payloadEl.style.color = '#64748b';
  }
  payloadEl.textContent = message;

  entry.appendChild(timeEl);
  entry.appendChild(payloadEl);
  elLogList.appendChild(entry);

  // Maintain a clean scroll container
  state.logCount++;
  if (state.logCount > 100) {
    elLogList.removeChild(elLogList.firstChild);
    state.logCount--;
  }

  elLogList.scrollTop = elLogList.scrollHeight;

  // Update live activity monitor ticker values
  if (elLiveMonitorValue) {
    if (message.startsWith('[TX]')) {
      const cleanMsg = message.replace('[TX] ', '').replace('\\n', '').trim();
      elLiveMonitorValue.textContent = `TX: ${cleanMsg}`;
      elLiveMonitorValue.style.color = 'var(--neon-orange)';
      elLiveMonitorValue.style.textShadow = '0 0 5px rgba(255, 107, 53, 0.3)';
    } else if (message.startsWith('[RX]')) {
      const cleanMsg = message.replace('[RX] ', '').trim();
      elLiveMonitorValue.textContent = `RX: ${cleanMsg}`;
      elLiveMonitorValue.style.color = 'var(--neon-cyan)';
      elLiveMonitorValue.style.textShadow = '0 0 5px rgba(0, 240, 255, 0.3)';
    }
  }
}

/* ==========================================
   D-PAD INTERFACE ENGINE
   ========================================== */

function setupDpadActions() {
  const directions = [
    { key: 'up', pressCmd: 'UP\n', releaseCmd: 'up\n' },
    { key: 'down', pressCmd: 'DOWN\n', releaseCmd: 'down\n' },
    { key: 'left', pressCmd: 'LEFT\n', releaseCmd: 'left\n' },
    { key: 'right', pressCmd: 'RIGHT\n', releaseCmd: 'right\n' },
    { key: 'stop', pressCmd: 'STOP\n', releaseCmd: 'STOP\n' }
  ];

  directions.forEach(({ key, pressCmd, releaseCmd }) => {
    const btn = elDpadButtons[key];
    if (!btn) return;

    // Mouse bindings
    btn.addEventListener('mousedown', () => {
      btn.classList.add('active');
      transmitImmediate(pressCmd);
    });
    btn.addEventListener('mouseup', () => {
      btn.classList.remove('active');
      if (key !== 'stop') transmitImmediate(releaseCmd); // Stop when released
    });
    btn.addEventListener('mouseleave', () => {
      if (btn.classList.contains('active')) {
        btn.classList.remove('active');
        if (key !== 'stop') transmitImmediate(releaseCmd);
      }
    });

    // Touch bindings (mobile)
    btn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      btn.classList.add('active');
      transmitImmediate(pressCmd);
    });
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      btn.classList.remove('active');
      if (key !== 'stop') transmitImmediate(releaseCmd);
    });
  });
}

/* ==========================================
   KEYBOARD CONTROLS BINDING
   ========================================== */

function setupKeyboardActions() {
  const keyMap = {
    'ArrowUp': { key: 'up', pressCmd: 'UP\n', releaseCmd: 'up\n' },
    'w': { key: 'up', pressCmd: 'UP\n', releaseCmd: 'up\n' },
    'ArrowDown': { key: 'down', pressCmd: 'DOWN\n', releaseCmd: 'down\n' },
    's': { key: 'down', pressCmd: 'DOWN\n', releaseCmd: 'down\n' },
    'ArrowLeft': { key: 'left', pressCmd: 'LEFT\n', releaseCmd: 'left\n' },
    'a': { key: 'left', pressCmd: 'LEFT\n', releaseCmd: 'left\n' },
    'ArrowRight': { key: 'right', pressCmd: 'RIGHT\n', releaseCmd: 'right\n' },
    'd': { key: 'right', pressCmd: 'RIGHT\n', releaseCmd: 'right\n' },
    ' ': { key: 'stop', pressCmd: 'up\n', releaseCmd: 'up\n' },
    'Escape': { key: 'stop', pressCmd: 'up\n', releaseCmd: 'up\n' }
  };

  let currentActiveKey = null;

  window.addEventListener('keydown', (e) => {
    // Only capture keyboard inputs if D-Pad view is active and we are not writing in a text input (if any)
    if (state.controlMode !== 'dpad' && state.controlMode !== 'mixed') return;

    const action = keyMap[e.key];
    if (!action) return;

    // Prevent scrolling
    e.preventDefault();

    if (currentActiveKey === e.key) return; // Ignore hold key repeat events

    currentActiveKey = e.key;

    const dpadBtn = elDpadButtons[action.key];
    if (dpadBtn) dpadBtn.classList.add('active');

    transmitImmediate(action.pressCmd);
  });

  window.addEventListener('keyup', (e) => {
    if (state.controlMode !== 'dpad' && state.controlMode !== 'mixed') return;

    const action = keyMap[e.key];
    if (!action) return;

    e.preventDefault();

    if (currentActiveKey === e.key) {
      currentActiveKey = null;
    }

    const dpadBtn = elDpadButtons[action.key];
    if (dpadBtn) dpadBtn.classList.remove('active');

    // Only send stop command if releasing directions (not stop keys themselves)
    if (action.key !== 'stop') {
      transmitImmediate(action.releaseCmd);
    }
  });
}

/* ==========================================
   ANALOG JOYSTICK CONTROLLER
   ========================================== */

function initJoystickEngine() {
  const outer = elJoystickOuter;
  const handle = elJoystickHandle;

  let stickActive = false;

  // Set default handles center
  resetJoystickHandlePosition();

  function resetJoystickHandlePosition() {
    handle.style.left = '50%';
    handle.style.top = '50%';
    handle.style.transform = 'translate(-50%, -50%)';
    state.joystick.x = 0;
    state.joystick.y = 0;
    updateJoystickValDisplays(0, 0);
  }

  function updateJoystickValDisplays(x, y) {
    elJoystickValX.textContent = Math.round(x);
    elJoystickValY.textContent = Math.round(y);
  }

  function handlePointer(event) {
    const rect = outer.getBoundingClientRect();
    const radius = rect.width / 2;
    const cx = rect.left + radius;
    const cy = rect.top + radius;

    let deltaX = event.clientX - cx;
    let deltaY = event.clientY - cy;

    // Joystick circle distance math
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const maxDistance = radius - 15; // Padding inside container

    if (distance > maxDistance) {
      const angle = Math.atan2(deltaY, deltaX);
      deltaX = Math.cos(angle) * maxDistance;
      deltaY = Math.sin(angle) * maxDistance;
    }

    // Move visual handle
    handle.style.transform = 'none';
    handle.style.left = `${radius + deltaX - handle.offsetWidth / 2}px`;
    handle.style.top = `${radius + deltaY - handle.offsetHeight / 2}px`;

    // Map Cartesian coordinates to -90 to 90 (Inverting Y axis for standard cartesian coordinate speed mapping)
    const normX = (deltaX / maxDistance) * 90;
    const normY = -(deltaY / maxDistance) * 90;

    state.joystick.x = normX;
    state.joystick.y = normY;

    updateJoystickValDisplays(normX, normY);

    // Emulate D-Pad directions for simpler micro:bit programs
    let currentDir = null;
    if (normY > 45) currentDir = 'UP';
    else if (normY < -45) currentDir = 'DOWN';
    else if (normX < -45) currentDir = 'LEFT';
    else if (normX > 45) currentDir = 'RIGHT';

    if (currentDir !== state.joystick.activeDir) {
      if (state.joystick.activeDir) {
        transmitImmediate(state.joystick.activeDir.toLowerCase() + '\n');
      }
      if (currentDir) {
        transmitImmediate(currentDir + '\n');
      }
      state.joystick.activeDir = currentDir;
    }
  }

  // Pointer Event listeners (robust unified touch/mouse handling)
  outer.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    stickActive = true;
    outer.classList.add('active-drag');
    outer.setPointerCapture(e.pointerId);
    handlePointer(e);
  });

  outer.addEventListener('pointermove', (e) => {
    if (!stickActive) return;
    e.preventDefault();
    handlePointer(e);
  });

  const handleRelease = (e) => {
    if (!stickActive) return;
    stickActive = false;
    outer.classList.remove('active-drag');
    resetJoystickHandlePosition();

    if (e && e.pointerId !== undefined) {
      try {
        outer.releasePointerCapture(e.pointerId);
      } catch (err) {}
    }

    // Transmit stop command immediately if active
    if (state.joystick.activeDir) {
      transmitImmediate(state.joystick.activeDir.toLowerCase() + '\n');
      state.joystick.activeDir = null;
    }
  };

  outer.addEventListener('pointerup', handleRelease);
  outer.addEventListener('pointercancel', handleRelease);
  outer.addEventListener('pointerleave', handleRelease);
}

/* ==========================================
   ACCELEROMETER / TILT ENGINE
   ========================================== */

function initTiltControl() {
  elTiltToggle.addEventListener('click', toggleTiltMode);
}

async function toggleTiltMode() {
  if (state.tiltEnabled) {
    toggleTilt(false);
  } else {
    // Request DeviceOrientation API permission on iOS 13+ devices
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission === 'granted') {
          toggleTilt(true);
        } else {
          addLog('Tilt Control permission denied by user.');
        }
      } catch (err) {
        addLog(`Tilt orientation activation error: ${err.message}`);
      }
    } else {
      // Standard browsers
      toggleTilt(true);
    }
  }
}

function toggleTilt(enable) {
  state.tiltEnabled = enable;

  if (enable) {
    elTiltToggle.textContent = 'TILT ENABLED';
    elTiltToggle.classList.add('enabled');
    window.addEventListener('deviceorientation', handleOrientation);
    addLog('Accelerometer Tilt controller activated.');
  } else {
    elTiltToggle.textContent = 'ENABLE TILT';
    elTiltToggle.classList.remove('enabled');
    window.removeEventListener('deviceorientation', handleOrientation);

    // Reset visual plane
    const plane = document.getElementById('tilt-plane');
    plane.style.transform = 'rotateX(0deg) rotateY(0deg)';

    // Transmit stop command if active
    if (state.tilt.activeDir) {
      transmitImmediate(state.tilt.activeDir.toLowerCase() + '\n');
      state.tilt.activeDir = null;
    }
    addLog('Accelerometer Tilt controller deactivated.');
  }
}

function handleOrientation(event) {
  if (state.controlMode !== 'tilt' || !state.tiltEnabled) return;

  // Pitch (beta: front/back tilt in degrees [-180, 180])
  // Roll (gamma: left/right tilt in degrees [-90, 90])
  let pitch = event.beta;
  let roll = event.gamma;

  // Standard hand posture tilt settings:
  // Tilting forward beta goes positive (around 45deg is comfortable forward limit)
  // Tilting backward beta goes negative (around 10deg is comfortable backward limit)
  // Roll comfortable limit is approx +/-35deg

  // Normalise Pitch (speed mapping)
  // Let's assume neutral hand rest position is beta = 45deg
  const neutralPitch = 45;
  const pitchRange = 35; // Sensitivity range
  let offsetPitch = pitch - neutralPitch;

  // Clamp pitch to +/- range
  if (offsetPitch > pitchRange) offsetPitch = pitchRange;
  if (offsetPitch < -pitchRange) offsetPitch = -pitchRange;

  // Map to -90 to 90 (forward = negative offset if tilting down? No, tilting down pitch decreases. 
  // Let's normalize so tilting forward sends positive numbers, tilting backward sends negative numbers)
  const normPitch = Math.round((offsetPitch / pitchRange) * -90);

  // Normalise Roll (steering mapping)
  const rollRange = 30; // Sensitivity range
  let clampedRoll = roll;
  if (clampedRoll > rollRange) clampedRoll = rollRange;
  if (clampedRoll < -rollRange) clampedRoll = -rollRange;

  const normRoll = Math.round((clampedRoll / rollRange) * 90);

  state.tilt.pitch = normPitch;
  state.tilt.roll = normRoll;

  // Update Real-time Plane Visualization (Rotate CSS)
  const plane = document.getElementById('tilt-plane');
  plane.style.transform = `rotateX(${normPitch * 0.25}deg) rotateY(${normRoll * 0.25}deg)`;

  // Real-time Text updates
  document.getElementById('tilt-val-roll').textContent = normRoll;
  document.getElementById('tilt-val-pitch').textContent = normPitch;

  // Emulate D-Pad directions for simpler micro:bit programs
  let currentDir = null;
  if (normPitch > 40) currentDir = 'UP';
  else if (normPitch < -40) currentDir = 'DOWN';
  else if (normRoll < -40) currentDir = 'LEFT';
  else if (normRoll > 40) currentDir = 'RIGHT';

  if (currentDir !== state.tilt.activeDir) {
    if (state.tilt.activeDir) {
      transmitImmediate(state.tilt.activeDir.toLowerCase() + '\n');
    }
    if (currentDir) {
      transmitImmediate(currentDir + '\n');
    }
    state.tilt.activeDir = currentDir;
  }
}

/* ==========================================
   TRANSMIT LOOP TICK (THROTTLED WRITES)
   ========================================== */

function sendJoystickCommand(x, y) {
  // Clamp values to -90 to 90 as per LOFI Control protocol
  const xi = Math.round(Math.min(90, Math.max(-90, x)));
  const yi = Math.round(Math.min(90, Math.max(-90, y)));

  const fmt = (v) => {
    const sign = v >= 0 ? "+" : "-";
    const abs = Math.abs(v);
    return `${sign}${String(abs).padStart(2, "0")}`;
  };

  sendData(`X${fmt(xi)},Y${fmt(yi)}`);
}

function startTransmitTick() {
  // Main event-driven loop that throttles continuous inputs (joystick, tilt, sliders)
  setInterval(() => {
    if (!state.bluetooth.connected) return;

    const now = Date.now();
    if (now - state.lastTransmissionTime < state.minTransmitInterval) return;

    // 1. Send Joystick Values if mode is active and values changed
    if (state.controlMode === 'joystick') {
      const x = Math.round(state.joystick.x);
      const y = Math.round(state.joystick.y);

      if (x !== state.joystick.lastSentX || y !== state.joystick.lastSentY) {
        state.joystick.lastSentX = x;
        state.joystick.lastSentY = y;
        sendJoystickCommand(x, y);
        return; // Prioritize one command per tick
      }
    }

    // 2. Send Accelerometer Tilt Values if active and values changed
    if (state.controlMode === 'tilt' && state.tiltEnabled) {
      const roll = state.tilt.roll;
      const pitch = state.tilt.pitch;

      if (roll !== state.tilt.lastSentRoll || pitch !== state.tilt.lastSentPitch) {
        state.tilt.lastSentRoll = roll;
        state.tilt.lastSentPitch = pitch;
        sendJoystickCommand(roll, pitch);
        return;
      }
    }

    // 3. Send Slider Values if active and values changed
    if (state.controlMode === 'mixed') {
      const s1 = state.sliders.s1;
      const s2 = state.sliders.s2;

      if (s1 !== state.sliders.lastSentS1) {
        state.sliders.lastSentS1 = s1;
        // Slider 1/C uses 'c' followed by 3-digit padded value (0-180)
        sendData(`c${String(s1).padStart(3, '0')}`);
        return;
      }
      if (s2 !== state.sliders.lastSentS2) {
        state.sliders.lastSentS2 = s2;
        // Slider 2/X uses 'x' followed by 3-digit padded value (0-180)
        sendData(`x${String(s2).padStart(3, '0')}`);
        return;
      }
    }

  }, 30); // Run checker slightly faster than minimum write interval to ensure responsiveness
}
