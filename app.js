const $ = (id) => document.getElementById(id);
const video = $('camera');
const scene = $('scene');
const sceneCtx = scene.getContext('2d');
const overlay = $('overlay');
const overlayCtx = overlay.getContext('2d');
const receipt = $('receipt');
const receiptCtx = receipt.getContext('2d');
const viewer = $('viewer');
const promptEl = $('prompt');
const statusEl = $('status');
const hintEl = $('hint');
const resultsEl = $('results');
const receiptSection = $('receiptSection');
const startBtn = $('start');
const freezeBtn = $('freeze');
const markBtn = $('mark');
const undoBtn = $('undo');
const resetBtn = $('reset');
const fov = $('fov');
const unc = $('unc');
const fovValue = $('fovValue');
const uncValue = $('uncValue');

const markNames = ['horizon', 'base', 'top', 'left', 'right'];
let marks = [];
let weather = null;
let cameraStarted = false;
let frozen = false;
let frozenImage = null;
let pan = { x: 0, y: 0 };
let drag = null;

function viewerSize() {
  const r = viewer.getBoundingClientRect();
  return { width: r.width, height: r.height };
}

function fitCanvas(canvas, ctx) {
  const { width, height } = viewerSize();
  canvas.width = Math.round(width * devicePixelRatio);
  canvas.height = Math.round(height * devicePixelRatio);
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}

function resizeCanvases() {
  fitCanvas(scene, sceneCtx);
  fitCanvas(overlay, overlayCtx);
  if (frozenImage) drawFrozenScene();
  drawOverlay();
}

function drawVideoCover(ctx, source, width, height) {
  const sw = source.videoWidth || source.width;
  const sh = source.videoHeight || source.height;
  if (!sw || !sh) return;
  const scale = Math.max(width / sw, height / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const dx = (width - dw) / 2;
  const dy = (height - dh) / 2;
  ctx.drawImage(source, dx, dy, dw, dh);
}

function captureFrozenImage() {
  const { width, height } = viewerSize();
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.round(width * devicePixelRatio));
  off.height = Math.max(1, Math.round(height * devicePixelRatio));
  const ctx = off.getContext('2d');
  ctx.scale(devicePixelRatio, devicePixelRatio);
  drawVideoCover(ctx, video, width, height);
  return off;
}

function clampPan() {
  const { width, height } = viewerSize();
  const maxX = width * 0.42;
  const maxY = height * 0.42;
  pan.x = Math.max(-maxX, Math.min(maxX, pan.x));
  pan.y = Math.max(-maxY, Math.min(maxY, pan.y));
}

function drawFrozenScene() {
  if (!frozenImage) return;
  const { width, height } = viewerSize();
  sceneCtx.clearRect(0, 0, width, height);
  sceneCtx.drawImage(frozenImage, pan.x, pan.y, width, height);
}

function reticlePointInImage() {
  const { width, height } = viewerSize();
  return {
    x: width / 2 - pan.x,
    y: height / 2 - pan.y
  };
}

function drawOverlay() {
  const { width, height } = viewerSize();
  overlayCtx.clearRect(0, 0, width, height);
  if (!frozen) return;

  overlayCtx.save();
  overlayCtx.translate(pan.x, pan.y);

  if (marks[0]) {
    overlayCtx.setLineDash([8, 7]);
    overlayCtx.strokeStyle = 'rgba(248,250,252,.8)';
    overlayCtx.lineWidth = 2;
    overlayCtx.beginPath();
    overlayCtx.moveTo(0, marks[0].y);
    overlayCtx.lineTo(width, marks[0].y);
    overlayCtx.stroke();
    overlayCtx.setLineDash([]);
  }

  marks.forEach((p, i) => {
    overlayCtx.beginPath();
    overlayCtx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    overlayCtx.fillStyle = '#f8fafc';
    overlayCtx.fill();
    overlayCtx.lineWidth = 3;
    overlayCtx.strokeStyle = '#0f172a';
    overlayCtx.stroke();
    overlayCtx.font = '700 13px system-ui';
    overlayCtx.fillStyle = '#f8fafc';
    overlayCtx.fillText(markNames[i], p.x + 12, p.y - 10);
  });

  if (marks.length === 5) {
    const [, , , left, right] = marks;
    overlayCtx.beginPath();
    overlayCtx.moveTo(left.x, left.y);
    overlayCtx.lineTo(right.x, right.y);
    overlayCtx.strokeStyle = '#f8fafc';
    overlayCtx.lineWidth = 2;
    overlayCtx.stroke();
  }

  overlayCtx.restore();
}

function rayVerticalAngle(y) {
  const { height } = viewerSize();
  const vfovRad = Number(fov.value) * Math.PI / 180;
  const normalized = 1 - 2 * (y / height);
  return Math.atan(normalized * Math.tan(vfovRad / 2));
}

function elevationFromHorizon(y, horizonY) {
  return rayVerticalAngle(y) - rayVerticalAngle(horizonY);
}

function rayHorizontalAngle(x) {
  const { width, height } = viewerSize();
  const vfovRad = Number(fov.value) * Math.PI / 180;
  const hfovRad = 2 * Math.atan(Math.tan(vfovRad / 2) * (width / height));
  const normalized = 2 * (x / width) - 1;
  return Math.atan(normalized * Math.tan(hfovRad / 2));
}

function renderReceipt() {
  if (!frozenImage || marks.length < 5) return;
  const { width, height } = viewerSize();
  const scale = Math.min(2, devicePixelRatio);
  receipt.width = Math.round(width * scale);
  receipt.height = Math.round(height * scale);
  receiptCtx.setTransform(scale, 0, 0, scale, 0, 0);
  receiptCtx.clearRect(0, 0, width, height);
  receiptCtx.drawImage(frozenImage, 0, 0, width, height);

  const [horizon, , , left, right] = marks;
  receiptCtx.save();
  receiptCtx.setLineDash([8, 7]);
  receiptCtx.strokeStyle = 'rgba(255,255,255,.9)';
  receiptCtx.lineWidth = 2;
  receiptCtx.beginPath();
  receiptCtx.moveTo(0, horizon.y);
  receiptCtx.lineTo(width, horizon.y);
  receiptCtx.stroke();
  receiptCtx.setLineDash([]);

  marks.forEach((p, i) => {
    receiptCtx.beginPath();
    receiptCtx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    receiptCtx.fillStyle = '#fff';
    receiptCtx.fill();
    receiptCtx.lineWidth = 3;
    receiptCtx.strokeStyle = '#020617';
    receiptCtx.stroke();
    receiptCtx.font = '700 14px system-ui';
    receiptCtx.fillStyle = '#fff';
    receiptCtx.strokeStyle = 'rgba(2,6,23,.9)';
    receiptCtx.lineWidth = 4;
    receiptCtx.strokeText(markNames[i], p.x + 12, p.y - 10);
    receiptCtx.fillText(markNames[i], p.x + 12, p.y - 10);
  });

  receiptCtx.beginPath();
  receiptCtx.moveTo(left.x, left.y);
  receiptCtx.lineTo(right.x, right.y);
  receiptCtx.strokeStyle = '#fff';
  receiptCtx.lineWidth = 2;
  receiptCtx.stroke();
  receiptCtx.restore();
  receiptSection.hidden = false;
}

function estimate() {
  if (!weather || marks.length < 5) return;
  const [horizon, base, top, left, right] = marks;
  const baseAngleRad = elevationFromHorizon(base.y, horizon.y);
  const topAngleRad = elevationFromHorizon(top.y, horizon.y);
  const baseAngleDeg = baseAngleRad * 180 / Math.PI;

  if (baseAngleDeg <= 1) {
    statusEl.textContent = `Cloud base is only ${baseAngleDeg.toFixed(1)}° above the horizon mark. Check the receipt.`;
    return;
  }

  const baseM = weather.cloudBaseAglM;
  const rangeM = baseM / Math.tan(baseAngleRad);
  const leftAngle = rayHorizontalAngle(left.x);
  const rightAngle = rayHorizontalAngle(right.x);
  const widthM = rangeM * Math.abs(Math.tan(rightAngle) - Math.tan(leftAngle));
  const topM = rangeM * Math.tan(topAngleRad);
  const heightM = Math.max(0, topM - baseM);

  const baseUnc = Number(unc.value);
  const relative = Math.min(0.9, baseUnc / Math.max(baseM, 1) + 0.12);
  const fmtMi = (m) => `${(m / 1609.344).toFixed(2)} mi`;
  const fmtFt = (m) => `${Math.round(m * 3.28084).toLocaleString()} ft`;
  const plusMinus = (m) => `± ${fmtMi(m * relative)}`;

  const strong = resultsEl.querySelectorAll('strong');
  strong[0].textContent = `${fmtFt(baseM)} ± ${fmtFt(baseUnc)}`;
  strong[1].textContent = `${fmtMi(rangeM)} ${plusMinus(rangeM)}`;
  strong[2].textContent = `${fmtMi(widthM)} ${plusMinus(widthM)}`;
  strong[3].textContent = `${fmtFt(heightM)} ± ${fmtFt(Math.max(baseUnc, heightM * relative))}`;
  statusEl.textContent = `Base elevation ${baseAngleDeg.toFixed(1)}° · ${weather.tempC.toFixed(1)}°C / dew point ${weather.dewC.toFixed(1)}°C`;
  renderReceipt();
}

function updateControls() {
  const next = markNames[marks.length];
  markBtn.disabled = !frozen || marks.length >= markNames.length;
  markBtn.textContent = next ? `Mark ${next}` : 'Measurement complete';
  undoBtn.disabled = marks.length === 0;
  promptEl.textContent = frozen
    ? (next ? `Aim crosshair at ${next}` : 'Measurement complete')
    : (cameraStarted ? 'Frame cloud + horizon, then freeze' : 'Start camera');
}

async function getLocationAndWeather() {
  statusEl.textContent = 'Getting location + weather…';
  const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
    resolve,
    reject,
    { enableHighAccuracy: true, timeout: 10000 }
  ));
  const { latitude, longitude } = pos.coords;
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', latitude);
  url.searchParams.set('longitude', longitude);
  url.searchParams.set('current', 'temperature_2m,dew_point_2m');
  url.searchParams.set('temperature_unit', 'celsius');
  const res = await fetch(url);
  if (!res.ok) throw new Error('Weather lookup failed');
  const data = await res.json();
  const tempC = data.current.temperature_2m;
  const dewC = data.current.dew_point_2m;
  const cloudBaseAglM = Math.max(150, 125 * Math.max(0, tempC - dewC));
  weather = { tempC, dewC, cloudBaseAglM };
  statusEl.textContent = `Estimated cloud base ${Math.round(cloudBaseAglM)} m AGL from current T/Td.`;
}

async function start() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    cameraStarted = true;
    freezeBtn.disabled = false;
    startBtn.textContent = 'Camera ready';
    updateControls();
    try {
      await getLocationAndWeather();
    } catch (err) {
      statusEl.textContent = `Camera ready · weather unavailable: ${err?.message || String(err)}`;
    }
  } catch (err) {
    statusEl.textContent = err?.message || String(err);
  }
}

function freezeScene() {
  if (!cameraStarted) return;
  frozenImage = captureFrozenImage();
  frozen = true;
  pan = { x: 0, y: 0 };
  video.style.visibility = 'hidden';
  scene.style.visibility = 'visible';
  drawFrozenScene();
  drawOverlay();
  freezeBtn.disabled = true;
  hintEl.textContent = 'Drag the frozen photo beneath the fixed crosshair. Press the mark button when the target is centered.';
  updateControls();
}

function resetMeasurement() {
  marks = [];
  frozen = false;
  frozenImage = null;
  pan = { x: 0, y: 0 };
  receiptSection.hidden = true;
  sceneCtx.clearRect(0, 0, scene.width, scene.height);
  overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
  video.style.visibility = cameraStarted ? 'visible' : 'hidden';
  scene.style.visibility = 'hidden';
  freezeBtn.disabled = !cameraStarted;
  hintEl.textContent = 'Get the cloud and a visible horizon in frame. Freeze once, then drag the photo under the crosshair and mark each target.';
  resultsEl.querySelectorAll('strong').forEach((el) => el.textContent = '—');
  updateControls();
}

startBtn.addEventListener('click', start);
freezeBtn.addEventListener('click', freezeScene);
markBtn.addEventListener('click', () => {
  if (!frozen || marks.length >= markNames.length) return;
  marks.push(reticlePointInImage());
  drawOverlay();
  updateControls();
  if (marks.length === markNames.length) estimate();
});
undoBtn.addEventListener('click', () => {
  marks.pop();
  receiptSection.hidden = true;
  drawOverlay();
  updateControls();
});
resetBtn.addEventListener('click', resetMeasurement);

viewer.addEventListener('pointerdown', (e) => {
  if (!frozen) return;
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  viewer.setPointerCapture(e.pointerId);
});
viewer.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return;
  pan.x = drag.panX + (e.clientX - drag.x);
  pan.y = drag.panY + (e.clientY - drag.y);
  clampPan();
  drawFrozenScene();
  drawOverlay();
});
viewer.addEventListener('pointerup', (e) => {
  if (drag?.id === e.pointerId) drag = null;
});
viewer.addEventListener('pointercancel', () => { drag = null; });

fov.addEventListener('input', () => {
  fovValue.textContent = `${fov.value}°`;
  estimate();
});
unc.addEventListener('input', () => {
  uncValue.textContent = `± ${unc.value} m`;
  estimate();
});
window.addEventListener('resize', resizeCanvases);
resizeCanvases();
updateControls();
