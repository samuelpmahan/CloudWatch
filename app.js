const $ = (id) => document.getElementById(id);
const video = $('camera');
const canvas = $('overlay');
const ctx = canvas.getContext('2d');
const promptEl = $('prompt');
const statusEl = $('status');
const resultsEl = $('results');
const fov = $('fov');
const unc = $('unc');
const fovValue = $('fovValue');
const uncValue = $('uncValue');

const tapNames = ['base', 'top', 'left', 'right'];
let taps = [];
let pitchDeg = 0;
let weather = null;
let cameraStarted = false;

function resizeCanvas() {
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * devicePixelRatio);
  canvas.height = Math.round(r.height * devicePixelRatio);
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  draw();
}

function draw() {
  const r = canvas.getBoundingClientRect();
  ctx.clearRect(0, 0, r.width, r.height);
  taps.forEach((p, i) => {
    ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#f8fafc'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#0f172a'; ctx.stroke();
    ctx.font = '700 13px system-ui'; ctx.fillStyle = '#f8fafc';
    ctx.fillText(tapNames[i], p.x + 12, p.y - 10);
  });
  if (taps.length === 4) {
    const [, , l, rgt] = taps;
    ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(rgt.x, rgt.y);
    ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 2; ctx.stroke();
  }
}

function screenYToElevation(y) {
  const h = canvas.getBoundingClientRect().height;
  const vfov = Number(fov.value);
  return pitchDeg + ((h / 2 - y) / h) * vfov;
}

function estimate() {
  if (!weather || taps.length < 4) return;
  const [base, top, left, right] = taps;
  const baseAngle = screenYToElevation(base.y);
  const topAngle = screenYToElevation(top.y);
  if (baseAngle <= 1) {
    statusEl.textContent = `Cloud base is only ${baseAngle.toFixed(1)}° above the horizon; aim higher or check orientation.`;
    return;
  }

  const baseM = weather.cloudBaseAglM;
  const rangeM = baseM / Math.tan(baseAngle * Math.PI / 180);
  const rect = canvas.getBoundingClientRect();
  const hfov = Number(fov.value) * (rect.width / rect.height);
  const angularWidth = Math.abs(right.x - left.x) / rect.width * hfov;
  const widthM = 2 * rangeM * Math.tan((angularWidth / 2) * Math.PI / 180);
  const topM = rangeM * Math.tan(topAngle * Math.PI / 180);
  const heightM = Math.max(0, topM - baseM);

  const baseUnc = Number(unc.value);
  const relative = Math.min(0.9, baseUnc / Math.max(baseM, 1) + 0.10);
  const fmtMi = (m) => `${(m / 1609.344).toFixed(2)} mi`;
  const fmtFt = (m) => `${Math.round(m * 3.28084).toLocaleString()} ft`;
  const plusMinus = (m) => `± ${fmtMi(m * relative)}`;

  const strong = resultsEl.querySelectorAll('strong');
  strong[0].textContent = `${fmtFt(baseM)} ± ${fmtFt(baseUnc)}`;
  strong[1].textContent = `${fmtMi(rangeM)} ${plusMinus(rangeM)}`;
  strong[2].textContent = `${fmtMi(widthM)} ${plusMinus(widthM)}`;
  strong[3].textContent = `${fmtFt(heightM)} ± ${fmtFt(Math.max(baseUnc, heightM * relative))}`;
  statusEl.textContent = `Base angle ${baseAngle.toFixed(1)}° · pitch ${pitchDeg.toFixed(1)}° · ${weather.tempC.toFixed(1)}°C / dew point ${weather.dewC.toFixed(1)}°C`;
}

async function getLocationAndWeather() {
  statusEl.textContent = 'Getting location + weather…';
  const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 }));
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
  // LCL rule of thumb: ~125 m per °C temperature/dew-point spread.
  const cloudBaseAglM = Math.max(150, 125 * Math.max(0, tempC - dewC));
  weather = { tempC, dewC, cloudBaseAglM };
  statusEl.textContent = `Estimated cloud base ${Math.round(cloudBaseAglM)} m AGL from current T/Td.`;
  estimate();
}

async function requestOrientation() {
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    const permission = await DeviceOrientationEvent.requestPermission();
    if (permission !== 'granted') throw new Error('Orientation permission denied');
  }
  window.addEventListener('deviceorientation', (e) => {
    if (typeof e.beta === 'number') pitchDeg = Math.max(-89, Math.min(89, e.beta - 90));
    estimate();
  }, true);
}

async function start() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    video.srcObject = stream;
    await video.play();
    cameraStarted = true;
    await Promise.allSettled([requestOrientation(), getLocationAndWeather()]);
    resizeCanvas();
    promptEl.textContent = 'Tap cloud base';
  } catch (err) {
    statusEl.textContent = err?.message || String(err);
  }
}

canvas.addEventListener('pointerdown', (e) => {
  if (!cameraStarted) return;
  const r = canvas.getBoundingClientRect();
  if (taps.length === 4) taps = [];
  taps.push({ x: e.clientX - r.left, y: e.clientY - r.top });
  draw();
  promptEl.textContent = taps.length < 4 ? `Tap cloud ${tapNames[taps.length]}` : 'Estimate ready · tap again to restart';
  estimate();
});

$('start').addEventListener('click', start);
$('reset').addEventListener('click', () => { taps = []; draw(); promptEl.textContent = cameraStarted ? 'Tap cloud base' : 'Start camera, then tap cloud base'; });
fov.addEventListener('input', () => { fovValue.textContent = `${fov.value}°`; estimate(); });
unc.addEventListener('input', () => { uncValue.textContent = `± ${unc.value} m`; estimate(); });
window.addEventListener('resize', resizeCanvas);
resizeCanvas();
