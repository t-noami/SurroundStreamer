"use strict";

const MAX_CHANNELS = 8;
const CORS_PROXY_BASE = "https://mp3-proxy.onrender.com/";

const layouts = {
  mono: {
    count: 1,
    channels: [{ label: "C", role: "Center", azimuth: 0, elevation: 0, distance: 1.1 }],
  },
  stereo: {
    count: 2,
    channels: [
      { label: "L", role: "Left", azimuth: -30, elevation: 0, distance: 1.1 },
      { label: "R", role: "Right", azimuth: 30, elevation: 0, distance: 1.1 },
    ],
  },
  quad: {
    count: 4,
    channels: [
      { label: "FL", role: "Front L", azimuth: -45, elevation: 0, distance: 1.15 },
      { label: "FR", role: "Front R", azimuth: 45, elevation: 0, distance: 1.15 },
      { label: "RL", role: "Rear L", azimuth: -135, elevation: 0, distance: 1.2 },
      { label: "RR", role: "Rear R", azimuth: 135, elevation: 0, distance: 1.2 },
    ],
  },
  fiveOne: {
    count: 6,
    channels: [
      { label: "L", role: "Left", azimuth: -30, elevation: 0, distance: 1.1 },
      { label: "R", role: "Right", azimuth: 30, elevation: 0, distance: 1.1 },
      { label: "C", role: "Center", azimuth: 0, elevation: 0, distance: 1.0 },
      { label: "LFE", role: "Sub", azimuth: 0, elevation: -10, distance: 1.35, lfe: true },
      { label: "Ls", role: "Side L", azimuth: -110, elevation: 0, distance: 1.2 },
      { label: "Rs", role: "Side R", azimuth: 110, elevation: 0, distance: 1.2 },
    ],
  },
  sevenOne: {
    count: 8,
    channels: [
      { label: "L", role: "Left", azimuth: -30, elevation: 0, distance: 1.1 },
      { label: "R", role: "Right", azimuth: 30, elevation: 0, distance: 1.1 },
      { label: "C", role: "Center", azimuth: 0, elevation: 0, distance: 1.0 },
      { label: "LFE", role: "Sub", azimuth: 0, elevation: -10, distance: 1.35, lfe: true },
      { label: "Ls", role: "Side L", azimuth: -90, elevation: 0, distance: 1.2 },
      { label: "Rs", role: "Side R", azimuth: 90, elevation: 0, distance: 1.2 },
      { label: "Lb", role: "Back L", azimuth: -145, elevation: 0, distance: 1.25 },
      { label: "Rb", role: "Back R", azimuth: 145, elevation: 0, distance: 1.25 },
    ],
  },
};

const dom = {
  audio: document.getElementById("streamElement"),
  streamUrl: document.getElementById("streamUrl"),
  playButton: document.getElementById("playButton"),
  stopButton: document.getElementById("stopButton"),
  useCorsProxy: document.getElementById("useCorsProxy"),
  corsProxyState: document.getElementById("corsProxyState"),
  layoutSelect: document.getElementById("layoutSelect"),
  channelCount: document.getElementById("channelCount"),
  spaceMode: document.getElementById("spaceMode"),
  masterGain: document.getElementById("masterGain"),
  masterGainValue: document.getElementById("masterGainValue"),
  channelList: document.getElementById("channelList"),
  resetLayout: document.getElementById("resetLayout"),
  canvas: document.getElementById("stageCanvas"),
  meterBar: document.getElementById("meterBar"),
  connectionStatus: document.getElementById("connectionStatus"),
  contextState: document.getElementById("contextState"),
  streamState: document.getElementById("streamState"),
  messageLine: document.getElementById("messageLine"),
};

const ctx2d = dom.canvas.getContext("2d");
const meterData = new Uint8Array(1024);

const state = {
  audioContext: null,
  sourceNode: null,
  splitter: null,
  masterGain: null,
  analyser: null,
  channelNodes: [],
  channelSettings: [],
  selectedChannel: -1,
  draggedChannel: -1,
  animationId: 0,
  channelMeterValues: [],
};

function cloneChannel(channel, index) {
  return {
    label: channel?.label || `Ch ${index + 1}`,
    role: channel?.role || `Channel ${index + 1}`,
    azimuth: channel?.azimuth ?? distributeAzimuth(index, MAX_CHANNELS),
    elevation: channel?.elevation ?? 0,
    distance: channel?.distance ?? 1.2,
    gain: channel?.gain ?? 1,
    muted: channel?.muted ?? false,
    lfe: channel?.lfe ?? false,
  };
}

function distributeAzimuth(index, count) {
  return Math.round((index / Math.max(1, count)) * 360 - 180);
}

function applyLayout(name) {
  const preset = layouts[name] || layouts.fiveOne;
  const count = name === "custom" ? Number(dom.channelCount.value) : preset.count;
  dom.channelCount.value = String(count);

  state.channelSettings = Array.from({ length: count }, (_, index) =>
    cloneChannel(preset.channels?.[index], index),
  );

  renderChannelControls();
  rebuildAudioGraph();
  drawStage();
}

async function ensureAudioContext() {
  if (state.audioContext) {
    if (state.audioContext.state !== "running") {
      await state.audioContext.resume();
    }
    return state.audioContext;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    throw new Error("Web Audio API is not available in this browser.");
  }

  const audioContext = new AudioContextClass({ latencyHint: "interactive" });
  const masterGain = audioContext.createGain();
  const analyser = audioContext.createAnalyser();

  analyser.fftSize = 2048;
  masterGain.gain.value = Number(dom.masterGain.value);
  masterGain.connect(analyser);
  analyser.connect(audioContext.destination);

  state.audioContext = audioContext;
  state.masterGain = masterGain;
  state.analyser = analyser;

  updateListener();
  audioContext.addEventListener("statechange", updateDiagnostics);
  updateDiagnostics();
  return audioContext;
}

function updateListener() {
  const listener = state.audioContext?.listener;
  if (!listener) return;

  setAudioParam(listener.positionX, 0);
  setAudioParam(listener.positionY, 0);
  setAudioParam(listener.positionZ, 0);
  setAudioParam(listener.forwardX, 0);
  setAudioParam(listener.forwardY, 0);
  setAudioParam(listener.forwardZ, -1);
  setAudioParam(listener.upX, 0);
  setAudioParam(listener.upY, 1);
  setAudioParam(listener.upZ, 0);
}

function setAudioParam(param, value) {
  if (param && typeof param.setValueAtTime === "function") {
    param.setValueAtTime(value, state.audioContext?.currentTime || 0);
  }
}

function rebuildAudioGraph() {
  if (!state.audioContext || !state.sourceNode || !state.masterGain) return;

  for (const nodeSet of state.channelNodes) {
    for (const node of Object.values(nodeSet)) {
      try {
        if (typeof node?.disconnect === "function") node.disconnect();
      } catch {
        // Already disconnected.
      }
    }
  }
  if (state.splitter) {
    try {
      state.splitter.disconnect();
    } catch {
      // Already disconnected.
    }
  }
  try {
    state.sourceNode.disconnect();
  } catch {
    // The source may not have been connected yet.
  }

  const audioContext = state.audioContext;
  state.splitter = audioContext.createChannelSplitter(MAX_CHANNELS);
  state.channelNodes = [];
  state.channelMeterValues = [];

  state.sourceNode.connect(state.splitter);

  state.channelSettings.forEach((settings, index) => {
    const inputGain = audioContext.createGain();
    const channelAnalyser = audioContext.createAnalyser();
    const panner = audioContext.createPanner();
    const lfeFilter = settings.lfe ? audioContext.createBiquadFilter() : null;

    inputGain.gain.value = settings.muted ? 0 : settings.gain;
    channelAnalyser.fftSize = 1024;
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 1;
    panner.maxDistance = 30;
    panner.rolloffFactor = 0.18;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;

    if (lfeFilter) {
      lfeFilter.type = "lowpass";
      lfeFilter.frequency.value = 120;
      lfeFilter.Q.value = 0.707;
    }

    state.splitter.connect(inputGain, index, 0);
    inputGain.connect(channelAnalyser);
    if (lfeFilter) {
      inputGain.connect(lfeFilter);
      lfeFilter.connect(panner);
    } else {
      inputGain.connect(panner);
    }
    panner.connect(state.masterGain);

    state.channelNodes[index] = {
      inputGain,
      channelAnalyser,
      lfeFilter,
      panner,
      meterData: new Uint8Array(channelAnalyser.fftSize),
    };
    state.channelMeterValues[index] = 0;
    updatePanner(index);
  });
}

function updatePanner(index) {
  const settings = state.channelSettings[index];
  const panner = state.channelNodes[index]?.panner;
  if (!settings || !panner) return;

  const coords = sphericalToAudioPosition(settings);
  setAudioParam(panner.positionX, coords.x);
  setAudioParam(panner.positionY, coords.y);
  setAudioParam(panner.positionZ, coords.z);

  if (typeof panner.setPosition === "function") {
    panner.setPosition(coords.x, coords.y, coords.z);
  }
}

function sphericalToAudioPosition({ azimuth, elevation, distance }) {
  const az = (azimuth * Math.PI) / 180;
  const el = (elevation * Math.PI) / 180;
  const radius = Math.max(0.1, distance);

  return {
    x: Math.sin(az) * Math.cos(el) * radius,
    y: Math.sin(el) * radius,
    z: -Math.cos(az) * Math.cos(el) * radius,
  };
}

function updateChannelGain(index) {
  const settings = state.channelSettings[index];
  const inputGain = state.channelNodes[index]?.inputGain;
  if (!settings || !inputGain || !state.audioContext) return;
  inputGain.gain.setTargetAtTime(settings.muted ? 0 : settings.gain, state.audioContext.currentTime, 0.015);
}

function renderChannelControls() {
  dom.channelList.textContent = "";

  state.channelSettings.forEach((settings, index) => {
    const row = document.createElement("div");
    row.className = "channel-row";
    row.dataset.index = String(index);

    const name = document.createElement("div");
    name.className = "channel-name";
    name.textContent = settings.label;
    const role = document.createElement("small");
    role.textContent = settings.role;
    name.append(role);

    const controls = document.createElement("div");
    controls.className = "channel-controls";
    controls.append(
      makeRange(index, "gain", "Gain", 0, 1.5, 0.01),
      makeRange(index, "azimuth", "Az", -180, 180, 1),
      makeRange(index, "elevation", "El", -60, 60, 1),
      makeRange(index, "distance", "Dist", 0.25, 5, 0.05),
    );

    const mute = document.createElement("button");
    mute.type = "button";
    mute.className = `mute-button${settings.muted ? " active" : ""}`;
    mute.textContent = settings.muted ? "M" : "On";
    mute.addEventListener("click", () => {
      settings.muted = !settings.muted;
      mute.classList.toggle("active", settings.muted);
      mute.textContent = settings.muted ? "M" : "On";
      updateChannelGain(index);
    });

    const meter = document.createElement("div");
    meter.className = "channel-meter";
    const meterTrack = document.createElement("div");
    meterTrack.className = "channel-meter-track";
    const meterBar = document.createElement("span");
    meterBar.className = "channel-meter-bar";
    meterBar.dataset.meterIndex = String(index);
    meterTrack.append(meterBar);

    const meterValue = document.createElement("span");
    meterValue.className = "channel-meter-value";
    meterValue.dataset.meterValueIndex = String(index);
    meterValue.textContent = "-inf";
    meter.append(meterTrack, meterValue);

    row.append(name, controls, mute, meter);
    dom.channelList.append(row);
  });

  syncSpaceMode();
}

function makeRange(index, key, label, min, max, step) {
  const field = document.createElement("label");
  field.className = "compact-field";

  const labelEl = document.createElement("span");
  labelEl.textContent = label;

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(state.channelSettings[index][key]);
  input.dataset.index = String(index);
  input.dataset.key = key;

  input.addEventListener("input", () => {
    const channel = state.channelSettings[index];
    channel[key] = Number(input.value);
    if (key === "gain") {
      updateChannelGain(index);
    } else {
      updatePanner(index);
      drawStage();
    }
  });

  field.append(labelEl, input);
  return field;
}

function syncSpaceMode() {
  const is3d = dom.spaceMode.value === "3d";
  dom.channelList.querySelectorAll('input[data-key="elevation"]').forEach((input) => {
    input.disabled = !is3d;
  });
  if (!is3d) {
    state.channelSettings.forEach((settings, index) => {
      if (settings.lfe) return;
      settings.elevation = 0;
      updatePanner(index);
    });
    dom.channelList.querySelectorAll('input[data-key="elevation"]').forEach((input) => {
      const index = Number(input.dataset.index);
      input.value = String(state.channelSettings[index].elevation);
    });
  }
  drawStage();
}

async function playStream() {
  const sourceUrl = dom.streamUrl.value.trim();
  if (!sourceUrl) {
    setStatus("error", "No URL");
    setMessage("Icecast URL is required.");
    return;
  }
  const url = buildStreamUrl(sourceUrl);

  try {
    setStatus("idle", "Loading");
    setMessage(dom.useCorsProxy.checked ? "Opening stream through CORS proxy." : "Opening stream directly.");
    const audioContext = await ensureAudioContext();

    if (!state.sourceNode) {
      state.sourceNode = audioContext.createMediaElementSource(dom.audio);
    }

    if (dom.audio.src !== url) {
      dom.audio.src = url;
      dom.audio.load();
    }

    rebuildAudioGraph();
    await dom.audio.play();
    setStatus("live", "Live");
    setMessage("Receiving.");
    startAnimation();
    updateDiagnostics();
  } catch (error) {
    setStatus("error", "Error");
    setMessage(`${error.message} Check proxy reachability, HTTPS, codec support, and Icecast URL.`);
    updateDiagnostics();
  }
}

function buildStreamUrl(sourceUrl) {
  if (!dom.useCorsProxy.checked || sourceUrl.startsWith(CORS_PROXY_BASE)) {
    return sourceUrl;
  }
  return `${CORS_PROXY_BASE}${sourceUrl}`;
}

function stopStream() {
  dom.audio.pause();
  dom.audio.removeAttribute("src");
  dom.audio.load();
  setStatus("idle", "Stopped");
  setMessage("Stopped.");
  updateDiagnostics();
}

function setStatus(type, text) {
  dom.connectionStatus.className = `status-pill${type === "live" ? " live" : ""}${type === "error" ? " error" : ""}`;
  dom.connectionStatus.textContent = text;
}

function setMessage(text) {
  dom.messageLine.textContent = text;
}

function updateDiagnostics() {
  dom.contextState.textContent = state.audioContext?.state || "suspended";
  dom.streamState.textContent = dom.audio.currentSrc ? dom.audio.readyStateLabel || readyStateText(dom.audio.readyState) : "none";
}

function readyStateText(value) {
  return ["empty", "metadata", "current data", "future data", "enough data"][value] || "unknown";
}

function startAnimation() {
  if (state.animationId) return;
  const tick = () => {
    updateMeter();
    updateChannelMeters();
    drawStage();
    state.animationId = requestAnimationFrame(tick);
  };
  state.animationId = requestAnimationFrame(tick);
}

function updateMeter() {
  if (!state.analyser) {
    dom.meterBar.style.width = "0%";
    return;
  }

  state.analyser.getByteTimeDomainData(meterData);
  let sum = 0;
  for (const value of meterData) {
    const normalized = (value - 128) / 128;
    sum += normalized * normalized;
  }
  const rms = Math.sqrt(sum / meterData.length);
  const pct = Math.min(100, Math.round(rms * 280));
  dom.meterBar.style.width = `${pct}%`;
}

function updateChannelMeters() {
  state.channelNodes.forEach((nodeSet, index) => {
    const analyser = nodeSet?.channelAnalyser;
    const data = nodeSet?.meterData;
    if (!analyser || !data) return;

    analyser.getByteTimeDomainData(data);
    let peak = 0;
    for (const value of data) {
      peak = Math.max(peak, Math.abs((value - 128) / 128));
    }

    const previous = state.channelMeterValues[index] || 0;
    const smoothed = peak > previous ? peak : previous * 0.82;
    state.channelMeterValues[index] = smoothed;

    const db = smoothed > 0.0001 ? 20 * Math.log10(smoothed) : -Infinity;
    const percent = Math.min(100, Math.max(0, ((db + 48) / 48) * 100));
    const bar = dom.channelList.querySelector(`[data-meter-index="${index}"]`);
    const value = dom.channelList.querySelector(`[data-meter-value-index="${index}"]`);

    if (bar) bar.style.width = `${percent.toFixed(1)}%`;
    if (value) value.textContent = Number.isFinite(db) ? `${Math.round(db)} dB` : "-inf";
  });
}

function drawStage() {
  const { width, height } = dom.canvas;
  const cx = width / 2;
  const cy = height / 2 + 36;
  const maxRadius = Math.min(width, height) * 0.39;

  ctx2d.clearRect(0, 0, width, height);
  ctx2d.fillStyle = "#202624";
  ctx2d.fillRect(0, 0, width, height);

  ctx2d.strokeStyle = "rgba(255,255,255,0.14)";
  ctx2d.lineWidth = 2;
  for (let i = 1; i <= 4; i += 1) {
    ctx2d.beginPath();
    ctx2d.arc(cx, cy, (maxRadius * i) / 4, 0, Math.PI * 2);
    ctx2d.stroke();
  }

  ctx2d.strokeStyle = "rgba(255,255,255,0.22)";
  ctx2d.beginPath();
  ctx2d.moveTo(cx, cy - maxRadius - 16);
  ctx2d.lineTo(cx, cy + maxRadius + 16);
  ctx2d.moveTo(cx - maxRadius - 16, cy);
  ctx2d.lineTo(cx + maxRadius + 16, cy);
  ctx2d.stroke();

  ctx2d.fillStyle = "#f5f6f2";
  ctx2d.beginPath();
  ctx2d.arc(cx, cy, 15, 0, Math.PI * 2);
  ctx2d.fill();
  ctx2d.fillStyle = "rgba(245,246,242,0.72)";
  ctx2d.font = "700 14px system-ui, sans-serif";
  ctx2d.textAlign = "center";
  ctx2d.fillText("Listener", cx, cy + 38);

  state.channelSettings.forEach((settings, index) => {
    const point = speakerToCanvas(settings, cx, cy, maxRadius);
    const selected = index === state.selectedChannel || index === state.draggedChannel;
    const radius = selected ? 18 : 15;

    ctx2d.fillStyle = settings.lfe ? "#d18b2e" : "#47b092";
    ctx2d.strokeStyle = selected ? "#ffffff" : "rgba(255,255,255,0.28)";
    ctx2d.lineWidth = selected ? 3 : 2;
    ctx2d.beginPath();
    ctx2d.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx2d.fill();
    ctx2d.stroke();

    if (dom.spaceMode.value === "3d") {
      ctx2d.fillStyle = settings.elevation >= 0 ? "rgba(255,255,255,0.9)" : "rgba(32,38,36,0.85)";
      ctx2d.font = "800 11px system-ui, sans-serif";
      ctx2d.fillText(settings.elevation >= 0 ? "+" : "-", point.x, point.y + 4);
    }

    ctx2d.fillStyle = "#f5f6f2";
    ctx2d.font = "800 13px system-ui, sans-serif";
    ctx2d.fillText(settings.label, point.x, point.y - 24);
  });
}

function speakerToCanvas(settings, cx, cy, maxRadius) {
  const az = (settings.azimuth * Math.PI) / 180;
  const normalizedDistance = Math.min(1, Math.max(0.08, settings.distance / 5));
  const radius = maxRadius * normalizedDistance;
  return {
    x: cx + Math.sin(az) * radius,
    y: cy - Math.cos(az) * radius,
  };
}

function canvasToSpeaker(clientX, clientY) {
  const rect = dom.canvas.getBoundingClientRect();
  const scaleX = dom.canvas.width / rect.width;
  const scaleY = dom.canvas.height / rect.height;
  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;
  const cx = dom.canvas.width / 2;
  const cy = dom.canvas.height / 2 + 36;
  const maxRadius = Math.min(dom.canvas.width, dom.canvas.height) * 0.39;
  const dx = x - cx;
  const dy = y - cy;
  const angle = Math.atan2(dx, -dy);
  const distance = Math.min(5, Math.max(0.25, (Math.hypot(dx, dy) / maxRadius) * 5));

  return {
    azimuth: Math.round((angle * 180) / Math.PI),
    distance: Number(distance.toFixed(2)),
  };
}

function findNearestChannel(clientX, clientY) {
  const rect = dom.canvas.getBoundingClientRect();
  const scaleX = dom.canvas.width / rect.width;
  const scaleY = dom.canvas.height / rect.height;
  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;
  const cx = dom.canvas.width / 2;
  const cy = dom.canvas.height / 2 + 36;
  const maxRadius = Math.min(dom.canvas.width, dom.canvas.height) * 0.39;

  let nearest = -1;
  let nearestDistance = Infinity;
  state.channelSettings.forEach((settings, index) => {
    const point = speakerToCanvas(settings, cx, cy, maxRadius);
    const distance = Math.hypot(point.x - x, point.y - y);
    if (distance < nearestDistance) {
      nearest = index;
      nearestDistance = distance;
    }
  });

  return nearestDistance <= 38 ? nearest : -1;
}

function updateChannelInputs(index) {
  for (const key of ["azimuth", "distance", "elevation", "gain"]) {
    const input = dom.channelList.querySelector(`input[data-index="${index}"][data-key="${key}"]`);
    if (input) input.value = String(state.channelSettings[index][key]);
  }
}

dom.playButton.addEventListener("click", playStream);
dom.stopButton.addEventListener("click", stopStream);

dom.layoutSelect.addEventListener("change", () => {
  applyLayout(dom.layoutSelect.value);
});

dom.channelCount.addEventListener("change", () => {
  dom.layoutSelect.value = "custom";
  const count = Number(dom.channelCount.value);
  state.channelSettings = Array.from({ length: count }, (_, index) =>
    cloneChannel(state.channelSettings[index], index),
  );
  renderChannelControls();
  rebuildAudioGraph();
  drawStage();
});

dom.spaceMode.addEventListener("change", syncSpaceMode);

dom.useCorsProxy.addEventListener("change", () => {
  dom.corsProxyState.textContent = dom.useCorsProxy.checked ? "On" : "Off";
});

dom.masterGain.addEventListener("input", () => {
  const value = Number(dom.masterGain.value);
  dom.masterGainValue.textContent = value.toFixed(2);
  if (state.masterGain && state.audioContext) {
    state.masterGain.gain.setTargetAtTime(value, state.audioContext.currentTime, 0.02);
  }
});

dom.resetLayout.addEventListener("click", () => {
  applyLayout(dom.layoutSelect.value);
});

dom.audio.addEventListener("playing", () => {
  setStatus("live", "Live");
  updateDiagnostics();
});
dom.audio.addEventListener("waiting", () => {
  setStatus("idle", "Buffering");
  updateDiagnostics();
});
dom.audio.addEventListener("error", () => {
  setStatus("error", "Error");
  const mediaError = dom.audio.error;
  setMessage(mediaError ? `Media error ${mediaError.code}. Check stream URL and codec.` : "Media error.");
  updateDiagnostics();
});
dom.audio.addEventListener("loadedmetadata", updateDiagnostics);

dom.canvas.addEventListener("pointerdown", (event) => {
  const index = findNearestChannel(event.clientX, event.clientY);
  state.selectedChannel = index;
  state.draggedChannel = index;
  if (index >= 0) {
    dom.canvas.setPointerCapture(event.pointerId);
  }
  drawStage();
});

dom.canvas.addEventListener("pointermove", (event) => {
  if (state.draggedChannel < 0) return;
  const next = canvasToSpeaker(event.clientX, event.clientY);
  const settings = state.channelSettings[state.draggedChannel];
  settings.azimuth = next.azimuth;
  settings.distance = next.distance;
  updatePanner(state.draggedChannel);
  updateChannelInputs(state.draggedChannel);
  drawStage();
});

dom.canvas.addEventListener("pointerup", (event) => {
  if (state.draggedChannel >= 0) {
    dom.canvas.releasePointerCapture(event.pointerId);
  }
  state.draggedChannel = -1;
  drawStage();
});

dom.canvas.addEventListener("pointerleave", () => {
  state.draggedChannel = -1;
  drawStage();
});

applyLayout("fiveOne");
updateDiagnostics();
drawStage();
