import { evaluateFrame, TouchTracker, P } from './rules.js';
import { setupInstallButton } from './install.js';

const $ = (id) => document.getElementById(id);
const els = {
  video: $('video'), ipImg: $('ipImg'), overlay: $('overlay'), placeholder: $('placeholder'), banner: $('banner'),
  statusDot: $('statusDot'), statusText: $('statusText'), fps: $('fps'),
  sourceType: $('sourceType'), deviceField: $('deviceField'), deviceSelect: $('deviceSelect'),
  urlField: $('urlField'), cameraUrl: $('cameraUrl'), startBtn: $('startBtn'), stopBtn: $('stopBtn'),
  sensitivity: $('sensitivity'), sensVal: $('sensVal'), holdMs: $('holdMs'), holdVal: $('holdVal'),
  cooldownS: $('cooldownS'), coolVal: $('coolVal'), model: $('model'), includeFace: $('includeFace'), useHands: $('useHands'),
  sendPhoto: $('sendPhoto'), beep: $('beep'), drawSkeleton: $('drawSkeleton'), mirror: $('mirror'), viewer: $('viewer'),
  tgStatus: $('tgStatus'), testBtn: $('testBtn'), findChatBtn: $('findChatBtn'), chatList: $('chatList'), log: $('log'),
};

// ---------------------------------------------------------------------------
// Configuración guardada en el equipo

const DEFAULTS = {
  sourceType: 'device', deviceId: '', cameraUrl: '', sensitivity: 1, holdMs: 600, cooldownS: 30,
  model: 'full', includeFace: false, useHands: true, sendPhoto: true, beep: true, drawSkeleton: true, mirror: false,
};
const settings = { ...DEFAULTS, ...readSettings() };

function readSettings() {
  try { return JSON.parse(localStorage.getItem('detecmov.settings') || '{}'); } catch { return {}; }
}
function saveSettings() {
  try { localStorage.setItem('detecmov.settings', JSON.stringify(settings)); } catch { /* sin almacenamiento */ }
}

function bindSettings() {
  els.sourceType.value = settings.sourceType;
  els.cameraUrl.value = settings.cameraUrl;
  els.sensitivity.value = settings.sensitivity;
  els.holdMs.value = settings.holdMs;
  els.cooldownS.value = settings.cooldownS;
  els.model.value = settings.model;
  for (const k of ['includeFace', 'useHands', 'sendPhoto', 'beep', 'drawSkeleton', 'mirror']) els[k].checked = settings[k];

  const refresh = () => {
    els.sensVal.textContent = `${Math.round(settings.sensitivity * 100)}%`;
    els.holdVal.textContent = `${(settings.holdMs / 1000).toFixed(1)} s`;
    els.coolVal.textContent = `${settings.cooldownS} s`;
    const ip = settings.sourceType !== 'device';
    els.urlField.hidden = !ip;
    els.deviceField.hidden = ip;
    tracker.holdMs = settings.holdMs;
    tracker.cooldownMs = settings.cooldownS * 1000;
    els.viewer.classList.toggle('mirrored', settings.mirror);
  };
  const on = (el, key, parse = (v) => v) => el.addEventListener('input', () => {
    settings[key] = parse(el.type === 'checkbox' ? el.checked : el.value);
    saveSettings();
    refresh();
  });
  on(els.sourceType, 'sourceType');
  on(els.cameraUrl, 'cameraUrl', (v) => v.trim());
  on(els.sensitivity, 'sensitivity', Number);
  on(els.holdMs, 'holdMs', Number);
  on(els.cooldownS, 'cooldownS', Number);
  on(els.includeFace, 'includeFace');
  on(els.useHands, 'useHands');
  on(els.sendPhoto, 'sendPhoto');
  on(els.beep, 'beep');
  on(els.drawSkeleton, 'drawSkeleton');
  on(els.mirror, 'mirror');
  els.deviceSelect.addEventListener('change', () => { settings.deviceId = els.deviceSelect.value; saveSettings(); });
  els.model.addEventListener('change', async () => {
    settings.model = els.model.value;
    saveSettings();
    if (poseLandmarker) { poseLandmarker.close(); poseLandmarker = null; await loadModels(); }
  });
  refresh();
}

// ---------------------------------------------------------------------------
// Modelos de MediaPipe (se cargan una sola vez, en el navegador)

const MODEL_URLS = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task',
  heavy: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task',
  hand: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
};

let vision = null;
let poseLandmarker = null;
let handLandmarker = null;
let mp = null;

async function createWithFallback(Klass, options) {
  try {
    return await Klass.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' } });
  } catch (e) {
    console.warn('GPU no disponible, usando CPU', e);
    return Klass.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } });
  }
}

let localModels = false;

function modelUrl(key) {
  if (!localModels) return MODEL_URLS[key];
  return `/models/${MODEL_URLS[key].split('/').pop()}`;
}

async function loadModels() {
  setStatus('warn', 'Cargando modelos de detección…');
  mp ??= await import('/vendor/mediapipe/vision_bundle.mjs');
  vision ??= await mp.FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
  if (!poseLandmarker) {
    poseLandmarker = await createWithFallback(mp.PoseLandmarker, {
      baseOptions: { modelAssetPath: modelUrl(MODEL_URLS[settings.model] ? settings.model : 'full') },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.4,
      minPosePresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    });
  }
  if (!handLandmarker) {
    handLandmarker = await createWithFallback(mp.HandLandmarker, {
      baseOptions: { modelAssetPath: modelUrl('hand') },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.4,
      minHandPresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    });
  }
}

// ---------------------------------------------------------------------------
// Fuentes de video

const frameCanvas = document.createElement('canvas'); // cuadro actual para cámaras IP
const frameCtx = frameCanvas.getContext('2d');
let stream = null;
let snapshotTimer = null;
let snapshotFresh = false;
let running = false;

function cameraProxyUrl(url) {
  return `/api/camera?url=${encodeURIComponent(url)}&t=${Date.now()}`;
}

async function listDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  els.deviceSelect.innerHTML = '<option value="">Predeterminada</option>';
  devices.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || `Cámara ${i + 1}`;
    els.deviceSelect.append(o);
  });
  if (devices.some((d) => d.deviceId === settings.deviceId)) els.deviceSelect.value = settings.deviceId;
}

async function startSource() {
  const type = settings.sourceType;
  if (type === 'device') {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Este navegador no permite usar la cámara. Abre la app con https:// o desde localhost.');
    }
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        deviceId: settings.deviceId ? { exact: settings.deviceId } : undefined,
        width: { ideal: 1280 }, height: { ideal: 720 },
        facingMode: settings.deviceId ? undefined : 'user',
      },
    });
    els.video.srcObject = stream;
    els.video.hidden = false;
    els.ipImg.hidden = true;
    await els.video.play();
    listDevices().catch(() => {});
    return;
  }

  if (!settings.cameraUrl) throw new Error('Escribe la URL de la cámara IP.');
  els.video.hidden = true;

  if (type === 'mjpeg') {
    els.ipImg.hidden = false;
    await new Promise((resolve, reject) => {
      els.ipImg.onload = resolve; // con MJPEG se dispara al recibir el primer cuadro
      els.ipImg.onerror = () => reject(new Error('No se pudo abrir el stream de la cámara. Revisa la URL.'));
      els.ipImg.src = cameraProxyUrl(settings.cameraUrl);
      setTimeout(() => (els.ipImg.naturalWidth ? resolve() : reject(new Error('La cámara no respondió a tiempo.'))), 10000);
    });
    return;
  }

  // snapshot: pedimos fotos JPG una detrás de otra
  els.ipImg.hidden = false;
  let first = true;
  await new Promise((resolve, reject) => {
    const next = async () => {
      if (!running) return;
      try {
        const r = await fetch(cameraProxyUrl(settings.cameraUrl), { cache: 'no-store' });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`);
        const blob = await r.blob();
        const bmp = await createImageBitmap(blob);
        frameCanvas.width = bmp.width;
        frameCanvas.height = bmp.height;
        frameCtx.drawImage(bmp, 0, 0);
        bmp.close?.();
        const old = els.ipImg.src;
        els.ipImg.src = URL.createObjectURL(blob);
        if (old.startsWith('blob:')) URL.revokeObjectURL(old);
        snapshotFresh = true;
        if (first) { first = false; resolve(); }
        snapshotTimer = setTimeout(next, 80);
      } catch (e) {
        if (first) return reject(new Error(`No se pudo leer la foto de la cámara: ${e.message}`));
        setStatus('warn', `Reintentando cámara… (${e.message})`);
        snapshotTimer = setTimeout(next, 1000);
      }
    };
    next();
  });
}

function stopSource() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  els.video.srcObject = null;
  clearTimeout(snapshotTimer);
  els.ipImg.removeAttribute('src');
  els.ipImg.hidden = true;
}

/** Devuelve la imagen a analizar en este momento (o null si no hay cuadro nuevo). */
let lastVideoTime = -1;
function currentFrame() {
  if (settings.sourceType === 'device') {
    const v = els.video;
    if (v.readyState < 2 || v.currentTime === lastVideoTime) return null;
    lastVideoTime = v.currentTime;
    return { source: v, w: v.videoWidth, h: v.videoHeight };
  }
  if (settings.sourceType === 'mjpeg') {
    const img = els.ipImg;
    if (!img.naturalWidth) return null;
    frameCanvas.width = img.naturalWidth;
    frameCanvas.height = img.naturalHeight;
    frameCtx.drawImage(img, 0, 0);
    return { source: frameCanvas, w: frameCanvas.width, h: frameCanvas.height };
  }
  if (!snapshotFresh) return null;
  snapshotFresh = false;
  return { source: frameCanvas, w: frameCanvas.width, h: frameCanvas.height };
}

// ---------------------------------------------------------------------------
// Bucle de detección

const tracker = new TouchTracker({ holdMs: settings.holdMs, cooldownMs: settings.cooldownS * 1000 });
const octx = els.overlay.getContext('2d');
let lastTs = 0;
let frames = 0;
let fpsT0 = performance.now();
let wakeLock = null;
let lastNoPerson = 0;

function loop() {
  if (!running) return;
  try {
    const frame = currentFrame();
    if (frame && frame.w) processFrame(frame);
  } catch (e) {
    console.error(e);
  }
  // Con la app en segundo plano requestAnimationFrame se pausa; seguimos con un temporizador.
  if (document.hidden) setTimeout(loop, 250);
  else requestAnimationFrame(loop);
}

function processFrame({ source, w, h }) {
  let ts = performance.now();
  if (ts <= lastTs) ts = lastTs + 1;
  lastTs = ts;

  const poseRes = poseLandmarker.detectForVideo(source, ts);
  const pose = poseRes.landmarks?.[0] || null;
  const handRes = settings.useHands && pose ? handLandmarker.detectForVideo(source, ts) : null;
  const hands = handRes?.landmarks || [];

  const res = evaluateFrame(pose, hands, w, h, { sensitivity: settings.sensitivity, includeFace: settings.includeFace });
  const now = Date.now();
  const state = tracker.update(res.touching, now);

  draw(w, h, pose, hands, res, state);

  if (state === 'alert') onTouchAlert(res, w, h, source);
  if (!pose) {
    if (now - lastNoPerson > 1000) { setStatus('warn', 'Buscando a la persona…'); lastNoPerson = now; }
  } else if (res.touching) {
    setStatus('alert', state === 'cooldown' ? 'Mano en la cabeza (esperando para volver a alertar)' : 'Mano en la cabeza');
  } else {
    setStatus('ok', 'Vigilando');
  }

  frames++;
  const t = performance.now();
  if (t - fpsT0 > 1000) {
    els.fps.textContent = `${Math.round((frames * 1000) / (t - fpsT0))} fps`;
    frames = 0;
    fpsT0 = t;
  }
}

// Esqueleto completo: brazos resaltados (amarillo), resto del cuerpo (blanco).
const ARM_CONNECTIONS = [
  [P.L_SHOULDER, P.L_ELBOW], [P.L_ELBOW, P.L_WRIST], [P.R_SHOULDER, P.R_ELBOW], [P.R_ELBOW, P.R_WRIST],
  [P.L_WRIST, P.L_INDEX], [P.L_WRIST, P.L_PINKY], [P.L_PINKY, P.L_INDEX], [P.L_WRIST, P.L_THUMB],
  [P.R_WRIST, P.R_INDEX], [P.R_WRIST, P.R_PINKY], [P.R_PINKY, P.R_INDEX], [P.R_WRIST, P.R_THUMB],
];
const BODY_CONNECTIONS = [
  [P.L_SHOULDER, P.R_SHOULDER], [11, 23], [12, 24], [23, 24], // torso
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], // pierna izquierda
  [24, 26], [26, 28], [28, 30], [30, 32], [28, 32], // pierna derecha
  [P.L_EAR, P.L_EYE], [P.L_EYE, P.NOSE], [P.NOSE, P.R_EYE], [P.R_EYE, P.R_EAR], [9, 10], // cara
];
// Conexiones de los 21 puntos de la mano (MediaPipe Hands)
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
const ARM_POINTS = [P.L_SHOULDER, P.R_SHOULDER, P.L_ELBOW, P.R_ELBOW, P.L_WRIST, P.R_WRIST, P.L_INDEX, P.R_INDEX, P.L_PINKY, P.R_PINKY, P.L_THUMB, P.R_THUMB];
const seen = (L) => L && (L.visibility ?? 1) >= 0.45;

function drawLines(points, pairs, w, h, color, width, check = seen) {
  octx.strokeStyle = color;
  octx.lineWidth = width;
  octx.lineCap = 'round';
  for (const [a, b] of pairs) {
    const A = points[a];
    const B = points[b];
    if (!check(A) || !check(B)) continue;
    octx.beginPath();
    octx.moveTo(A.x * w, A.y * h);
    octx.lineTo(B.x * w, B.y * h);
    octx.stroke();
  }
}

function drawDots(points, idx, w, h, color, r, check = seen) {
  octx.fillStyle = color;
  for (const i of idx) {
    const L = points[i];
    if (!check(L)) continue;
    octx.beginPath();
    octx.arc(L.x * w, L.y * h, r, 0, Math.PI * 2);
    octx.fill();
  }
}

function draw(w, h, pose, hands, res, state) {
  const c = els.overlay;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  octx.clearRect(0, 0, w, h);
  const lw = Math.max(2, w / 400);
  const alerting = res.touching;

  if (res.zone) {
    octx.beginPath();
    octx.arc(res.zone.center.x, res.zone.center.y, res.zone.radius, 0, Math.PI * 2);
    octx.lineWidth = lw * 1.5;
    octx.strokeStyle = alerting ? 'rgba(220,38,38,.95)' : 'rgba(20,184,166,.9)';
    octx.fillStyle = alerting ? 'rgba(220,38,38,.18)' : 'rgba(20,184,166,.08)';
    octx.fill();
    octx.stroke();
  }

  if (settings.drawSkeleton && pose) {
    const all = [...Array(33).keys()];
    drawLines(pose, BODY_CONNECTIONS, w, h, 'rgba(255,255,255,.85)', lw * 1.5);
    drawLines(pose, ARM_CONNECTIONS, w, h, alerting ? '#f87171' : '#facc15', lw * 2.5);
    drawDots(pose, all, w, h, 'rgba(255,255,255,.95)', lw * 1.8);
    drawDots(pose, ARM_POINTS, w, h, alerting ? '#dc2626' : '#f59e0b', lw * 3);
    for (const hand of hands) {
      drawLines(hand, HAND_CONNECTIONS, w, h, '#38bdf8', lw * 1.5, Boolean);
      drawDots(hand, hand.map((_, i) => i), w, h, '#0ea5e9', lw * 1.6, Boolean);
    }
  }
  els.banner.hidden = !(alerting && (tracker.alertedThisTouch || state === 'cooldown'));
}

// ---------------------------------------------------------------------------
// Alertas

async function onTouchAlert(res, w, h, source) {
  const when = new Date();
  const lado = res.side ? ` (mano ${res.side})` : '';
  const text = `⚠️ Se tocó la cabeza${lado}\n🕒 ${when.toLocaleString()}`;
  addLog(`Se tocó la cabeza${lado}`, 'alert');
  if (settings.beep) beep();
  navigator.vibrate?.(300);

  let image;
  if (settings.sendPhoto) {
    try {
      const snap = document.createElement('canvas');
      const scale = Math.min(1, 960 / w);
      snap.width = Math.round(w * scale);
      snap.height = Math.round(h * scale);
      const sctx = snap.getContext('2d');
      sctx.drawImage(source, 0, 0, snap.width, snap.height);
      sctx.drawImage(els.overlay, 0, 0, snap.width, snap.height);
      image = snap.toDataURL('image/jpeg', 0.8);
    } catch (e) {
      console.warn('No se pudo capturar la foto', e);
    }
  }
  try {
    const r = await fetch('/api/alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, image }),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error);
    addLog('Alerta enviada por Telegram');
  } catch (e) {
    addLog(`No se pudo enviar a Telegram: ${e.message}`, 'alert');
  }
}

let audioCtx = null;
function beep() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.2, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.5);
  } catch { /* sin audio */ }
}

function addLog(msg, cls = '') {
  const li = document.createElement('li');
  li.className = cls;
  li.textContent = `${new Date().toLocaleTimeString()} · ${msg}`;
  els.log.prepend(li);
  while (els.log.children.length > 100) els.log.lastChild.remove();
}

function setStatus(kind, text) {
  els.statusDot.className = `dot ${kind}`;
  if (els.statusText.textContent !== text) els.statusText.textContent = text;
}

// ---------------------------------------------------------------------------
// Telegram (estado y ayudas)

async function refreshTelegramStatus() {
  try {
    const s = await (await fetch('/api/status')).json();
    localModels = Boolean(s.localModels);
    els.tgStatus.textContent = s.telegram
      ? `Configurado: las alertas se envían a ${s.chats} chat(s).`
      : s.hasToken
        ? 'Falta TELEGRAM_CHAT_ID. Escríbele algo a tu bot y presiona "Buscar mi chat_id".'
        : 'Sin configurar. Completa TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID en el archivo .env del servidor.';
  } catch {
    els.tgStatus.textContent = 'No se pudo contactar al servidor.';
  }
}

els.testBtn.addEventListener('click', async () => {
  els.testBtn.disabled = true;
  try {
    const r = await fetch('/api/alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `✅ Prueba de DETEC MOV\n🕒 ${new Date().toLocaleString()}` }),
    });
    const data = await r.json();
    addLog(data.ok ? 'Prueba enviada a Telegram' : `Error en la prueba: ${data.error}`, data.ok ? '' : 'alert');
  } catch (e) {
    addLog(`Error en la prueba: ${e.message}`, 'alert');
  } finally {
    els.testBtn.disabled = false;
  }
});

els.findChatBtn.addEventListener('click', async () => {
  els.chatList.hidden = false;
  els.chatList.textContent = 'Buscando…';
  try {
    const data = await (await fetch('/api/telegram/chats')).json();
    if (data.error) throw new Error(data.error);
    els.chatList.textContent = data.chats.length
      ? data.chats.map((c) => `${c.id}  ${c.name || ''} (${c.type})`).join('\n') + '\n\nCopia el número en TELEGRAM_CHAT_ID del .env y reinicia el servidor.'
      : 'No hay mensajes. Abre tu bot en Telegram, envíale "hola" y vuelve a intentar.';
  } catch (e) {
    els.chatList.textContent = `Error: ${e.message}`;
  }
});

// ---------------------------------------------------------------------------
// Iniciar / detener

els.startBtn.addEventListener('click', async () => {
  els.startBtn.disabled = true;
  try {
    await loadModels();
    setStatus('warn', 'Abriendo cámara…');
    running = true;
    await startSource();
    els.placeholder.hidden = true;
    els.stopBtn.disabled = false;
    addLog('Vigilancia iniciada');
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* opcional */ }
    loop();
  } catch (e) {
    running = false;
    stopSource();
    setStatus('alert', e.message || String(e));
    addLog(e.message || String(e), 'alert');
    els.startBtn.disabled = false;
  }
});

els.stopBtn.addEventListener('click', () => {
  running = false;
  stopSource();
  wakeLock?.release?.();
  wakeLock = null;
  octx.clearRect(0, 0, els.overlay.width, els.overlay.height);
  els.banner.hidden = true;
  els.placeholder.hidden = false;
  els.startBtn.disabled = false;
  els.stopBtn.disabled = true;
  els.fps.textContent = '';
  setStatus('', 'Detenido');
  addLog('Vigilancia detenida');
});

document.addEventListener('visibilitychange', async () => {
  if (running && !document.hidden && (!wakeLock || wakeLock.released)) {
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* opcional */ }
  }
});

bindSettings();
refreshTelegramStatus();
listDevices().catch(() => {});
setupInstallButton($('installBtn'), $('iosDialog'));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW no registrado', e));
}
