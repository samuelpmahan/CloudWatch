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

// A visible horizon is a much better reference than browser device-orientation:
// it directly gives 0° elevation in the exact camera frame being measured.
const tapNames = ['horizon', 'base', 'top', 'left', 'right'];
let taps = [];
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

  if (taps[0]) {
    ctx.save();
    ctx.setLineDash([8, 7]);
    ctx.strokeStyle = 'rgba(248,250,252,.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, taps[0].y);
    ctx.lineTo(r.width, taps[0].y);
    ctx.stroke();
    ctx.restore();
  }

  taps.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#0f172a';
    ctx.stroke();
    ctx.font = '700 13px system-ui';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(tapNames[i], p.x + 12, p.y - 10);
  });

  if (taps.length === 5) {
    const [, , , left, right] = taps;
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function rayVerticalAngle(y) {
  const h = canvas.getBoundingClientRect().height;
  const vfovRad = Number(fov.value) * Math.PI / 180;
  const normalized = 1 - 2 * (y / h); // +1 top, -1 bottom
  return Math.atan(normalized * Math.tan(vfovRad / 2));
}

function elevationFromHorizon(y, horizonY) {
  return rayVerticalAngle(y) - rayVerticalAngle(horizonY);
}

function rayHorizontalAngle(x) {
  const rect = canvas.getBoundingClientRect();
  const vfovRad = Number(fov.value) * Math.PI / 180;
  const hfovRad = 2 * Math.atan(Math.tan(vfovRad / 2) * (rect.width / rect.height));
  const normalized = 2 * (x / rect.width) - 1;
  return Math.atan(normalized * Math.tan(hfovRad / 2));
}

function estimate() {
  if (!weather || taps.length < 5) return;
  const [horizon, base, top, left, right] = taps;
  const baseAngleRad = elevationFromHorizon(base.y, horizon.y);
  const topAngleRad = elevationFromHorizon(top.y, horizon.y);
  const baseAngleDeg = baseAngleRad * 180 / Math.PI;

  if (baseAngleDeg <= 1) {
    statusEl.textContent = `Cloud base is only ${baseAngleDeg.toFixed(1)}° above your horizon mark. Check the horizon/base taps.`;
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
  // This still understates FOV/tap uncertainty; keep a floor so the PoC doesn't
  // pretend the meteorological estimate is the only error source.
  const relative = Math.min(0.9, baseUnc / Math.max(baseM, 1) + 0.12);
  const fmtMi = (m) => `${(m / 1609.344).toFixed(2)} mi`;
  const fmtFt = (m) => `${Math.round(m * 3.28084).toLocaleString()} ft`;
  const plusMinus = (m) => `± ${fmtMi(m * relative)}`;

  const strong = resultsEl.querySelectorAll('strong');
  strong[0].textContent = `${fmtFt(baseM)} ± ${fmtFt(baseUnc)}`;
  strong[1].textContent = `${fmtMi(rangeM)} ${plusMinus(rangeM)}`;
  strong[2].textContent = `${fmtMi(widthM)} ${plusMinus(widthM)}`;
  strong[3].textContent = `${fmtFt(heightM)} ± ${fmtFt(Math.max(baseUnc, heightM * relative))}`;
  statusEl.textContent = `Base elevation ${baseAngleDeg.toFixed(1)}° · horizon calibrated · ${weather.tempC.toFixed(1)}°C / dew point ${weather.dewC.toFixed(1)}°C`;
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
  // LCL rule of thumb: ~125 m per °C temperature/dew-point spread.
  const cloudBaseAglM = Math.max(150, 125 * Math.max(0, tempC - dewC));
  weather = { tempC, dewC, cloudBaseAglM };
  statusEl.textContent = `Estimated cloud base ${Math.round(cloudBaseAglM)} m AGL. Tap the visible horizon first.`;
  estimate();
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
    resizeCanvas();
    promptEl.textContent = 'Tap the horizon';

    try {
      await getLocationAndWeather();
    } catch (err) {
      statusEl.textContent = `Camera ready · weather unavailable: ${err?.message || String(err)}`;
    }
  } catch (err) {
    statusEl.textContent = err?.message || String(err);
  }
}

canvas.addEventListener('pointerdown', (e) => {
  if (!cameraStarted) return;
  const r = canvas.getBoundingClientRect();
  if (taps.length === 5) taps = [];
  taps.push({ x: e.clientX - r.left, y: e.clientY - r.top });
  draw();
  promptEl.textContent = taps.length < 5
    ? `Tap cloud ${tapNames[taps.length]}`.replace('cloud horizon', 'the horizon')
    : 'Estimate ready · tap again to restart';
  estimate();
});

$('start').addEventListener('click', start);
$('reset').addEventListener('click', () => {
  taps = [];
  draw();
  promptEl.textContent = cameraStarted ? 'Tap the horizon' : 'Start camera, then tap the horizon';
});
fov.addEventListener('input', () => {
  fovValue.textContent = `${fov.value}°`;
  estimate();
});
unc.addEventListener('input', () => {
  uncValue.textContent = `± ${unc.value} m`;
  estimate();
});
window.addEventListener('resize', resizeCanvas);
resizeCanvas();
