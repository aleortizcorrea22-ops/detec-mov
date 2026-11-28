import { evaluateFrame, P, manoAbajo } from './rules.js';
import { PeopleTracker, assignHands, poseBox, filtrarPosesDuplicadas, zonePoints, evidenciaDeCuerpoReal } from './people.js';
import { setupInstallButton } from './install.js';

// Visible en pantalla (junto al nombre) para confirmar de un vistazo si el celular/PC ya
// tiene la versión más nueva, sin tener que abrir herramientas de desarrollador. Se sube
// junto con el VERSION de sw.js en cada cambio.
const APP_VERSION = 'v76';
import { loadDirectConfig, saveDirectConfig, sendDirectAlert, findDirectChats } from './telegram-direct.js';
import { iniciarChequeoLicencia, accesoActual, mensajeBloqueo, reportarPresenciaEnVivo, loadLicenciaConfig } from './licencia.js';
import { iniciarPanelAdmin, NOMBRE_ADMIN_SECRETO } from './admin-panel.js';

// Servidores para que el video en vivo cruce redes difíciles (NAT estricto, datos
// móviles): STUN de Google siempre, más el TURN propio de la Raspberry, pedido al
// vuelo (la clave y la IP de esta casa no están escritas acá, que es código público).
// Si no se puede pedir, se usa uno público gratuito (Open Relay) de respaldo.
const ICE_SERVERS_RESPALDO = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
};
async function obtenerIceServers() {
  try {
    const { baseUrl } = loadLicenciaConfig();
    const r = await fetch(`${baseUrl}/api/ice-servers`);
    const { iceServers } = await r.json();
    if (Array.isArray(iceServers) && iceServers.length) return { iceServers: [...iceServers, ...ICE_SERVERS_RESPALDO.iceServers] };
  } catch { /* sin conexión con la Raspberry ahora: se usa el respaldo */ }
  return ICE_SERVERS_RESPALDO;
}

const $ = (id) => document.getElementById(id);
const els = {
  video: $('video'), ipImg: $('ipImg'), overlay: $('overlay'), placeholder: $('placeholder'), banner: $('banner'),
  pantallaCompletaBtn: $('pantallaCompletaBtn'),
  statusDot: $('statusDot'), statusText: $('statusText'), fps: $('fps'),
  sourceType: $('sourceType'), deviceField: $('deviceField'), deviceSelect: $('deviceSelect'),
  urlField: $('urlField'), cameraUrl: $('cameraUrl'), startBtn: $('startBtn'), stopBtn: $('stopBtn'),
  sensitivity: $('sensitivity'), sensVal: $('sensVal'), holdMs: $('holdMs'), holdVal: $('holdVal'),
  cooldownS: $('cooldownS'), coolVal: $('coolVal'), model: $('model'), alertCabeza: $('alertCabeza'), includeFace: $('includeFace'), useHands: $('useHands'),
  sendPhoto: $('sendPhoto'), beep: $('beep'), drawSkeleton: $('drawSkeleton'), mirror: $('mirror'), viewer: $('viewer'), liveWebrtc: $('liveWebrtc'), liveAudioRow: $('liveAudioRow'), liveMicBtn: $('liveMicBtn'), liveSoundBtn: $('liveSoundBtn'),
  tgStatus: $('tgStatus'), testBtn: $('testBtn'), findChatBtn: $('findChatBtn'), chatList: $('chatList'), log: $('log'),
  directTelegramFields: $('directTelegramFields'), directToken: $('directToken'), directChatIds: $('directChatIds'), saveDirectBtn: $('saveDirectBtn'),
  deviceName: $('deviceName'), deviceNameShowBtn: $('deviceNameShowBtn'), maxPeople: $('maxPeople'), detectFalls: $('detectFalls'), fallHoldS: $('fallHoldS'),
  fallVal: $('fallVal'), fallHoldField: $('fallHoldField'),
  alertSento: $('alertSento'), alertLevanto: $('alertLevanto'), alertCamaEntra: $('alertCamaEntra'), alertCamaSale: $('alertCamaSale'),
  alertCamina: $('alertCamina'), alertQuieta: $('alertQuieta'), alertPideAyuda: $('alertPideAyuda'), bedMarkBtn: $('bedMarkBtn'), bedClearBtn: $('bedClearBtn'), bedInfo: $('bedInfo'),
  watchZoneEnter: $('watchZoneEnter'), watchZoneExit: $('watchZoneExit'), watchZoneInside: $('watchZoneInside'), watchZoneOutside: $('watchZoneOutside'),
  watchZoneMarkBtn: $('watchZoneMarkBtn'), watchZoneClearBtn: $('watchZoneClearBtn'), watchZoneResetBtn: $('watchZoneResetBtn'), watchZoneInfo: $('watchZoneInfo'), watchZoneLive: $('watchZoneLive'),
  watchDwellInS: $('watchDwellInS'), watchDwellInVal: $('watchDwellInVal'), watchDwellInUnit: $('watchDwellInUnit'),
  watchDwellOutS: $('watchDwellOutS'), watchDwellOutVal: $('watchDwellOutVal'), watchDwellOutUnit: $('watchDwellOutUnit'),
};

// ---------------------------------------------------------------------------
// Configuración guardada en el equipo

const DEFAULTS = {
  sourceType: 'device', deviceId: '', cameraUrl: '', sensitivity: 0.6, holdMs: 600, cooldownS: 30,
  model: 'full', includeFace: false, useHands: true, sendPhoto: true, beep: true, drawSkeleton: true, mirror: false, mirrorAuto: true, liveWebrtc: false, liveMicMuted: false, liveSoundMuted: false,
  deviceName: '', deviceNameAsked: false, maxPeople: 3, alertCabeza: true, detectFalls: true, fallHoldS: 3,
  // Actividades: siempre se anotan en Eventos; a Telegram solo si se activa cada una.
  alertSento: false, alertLevanto: false, alertCamaEntra: false, alertCamaSale: false, alertCamina: false, alertQuieta: false, alertPideAyuda: false,
  bedZones: [],
  watchZoneEnter: false, watchZoneExit: false, watchZoneInside: false, watchZoneOutside: false,
  watchZones: [], watchDwellInS: 10, watchDwellInUnit: 's', watchDwellOutS: 30, watchDwellOutUnit: 's',
  // Contadores de entradas/salidas: NO van dentro del seguimiento de cada persona (eso se
  // borra cada vez que se toca Iniciar, para renumerar Persona 1, 2…). Viven acá, guardados,
  // y solo se ponen en 0 cuando el usuario toca "Reiniciar contadores".
  watchEnterCount: 0, watchExitCount: 0,
};

// Unidad de los tiempos de zona: el usuario elige segundos, minutos u horas; la barra
// siempre va de 1 a 120 "unidades", así no hace falta una barra gigante para horas.
const UNIT_MS = { s: 1000, m: 60000, h: 3600000 };
const UNIT_LABEL = { s: 's', m: 'min', h: 'h' };
const settings = { ...DEFAULTS, ...readSettings() };

function readSettings() {
  try { return JSON.parse(localStorage.getItem('detecmov.settings') || '{}'); } catch { return {}; }
}
function saveSettings() {
  try { localStorage.setItem('detecmov.settings', JSON.stringify(settings)); } catch { /* sin almacenamiento */ }
}

/** Pone el espejado solo según si la cámara que se usó es delantera o trasera (salvo que
 * el usuario ya lo haya tocado a mano con la casilla, ver bindSettings). La cámara
 * delantera se ve en espejo (como en una videollamada); la trasera, no. */
function aplicarMirrorAutomatico(facingMode) {
  if (!settings.mirrorAuto || !facingMode) return;
  const espejado = facingMode === 'user';
  settings.mirror = espejado;
  els.mirror.checked = espejado;
  els.viewer.classList.toggle('mirrored', espejado);
  saveSettings();
}

function bindSettings() {
  els.sourceType.value = settings.sourceType;
  els.cameraUrl.value = settings.cameraUrl;
  els.sensitivity.value = settings.sensitivity;
  els.holdMs.value = settings.holdMs;
  els.cooldownS.value = settings.cooldownS;
  els.model.value = settings.model;
  for (const k of ['includeFace', 'useHands', 'sendPhoto', 'beep', 'drawSkeleton', 'mirror', 'liveWebrtc', 'alertCabeza', 'detectFalls', 'watchZoneEnter', 'watchZoneExit', 'watchZoneInside', 'watchZoneOutside', ...ACTIVITY_KEYS]) els[k].checked = settings[k];
  els.deviceName.value = deviceName();
  els.maxPeople.value = settings.maxPeople;
  els.fallHoldS.value = settings.fallHoldS;
  els.watchDwellInS.value = settings.watchDwellInS;
  els.watchDwellOutS.value = settings.watchDwellOutS;
  els.watchDwellInUnit.value = settings.watchDwellInUnit;
  els.watchDwellOutUnit.value = settings.watchDwellOutUnit;

  const refresh = () => {
    els.sensVal.textContent = `${Math.round(settings.sensitivity * 100)}%`;
    els.holdVal.textContent = `${(settings.holdMs / 1000).toFixed(1)} s`;
    els.coolVal.textContent = `${settings.cooldownS} s`;
    const ip = settings.sourceType !== 'device';
    els.urlField.hidden = !ip;
    els.deviceField.hidden = ip;
    els.fallVal.textContent = `${settings.fallHoldS} s`;
    els.fallHoldField.hidden = !settings.detectFalls;
    els.watchDwellInVal.textContent = `${settings.watchDwellInS} ${UNIT_LABEL[settings.watchDwellInUnit]}`;
    els.watchDwellOutVal.textContent = `${settings.watchDwellOutS} ${UNIT_LABEL[settings.watchDwellOutUnit]}`;
    refreshWatchZoneInfo();
    people.configure({
      touch: { holdMs: settings.holdMs, cooldownMs: settings.cooldownS * 1000 },
      fall: { holdMs: settings.fallHoldS * 1000, cooldownMs: Math.max(60000, settings.cooldownS * 1000) },
    });
    els.viewer.classList.toggle('mirrored', settings.mirror);
    els.liveAudioRow.hidden = !settings.liveWebrtc;
    els.liveMicBtn.hidden = !settings.liveWebrtc;
    els.liveMicBtn.textContent = settings.liveMicMuted ? '🔇 Micrófono SILENCIADO · tocar para activar' : '🎤 Silenciar micrófono';
    els.liveMicBtn.classList.toggle('is-muted', settings.liveMicMuted);
    els.liveSoundBtn.hidden = !settings.liveWebrtc;
    els.liveSoundBtn.textContent = settings.liveSoundMuted ? '🔇 Sonido SILENCIADO · tocar para activar' : '🔈 Silenciar sonido';
    els.liveSoundBtn.classList.toggle('is-muted', settings.liveSoundMuted);
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
  // El espejado se pone solo según la cámara (ver aplicarMirrorAutomatico), pero si
  // el usuario lo toca a mano, esa elección manda y ya no se vuelve a tocar sola.
  els.mirror.addEventListener('input', () => {
    settings.mirror = els.mirror.checked;
    settings.mirrorAuto = false;
    saveSettings();
    refresh();
  });
  on(els.liveWebrtc, 'liveWebrtc');
  on(els.alertCabeza, 'alertCabeza');
  on(els.detectFalls, 'detectFalls');
  for (const k of ACTIVITY_KEYS) on(els[k], k);
  setupBedZones();
  setupWatchZone();
  on(els.fallHoldS, 'fallHoldS', Number);
  on(els.watchZoneEnter, 'watchZoneEnter');
  on(els.watchZoneExit, 'watchZoneExit');
  on(els.watchZoneInside, 'watchZoneInside');
  on(els.watchZoneOutside, 'watchZoneOutside');
  on(els.watchDwellInS, 'watchDwellInS', Number);
  on(els.watchDwellOutS, 'watchDwellOutS', Number);
  on(els.watchDwellInUnit, 'watchDwellInUnit');
  on(els.watchDwellOutUnit, 'watchDwellOutUnit');
  on(els.deviceName, 'deviceName', (v) => v.slice(0, 40));
  els.deviceName.addEventListener('input', () => { settings.deviceNameAsked = true; saveSettings(); });
  els.deviceNameShowBtn.addEventListener('click', () => {
    const verlo = els.deviceName.type === 'password';
    els.deviceName.type = verlo ? 'text' : 'password';
    els.deviceNameShowBtn.textContent = verlo ? 'Ocultar' : 'Ver';
  });
  // Cantidad de personas: hay que recargar el modelo de pose para que tome el cambio.
  els.maxPeople.addEventListener('change', async () => {
    settings.maxPeople = Math.min(6, Math.max(1, Number(els.maxPeople.value) || 1));
    els.maxPeople.value = settings.maxPeople;
    saveSettings();
    if (poseLandmarker) {
      poseLandmarker.close(); poseLandmarker = null;
      handLandmarker?.close(); handLandmarker = null;
      await loadModels();
    }
  });
  els.liveMicBtn.addEventListener('click', () => {
    if (!settings.liveMicMuted) {
      if (!confirm('¿Seguro que querés silenciar el micrófono? Quien mire en vivo no va a poder hablar.')) return;
      if (!confirm('¿Está realmente seguro? Tocá Aceptar para silenciar.')) return;
      settings.liveMicMuted = true;
      addLog('Micrófono del video en vivo silenciado', 'alert');
    } else {
      settings.liveMicMuted = false;
      addLog('Micrófono del video en vivo reactivado');
    }
    saveSettings();
    applyLiveMute();
    refresh();
  });
  els.liveSoundBtn.addEventListener('click', () => {
    if (!settings.liveSoundMuted) {
      if (!confirm('¿Seguro que querés silenciar el sonido? No vas a escuchar lo que diga quien mira en vivo.')) return;
      if (!confirm('¿Está realmente seguro? Tocá Aceptar para silenciar.')) return;
      settings.liveSoundMuted = true;
      addLog('Sonido del video en vivo silenciado', 'alert');
    } else {
      settings.liveSoundMuted = false;
      addLog('Sonido del video en vivo reactivado');
    }
    saveSettings();
    applyLiveMute();
    refresh();
  });
  els.deviceSelect.addEventListener('change', async () => {
    settings.deviceId = els.deviceSelect.value;
    saveSettings();
    if (running && settings.sourceType === 'device') {
      try {
        if (stream) stream.getTracks().forEach((t) => t.stop());
        await startSource();
        addLog('Cámara cambiada: ' + (els.deviceSelect.selectedOptions[0]?.textContent || ''));
      } catch (err) {
        addLog('No se pudo cambiar de cámara: ' + err.message);
      }
    }
  });
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
  // Detector de objetos (igual familia que YOLO: entrenado en COCO, con "person" como una
  // clase más entre silla, taza, mouse, teclado, lata, etc.). Se usa para CONFIRMAR que
  // una pose detectada corresponde de verdad a una persona, porque el modelo de pose solo
  // sabe dibujar un esqueleto y a veces "completa" uno creíble a partir de cualquier cosa.
  object: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/latest/efficientdet_lite0.tflite',
};

let vision = null;
let poseLandmarker = null;
let handLandmarker = null;
let objectDetector = null;
let objectDetectorFailed = false; // si no carga (sin internet la primera vez, etc.), no bloquear todo el resto
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
const MEDIAPIPE_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35';

function modelUrl(key) {
  if (!localModels) return MODEL_URLS[key];
  return `models/${MODEL_URLS[key].split('/').pop()}`;
}

async function loadModels() {
  setStatus('warn', 'Cargando modelos de detección…');
  if (hasBackend === null) await detectBackend();
  // Con servidor propio (server.js), la librería se sirve local (anda sin internet
  // después de la primera vez). Sin servidor (por ejemplo instalada desde GitHub
  // Pages), se trae de un CDN público.
  const vendorBase = hasBackend ? 'vendor/mediapipe' : MEDIAPIPE_CDN;
  mp ??= await import(`${vendorBase}/vision_bundle.mjs`);
  vision ??= await mp.FilesetResolver.forVisionTasks(`${vendorBase}/wasm`);
  if (!poseLandmarker) {
    poseLandmarker = await createWithFallback(mp.PoseLandmarker, {
      baseOptions: { modelAssetPath: modelUrl(MODEL_URLS[settings.model] ? settings.model : 'full') },
      runningMode: 'VIDEO',
      numPoses: Math.min(6, Math.max(1, Number(settings.maxPeople) || 1)),
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.4,
    });
  }
  if (!handLandmarker) {
    handLandmarker = await createWithFallback(mp.HandLandmarker, {
      baseOptions: { modelAssetPath: modelUrl('hand') },
      runningMode: 'VIDEO',
      numHands: Math.min(6, 2 * Math.max(1, Number(settings.maxPeople) || 1)),
      minHandDetectionConfidence: 0.4,
      minHandPresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    });
  }
  if (!objectDetector && !objectDetectorFailed) {
    try {
      objectDetector = await createWithFallback(mp.ObjectDetector, {
        baseOptions: { modelAssetPath: modelUrl('object') },
        runningMode: 'VIDEO',
        scoreThreshold: 0.35,
        maxResults: 8,
        categoryAllowlist: ['person'],
      });
    } catch (e) {
      // Sin esto, la app sigue andando con los chequeos de geometría nada más (menos
      // seguro, pero no deja a nadie sin la app por un modelo extra que no pudo bajar).
      console.warn('No se pudo cargar el detector de objetos (verificación extra de persona):', e);
      objectDetectorFailed = true;
    }
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
  els.deviceSelect.innerHTML = '<option value="">Cámara trasera</option><option value="front">Cámara delantera</option>';
  devices.forEach((d, i) => {
    const o = document.createElement('option');
    o.value = d.deviceId;
    o.textContent = d.label || `Cámara ${i + 1}`;
    els.deviceSelect.append(o);
  });
  if (settings.deviceId === 'front' || devices.some((d) => d.deviceId === settings.deviceId)) els.deviceSelect.value = settings.deviceId;
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
        deviceId: settings.deviceId && settings.deviceId !== 'front' ? { exact: settings.deviceId } : undefined,
        width: { ideal: 1280 }, height: { ideal: 720 },
        facingMode: settings.deviceId === 'front' ? 'user' : settings.deviceId ? undefined : 'environment',
      },
    });
    els.video.srcObject = stream;
    els.video.hidden = false;
    els.ipImg.hidden = true;
    await els.video.play();
    const trackSettings = stream.getVideoTracks()[0]?.getSettings?.() || {};
    const facingMode = trackSettings.facingMode
      || (settings.deviceId === 'front' ? 'user' : settings.deviceId ? undefined : 'environment');
    aplicarMirrorAutomatico(facingMode);
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

// ---------------------------------------------------------------------------
// Video en vivo celular a celular (WebRTC), sin servidor propio.
// Usa PeerJS (señalización gratuita en 0.peerjs.com) solo para que los dos
// celulares se encuentren; el video después va directo entre los dos.

let livePeer = null;
let liveLinkSent = false;
let liveMicStream = null;
let liveAudioEls = [];
const audioElsPorCall = new Map();
let activeCalls = [];

function liveShareId() {
  let id = localStorage.getItem('detecmov.live.id');
  if (!id) {
    id = 'dmv-' + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem('detecmov.live.id', id); } catch { /* sin almacenamiento */ }
  }
  return id;
}

let latidoPresencia = null;

async function openLivePeer(id) {
  livePeer = new Peer(id, { config: await obtenerIceServers() });
  livePeer.on('open', async () => {
    if (liveLinkSent) return;
    liveLinkSent = true;
    // Al link de siempre (este vigía puntual) se le agrega el id del sistema, así si
    // hay otro vigía más transmitiendo a la vez, la misma página los junta a los dos.
    const { id: idSistema } = loadLicenciaConfig();
    const base = `${location.origin}${location.pathname.replace(/[^/]*$/, '')}`;
    const link = idSistema
      ? `${base}multiver.html?id=${encodeURIComponent(idSistema)}`
      : `${base}ver.html?n=${encodeURIComponent(nombreVisible())}#${id}`;
    addLog(`Video en vivo listo: ${link}`);
    try {
      await sendAlert({ text: `🔴 ${nombreVisible()}: ver esta cámara en vivo\n${link}` });
    } catch (e) {
      addLog(`No se pudo mandar el link por Telegram: ${e.message}`, 'alert');
    }
    // Avisa al panel de administrador que este sistema está en vivo (se repite cada
    // minuto mientras siga transmitiendo, para que el admin sepa si sigue activo).
    reportarPresenciaEnVivo(id, nombreVisible());
    if (latidoPresencia) clearInterval(latidoPresencia);
    latidoPresencia = setInterval(() => reportarPresenciaEnVivo(id, nombreVisible()), 60 * 1000);
  });
  livePeer.on('call', async (call) => {
    // No se cierran las llamadas anteriores: pueden mirar varias personas a la vez,
    // cada una con su propia llamada, todas mandando la misma cámara.
    activeCalls.push(call);
    call.on('close', () => {
      activeCalls = activeCalls.filter((c) => c !== call);
      const el = audioElsPorCall.get(call);
      if (el) { el.remove(); liveAudioEls = liveAudioEls.filter((a) => a !== el); audioElsPorCall.delete(call); }
    });
    let tracks = [...stream.getVideoTracks()];
    if (liveMicStream) {
      const micTrack = liveMicStream.getAudioTracks()[0];
      if (micTrack) { micTrack.enabled = !settings.liveMicMuted; tracks.push(micTrack); }
    }
    call.answer(new MediaStream(tracks));
    call.on('stream', (remoteStream) => {
      // Lo que diga quien mira, para que lo escuche la persona. Un <audio> por cada
      // persona que mira, para que no se pisen si hablan varias a la vez.
      const audioEl = document.createElement('audio');
      audioEl.autoplay = true;
      audioEl.muted = !!settings.liveSoundMuted;
      audioEl.srcObject = remoteStream;
      document.body.appendChild(audioEl);
      liveAudioEls.push(audioEl);
      audioElsPorCall.set(call, audioEl);
    });
  });
  livePeer.on('disconnected', () => {
    if (settings.liveWebrtc) setTimeout(() => livePeer?.reconnect(), 2000);
  });
  livePeer.on('error', (err) => {
    if (err.type === 'peer-unavailable') {
      // Pasa cuando quien miraba se fue o cerró la página; no afecta la vigilancia.
      console.warn('Video en vivo:', err.type);
    } else if (err.type === 'unavailable-id') {
      // Quedó registrado de una sesión anterior (se va a liberar solo). Reintentamos.
      setTimeout(() => { if (settings.liveWebrtc) openLivePeer(id); }, 5000);
    } else {
      addLog(`Video en vivo: ${err.type || err.message}`, 'alert');
    }
  });
}

async function startLiveShare() {
  if (!settings.liveWebrtc || settings.sourceType !== 'device' || !stream) return;
  if (typeof Peer === 'undefined') {
    addLog('No se pudo activar el video en vivo (sin conexión a internet)', 'alert');
    return;
  }
  liveLinkSent = false;
  try {
    liveMicStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }).catch((e) => {
      addLog(`Sin micrófono para el video en vivo (quien mire no va a poder escuchar el ambiente): ${e.message}`, 'alert');
      return null;
    });
    openLivePeer(liveShareId());
  } catch (e) {
    addLog(`No se pudo activar el video en vivo: ${e.message}`, 'alert');
  }
}

function applyLiveMute() {
  const micTrack = liveMicStream?.getAudioTracks()[0];
  if (micTrack) micTrack.enabled = !settings.liveMicMuted;
  liveAudioEls.forEach((el) => { el.muted = !!settings.liveSoundMuted; });
}

function stopLiveShare() {
  livePeer?.destroy();
  livePeer = null;
  activeCalls = [];
  if (latidoPresencia) { clearInterval(latidoPresencia); latidoPresencia = null; }
  liveMicStream?.getTracks().forEach((t) => t.stop());
  liveMicStream = null;
  liveAudioEls.forEach((el) => el.remove());
  liveAudioEls = [];
  audioElsPorCall.clear();
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && livePeer?.disconnected && !livePeer.destroyed) livePeer.reconnect();
});

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

// Cada persona tiene su número (Persona 1, 2…) y sus propias alertas de "mano en la cabeza" y "caída".
const people = new PeopleTracker({
  touch: { holdMs: settings.holdMs, cooldownMs: settings.cooldownS * 1000 },
  fall: { holdMs: settings.fallHoldS * 1000, cooldownMs: Math.max(60000, settings.cooldownS * 1000) },
});
const octx = els.overlay.getContext('2d');
let lastTs = 0;
let frames = 0;
let fpsT0 = performance.now();
let wakeLock = null;
let lastNoPerson = 0;

let loopRaf = 0;
let loopTimer = 0;
function loop() {
  cancelAnimationFrame(loopRaf);
  clearTimeout(loopTimer);
  if (!running) return;
  try {
    const frame = currentFrame();
    if (frame && frame.w) processFrame(frame);
  } catch (e) {
    console.error(e);
  }
  // Con la app en segundo plano (o la ventana tapada) requestAnimationFrame se pausa:
  // por las dudas también hay un temporizador, así nunca se queda quieta.
  if (document.hidden) {
    loopTimer = setTimeout(loop, 250);
  } else {
    loopRaf = requestAnimationFrame(loop);
    loopTimer = setTimeout(loop, 400);
  }
}

// Última vez que corrió el detector de objetos y qué encontró, para no correrlo en
// cada cuadro (es más pesado) sin perder precisión: alcanza con confirmar cada
// pocos cientos de ms, mucho más rápido que lo que tarda en dispararse cualquier alerta.
let lastObjCheck = 0;
let cachedPersonBoxes = null;
let objSinPersonaDesde = 0;
let lastDiagLog = 0;
const OBJ_CHECK_MS = 700;
// Una CAÍDA es la alerta más grave y la más cara de tener falsa (asusta a la familia).
// Patrones decorativos repetitivos (ventilador de techo, botones de un respaldo
// tapizado, una reja) a veces se "completan" como un cuerpo entero por el modelo de
// pose, con buena confianza en varios puntos. El verificador de persona (COCO) casi
// nunca va a confirmar "persona" sobre un objeto así, así que exigirle a CADA
// seguimiento (persona) una confirmación real y reciente del verificador filtra estos
// casos sin perjudicar a una persona real (que tarde o temprano se confirma).
// Solo si el verificador lleva MUCHO tiempo sin confirmar a NADIE en todo el cuadro
// (posible con muy poca luz) se deja de exigir esto, para no tapar una caída real.
const FALL_CONFIRM_WINDOW_MS = 6000;
const FALL_VERIFIER_GIVEUP_MS = 20000;
// Una caída real es brusca: la cadera baja rápido (pico de velocidad alto). Acostarse a
// propósito (a descansar, a dormir) es lento y controlado, no llega a ese pico — y esto
// vale aunque la cama no esté marcada en pantalla (sirve para cuando no se puede marcar
// nada en esa cámara/celular, ej. cámaras IP ajenas a la app). Unidad: "troncos por
// segundo" (igual escala que walkSpeed, ~0.7 = caminar). Una caída ronda 1.5-3; un
// recline lento, bastante menos de 1.
const FALL_SPEED_MIN = 1.1;
// El brazo tiene que haber estado claramente ABAJO hace poco antes de contar un toque de
// cabeza (ver manoAbajo en rules.js): así se exige ver subir el brazo de verdad, cuadro a
// cuadro, en vez de aceptar que la mano "aparezca" ya arriba de golpe.
const HAND_RISE_WINDOW_MS = 2500;
// Una persona real se mantiene confirmada mucho más que esto; una alucinación de un solo
// cuadro (desenfoque de movimiento al mover la cámara) no llega a sostenerse tanto.
const PERSON_STABLE_MS = 400;

/** ¿El recuadro de esta pose cae adentro (con margen) de algún "person" confirmado
 * por el detector de objetos? Si no hay margen de superposición, no se confía en la pose. */
function poseConfirmadaComoPersona(pose, personBoxes, w, h) {
  const box = poseBox(pose, w, h);
  if (!box) return false;
  return personBoxes.some((pb) => (
    box.cx >= pb.originX - pb.width * 0.2 && box.cx <= pb.originX + pb.width * 1.2 &&
    box.cy >= pb.originY - pb.height * 0.2 && box.cy <= pb.originY + pb.height * 1.2
  ));
}

function processFrame({ source, w, h }) {
  let ts = performance.now();
  if (ts <= lastTs) ts = lastTs + 1;
  lastTs = ts;

  const poseRes = poseLandmarker.detectForVideo(source, ts);
  let poses = filtrarPosesDuplicadas(poseRes.landmarks || [], w, h);
  const rawPoseCount = poses.length;

  // PRIMER FILTRO, antes de seguir a nadie como persona: tiene que haber evidencia real
  // de cuerpo humano (cara creíble — ojos, nariz — o una pierna de confianza alta). Un
  // ventilador de techo, un respaldo tapizado, o cualquier objeto que se mueva puede
  // "completar" un esqueleto con hombros y cadera para el modelo de pose, pero no le
  // puede inventar una cara ni una pierna de verdad. Sin esto, ni siquiera se lo empieza
  // a numerar como "Persona N": no llega a la pantalla ni a ninguna alerta.
  poses = poses.filter(evidenciaDeCuerpoReal);

  // Verificación extra con un detector de objetos tipo COCO (misma familia que YOLO):
  // sabe distinguir "persona" de taza, mouse, teclado, lata, silla, etc., algo que el
  // modelo de pose no sabe hacer (solo dibuja un esqueleto, y a veces "completa" uno
  // creíble a partir de cualquier cosa). Sin esto confirmado, la pose no cuenta.
  if (objectDetector && poses.length && !objectDetectorFailed) {
    if (ts - lastObjCheck >= OBJ_CHECK_MS) {
      lastObjCheck = ts;
      try {
        const objRes = objectDetector.detectForVideo(source, ts);
        cachedPersonBoxes = (objRes.detections || [])
          .filter((d) => d.categories?.[0]?.categoryName === 'person')
          .map((d) => d.boundingBox);
        if (cachedPersonBoxes.length) objSinPersonaDesde = 0;
        else objSinPersonaDesde ||= ts;
      } catch (e) {
        // Si el verificador falla en este equipo (celular/GPU/WASM), no debe tumbar
        // toda la detección: se desactiva solo y se vuelve al comportamiento anterior.
        console.warn('Verificador de persona falló, se desactiva en este equipo:', e);
        objectDetectorFailed = true;
        cachedPersonBoxes = null;
      }
    }
    // Si hace rato que el verificador no confirma a NADIE (ni siquiera cuando el
    // modelo de pose sí ve a alguien), es que no está pudiendo confirmar en este
    // equipo/lugar (poca luz, ángulo, cámara floja) y no se debe confiar en él: mejor
    // dejar pasar las poses sin ese filtro que esconder a la persona por completo.
    const confiable = cachedPersonBoxes && !(objSinPersonaDesde && ts - objSinPersonaDesde > 8000);
    if (confiable) poses = poses.filter((pose) => poseConfirmadaComoPersona(pose, cachedPersonBoxes, w, h));
  }

  const handRes = settings.useHands && poses.length ? handLandmarker.detectForVideo(source, ts) : null;
  const hands = handRes?.landmarks || [];
  const handsByPose = assignHands(poses, hands, w, h);
  const now = Date.now();

  // Diagnóstico: si no se ve a nadie, avisar si es porque el modelo de pose no ve ningún
  // cuerpo (problema de cámara/luz/modelo) o porque el verificador extra lo está
  // descartando (problema del verificador), para saber dónde está la falla real.
  if (!poses.length && now - lastDiagLog > 6000) {
    lastDiagLog = now;
    if (rawPoseCount === 0) addLog('Diagnóstico: el detector de pose no ve ningún cuerpo en la imagen (puede ser cámara, luz o distancia).');
    else addLog(`Diagnóstico: el detector de pose ve ${rawPoseCount} cuerpo(s), pero se descartaron (sin cara ni pierna creíble visible, o el verificador extra no los confirmó).`);
  }

  // Evalúa a cada persona por separado.
  const list = people.update(poses, w, h, now).map((p) => {
    const pose = poses[p.index];
    // --- Confirmaciones de "esto es una persona de verdad", compartidas por TODAS las
    // alertas de esta persona (toque de cabeza, caída, actividades): el verificador de
    // persona (COCO) y la evidencia real de cuerpo (cara o pierna, no solo hombros/cadera
    // que una mano sola puede "completar"). ---
    if (objectDetector && !objectDetectorFailed && cachedPersonBoxes
      && poseConfirmadaComoPersona(pose, cachedPersonBoxes, w, h)) {
      p.track.lastConfirmedPerson = now;
    }
    // Caso real encontrado: en una habitación vacía de verdad (nadie real ahí), el
    // verificador nunca confirma a nadie — eso es correcto, no un fallo del verificador.
    // Si además el modelo de pose "alucina" repetidamente sobre un mueble (un sillón, un
    // ventilador), antes la "válvula de escape" (desactivar la exigencia tras 20 s sin
    // confirmar a NADIE) dejaba pasar esa alucinación sin ningún control. Ahora esa
    // válvula de escape SOLO vale para un seguimiento que el verificador YA confirmó de
    // verdad alguna vez (una persona real que el verificador dejó de ver, ej. por poca
    // luz): nunca para uno nuevo que el verificador jamás confirmó.
    const hayVerificador = objectDetector && !objectDetectorFailed;
    const verificadorSinNadieHaceMucho = hayVerificador
      && !!objSinPersonaDesde && now - objSinPersonaDesde > FALL_VERIFIER_GIVEUP_MS;
    const personaVerificada = !hayVerificador
      || (now - (p.track.lastConfirmedPerson || 0)) <= FALL_CONFIRM_WINDOW_MS
      || (verificadorSinNadieHaceMucho && !!p.track.lastConfirmedPerson);
    if (evidenciaDeCuerpoReal(pose)) p.track.lastBodyEvidenceAt = now;
    const cuerpoRealConfirmado = (now - (p.track.lastBodyEvidenceAt || 0)) <= FALL_CONFIRM_WINDOW_MS;

    // Toque de cabeza: casilla que se puede apagar (activada por defecto, es la detección
    // original del proyecto). Si está apagada, directamente no se analiza nada de esto
    // (no solo "no se avisa"), para no gastar de más en el celular.
    let res;
    let touchState = 'idle';
    if (settings.alertCabeza) {
      // El brazo tiene que venir DE ABAJO: se sigue cuadro a cuadro si la mano estuvo
      // claramente baja hace poco (no que "aparezca" ya arriba de golpe). Sin eso, tocar
      // la cabeza no cuenta, aunque la mano esté ahí ahora mismo.
      if (manoAbajo(pose, handsByPose[p.index], w, h)) p.track.lastHandDownAt = now;
      const brazoVinoDeAbajo = (now - (p.track.lastHandDownAt || 0)) <= HAND_RISE_WINDOW_MS;

      // Además de la forma de la cabeza/cara (ya la valida evaluateFrame), tiene que
      // tratarse de una persona confirmada por el verificador, con evidencia real de
      // cuerpo (no una mano sola haciéndose pasar por alguien tocándose la cabeza), y con
      // el brazo habiendo subido de verdad desde abajo.
      const resCrudo = evaluateFrame(pose, handsByPose[p.index], w, h, { sensitivity: settings.sensitivity, includeFace: settings.includeFace });
      // `res.touching` es lo que se usa en todos lados (overlay, estado, alerta): ya
      // incluye estos gates, para no mostrar "CABEZA" en pantalla por algo que de todas
      // formas no iba a avisar.
      res = { ...resCrudo, touching: resCrudo.touching && personaVerificada && cuerpoRealConfirmado && brazoVinoDeAbajo };
      touchState = p.track.touch.update(res.touching, now);
    } else {
      res = { touching: false, zone: null, closest: null, via: null, side: null };
    }
    const watchAny = settings.watchZoneEnter || settings.watchZoneExit || settings.watchZoneInside || settings.watchZoneOutside;
    const act = p.track.act.update(pose, w, h, now, {
      bedZones: settings.bedZones,
      detectarBrazoArriba: settings.alertPideAyuda,
      watchZones: watchAny ? settings.watchZones : [],
      watchEnter: settings.watchZoneEnter, watchExit: settings.watchZoneExit,
      watchInsideMs: settings.watchZoneInside ? settings.watchDwellInS * UNIT_MS[settings.watchDwellInUnit] : null,
      watchOutsideMs: settings.watchZoneOutside ? settings.watchDwellOutS * UNIT_MS[settings.watchDwellOutUnit] : null,
    });
    // ¿Hubo un pico de velocidad alto hace poco (brusco, como una caída real) o todo fue
    // lento y controlado (como alguien que se acuesta a propósito)?
    const transicionBrusca = act.peakSpeedRecent >= FALL_SPEED_MIN;

    // Acostada en una zona marcada como cama no es una caída. Tampoco cuenta si esta
    // persona nunca estuvo parada o sentada antes, o si pasó a acostada de forma lenta y
    // controlada (como alguien acostándose a propósito, aunque esa cama no esté marcada
    // en pantalla): una caída real siempre tiene una postura normal previa Y es brusca.
    // Tampoco cuenta si el verificador de persona nunca la confirmó hace poco, o si nunca
    // se vio una cara/pierna creíble hace poco (típico de una mano sola, o un patrón
    // decorativo "completado" como cuerpo: un ventilador, un respaldo, etc.).
    const lying = settings.detectFalls && act.lyingNow && !act.inBed && act.huboPosturaNormalAntes
      && personaVerificada && transicionBrusca && cuerpoRealConfirmado;
    const fallState = settings.detectFalls ? p.track.fall.update(lying, now) : 'idle';
    // Todas las alertas de ESTA persona (toque, caída, y cada actividad: se sentó, se
    // levantó, caminó, zona, pidió ayuda) exigen lo mismo: primero confirmar que es una
    // persona de verdad (verificador + evidencia de cuerpo), y recién ahí avisar lo que
    // hizo. Sin esa confirmación reciente, no se informa ningún evento de actividad
    // (aunque la postura cruda haya cambiado), para no avisar de un objeto cualquiera.
    const personaConfirmadaAhora = personaVerificada && cuerpoRealConfirmado;
    // ESTABILIDAD: no alcanza con confirmarse en UN cuadro suelto — con la cámara en
    // movimiento (al mover el celular de un lado a otro), el modelo puede "alucinar" algo
    // así por una fracción de segundo (desenfoque de movimiento) y desaparece enseguida.
    // Se exige mantenerse confirmada un ratito (PERSON_STABLE_MS) antes de dibujarse en
    // pantalla o avisar nada — una persona real se mantiene mucho más que eso.
    if (personaConfirmadaAhora) { if (!p.track.estableDesde) p.track.estableDesde = now; } else { p.track.estableDesde = null; }
    const personaConfirmada = p.track.estableDesde !== null && (now - p.track.estableDesde) >= PERSON_STABLE_MS;
    const eventosConfirmados = personaConfirmada ? act.events : [];
    return { id: p.id, track: p.track, pose, hands: handsByPose[p.index], res, touchState, lying, fallState, box: poseBox(pose, w, h),
      personaConfirmada, posture: act.posture, walking: act.walking, inBed: act.lyingNow && act.inBed, events: eventosConfirmados,
      zoneEnterCount: act.zoneEnterCount, zoneExitCount: act.zoneExitCount, zoneLastSide: act.zoneLastSide, zoneElapsedS: Math.round(act.zoneElapsedMs / 1000) };
  }).filter((p) => p.personaConfirmada); // sin confirmación estable, ni se dibuja ni se avisa nada: es como si no estuviera

  drawAll(w, h, list);

  for (const person of list) {
    if (person.fallState === 'alert') onPersonAlert('fall', person, list.length, w, h, source);
    if (person.touchState === 'alert') onPersonAlert('touch', person, list.length, w, h, source);
    for (const ev of person.events) onActivity(ev, person, list.length, w, h, source);
  }

  const cuantas = list.length === 1 ? '1 persona' : `${list.length} personas`;
  const fallen = list.filter((p) => p.lying);
  const touching = list.filter((p) => p.res.touching);
  if (!list.length) {
    if (now - lastNoPerson > 1000) { setStatus('warn', 'Buscando personas…'); lastNoPerson = now; }
  } else if (fallen.length) {
    setStatus('alert', `${fallen.map((p) => `Persona ${p.id}`).join(', ')} en el suelo · ${cuantas}`);
  } else if (touching.length) {
    setStatus('alert', `${touching.map((p) => `Persona ${p.id}`).join(', ')}: mano en la cabeza · ${cuantas}`);
  } else {
    setStatus('ok', `Vigilando · ${cuantas}`);
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

// Colores para distinguir a cada persona en pantalla.
const PERSON_COLORS = ['#22d3ee', '#a78bfa', '#f472b6', '#4ade80', '#fb923c', '#facc15'];

function drawAll(w, h, list) {
  const c = els.overlay;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  octx.clearRect(0, 0, w, h);
  drawBedZones(w, h);
  drawWatchZone(w, h);
  for (const person of list) drawPerson(w, h, person);
  const fallen = list.find((p) => p.lying);
  const touching = list.find((p) => p.res.touching);
  const banner = fallen ? `🚨 Persona ${fallen.id} en el suelo` : touching ? `⚠️ Persona ${touching.id} se tocó la cabeza` : '';
  if (els.banner.textContent !== banner) els.banner.textContent = banner;
  els.banner.hidden = !banner;
}

function drawPerson(w, h, { id, pose, hands, res, lying, box, posture, walking, inBed }) {
  const lw = Math.max(2, w / 400);
  const alerting = res.touching || lying;
  const color = PERSON_COLORS[(id - 1) % PERSON_COLORS.length];

  // Etiqueta "Persona N" arriba de cada uno (más grande y en rojo si está alertando).
  if (box) {
    const estado = inBed ? 'en la cama' : walking ? 'caminando' : posture === 'sentada' ? 'sentada' : posture === 'parada' ? 'parada' : '';
    const label = lying ? `Persona ${id} · EN EL SUELO` : res.touching ? `Persona ${id} · CABEZA` : estado ? `Persona ${id} · ${estado}` : `Persona ${id}`;
    const fs = Math.max(14, Math.round(w / 45));
    octx.font = `bold ${fs}px system-ui, sans-serif`;
    const tw = octx.measureText(label).width + fs;
    const lx = Math.max(0, Math.min(w - tw, box.x));
    const ly = Math.max(0, box.y - fs * 1.6);
    octx.fillStyle = alerting ? 'rgba(220,38,38,.92)' : 'rgba(0,0,0,.65)';
    octx.fillRect(lx, ly, tw, fs * 1.5);
    octx.fillStyle = alerting ? '#fff' : color;
    octx.fillText(label, lx + fs / 2, ly + fs * 1.1);
    if (lying) {
      octx.strokeStyle = 'rgba(220,38,38,.95)';
      octx.lineWidth = lw * 2;
      octx.strokeRect(box.x, box.y, box.w, box.h);
    }
  }

  if (res.zone) {
    octx.beginPath();
    octx.arc(res.zone.center.x, res.zone.center.y, res.zone.radius, 0, Math.PI * 2);
    octx.lineWidth = lw * 1.5;
    octx.strokeStyle = res.touching ? 'rgba(220,38,38,.95)' : 'rgba(20,184,166,.9)';
    octx.fillStyle = res.touching ? 'rgba(220,38,38,.18)' : 'rgba(20,184,166,.08)';
    octx.fill();
    octx.stroke();
  }

  if (settings.drawSkeleton && pose) {
    const all = [...Array(33).keys()];
    drawLines(pose, BODY_CONNECTIONS, w, h, lying ? '#f87171' : 'rgba(255,255,255,.85)', lw * 1.5);
    drawLines(pose, ARM_CONNECTIONS, w, h, alerting ? '#f87171' : color, lw * 2.5);
    drawDots(pose, all, w, h, 'rgba(255,255,255,.95)', lw * 1.8);
    drawDots(pose, ARM_POINTS, w, h, alerting ? '#dc2626' : color, lw * 3);
    for (const hand of hands || []) {
      drawLines(hand, HAND_CONNECTIONS, w, h, '#38bdf8', lw * 1.5, Boolean);
      drawDots(hand, hand.map((_, i) => i), w, h, '#0ea5e9', lw * 1.6, Boolean);
    }
  }
}

// ---------------------------------------------------------------------------
// Alertas

/** Nombre de este equipo, para que en Telegram se sepa de dónde viene cada aviso. */
function deviceName() {
  if (!(settings.deviceName || '').trim()) { settings.deviceName = defaultDeviceName(); saveSettings(); if (els.deviceName) els.deviceName.value = settings.deviceName; }
  return settings.deviceName.trim();
}

/** Igual que deviceName(), pero nunca muestra la palabra secreta del administrador
 *  (para que no se filtre en Telegram ni en los enlaces de video en vivo). */
function nombreVisible() {
  const n = deviceName();
  return n.toLowerCase() === NOMBRE_ADMIN_SECRETO.toLowerCase() ? 'Administrador' : n;
}

// Nombre por defecto distinto en cada aparato (ej. "Equipo 4F2K"), para no confundir varios equipos sin nombre.
function defaultDeviceName() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => abc[b % abc.length]).join('');
  return `Equipo ${code}`;
}

/**
 * Foto de UNA persona: recorte alrededor de ella (con margen), con el esqueleto dibujado,
 * para que en Telegram se vea claro quién fue.
 */
function personPhoto(source, w, h, box) {
  const snap = document.createElement('canvas');
  let sx = 0; let sy = 0; let sw = w; let sh = h;
  if (box) {
    const m = 0.35;
    sx = Math.max(0, box.x - box.w * m);
    sy = Math.max(0, box.y - box.h * m - box.h * 0.15); // un poco más arriba: la cabeza y la etiqueta
    sw = Math.min(w - sx, box.w * (1 + 2 * m));
    sh = Math.min(h - sy, box.h * (1 + 2 * m) + box.h * 0.15);
    // que no quede un recorte diminuto si la persona está lejos
    const minW = w * 0.35;
    const minH = h * 0.35;
    if (sw < minW) { sx = Math.max(0, Math.min(w - minW, sx - (minW - sw) / 2)); sw = Math.min(w, minW); }
    if (sh < minH) { sy = Math.max(0, Math.min(h - minH, sy - (minH - sh) / 2)); sh = Math.min(h, minH); }
  }
  const scale = Math.min(2, 960 / Math.max(sw, sh));
  snap.width = Math.round(sw * scale);
  snap.height = Math.round(sh * scale);
  const c = snap.getContext('2d');
  c.drawImage(source, sx, sy, sw, sh, 0, 0, snap.width, snap.height);
  c.drawImage(els.overlay, sx, sy, sw, sh, 0, 0, snap.width, snap.height);
  return snap.toDataURL('image/jpeg', 0.85);
}

// ---------------------------------------------------------------------------
// Actividades opcionales: se sentó, se levantó, cama, caminar, quieta.
// Siempre quedan en "Eventos"; a Telegram solo si está marcada su casilla.

const ACTIVITY_KEYS = ['alertSento', 'alertLevanto', 'alertCamaEntra', 'alertCamaSale', 'alertCamina', 'alertQuieta', 'alertPideAyuda'];
const ACTIVITIES = {
  sento: { key: 'alertSento', icon: '🪑', text: (q) => `${q} se sentó (silla o sillón)` },
  levanto: { key: 'alertLevanto', icon: '🧍', text: (q) => `${q} se levantó de la silla o sillón` },
  cama_entra: { key: 'alertCamaEntra', icon: '🛏️', text: (q) => `${q} se acostó en la cama` },
  cama_sale: { key: 'alertCamaSale', icon: '🛏️', text: (q) => `${q} se levantó de la cama` },
  camina: { key: 'alertCamina', icon: '🚶', text: (q) => `${q} empezó a caminar` },
  quieta: { key: 'alertQuieta', icon: '⏸️', text: (q) => `${q} dejó de caminar y se quedó quieta` },
  pide_ayuda: { key: 'alertPideAyuda', icon: '🙋', text: (q) => `${q} levantó el brazo (puede estar pidiendo algo)` },
  zona_entra: { key: 'watchZoneEnter', icon: '📍', text: (q, p) => `${q} entró a la zona marcada (por ${p.zoneLastSide || '?'}) · entradas: ${settings.watchEnterCount}` },
  zona_sale: { key: 'watchZoneExit', icon: '📍', text: (q, p) => `${q} salió de la zona marcada (por ${p.zoneLastSide || '?'}) · salidas: ${settings.watchExitCount}` },
  zona_tiempo_dentro: { key: 'watchZoneInside', icon: '⏱️', text: (q, p) => `${q} lleva ${p.zoneElapsedS} s adentro de la zona marcada (configurado: ${settings.watchDwellInS} ${UNIT_LABEL[settings.watchDwellInUnit]})` },
  zona_tiempo_fuera: { key: 'watchZoneOutside', icon: '⏱️', text: (q, p) => `${q} lleva ${p.zoneElapsedS} s afuera de la zona marcada (configurado: ${settings.watchDwellOutS} ${UNIT_LABEL[settings.watchDwellOutUnit]})` },
};

async function onActivity(ev, person, total, w, h, source) {
  const a = ACTIVITIES[ev];
  if (!a) return;
  // El contador de entradas/salidas cuenta TODO cruce real (lo que ya decidió el
  // seguimiento de la persona), sin importar si este aviso puntual se termina mandando
  // a Telegram o no: por eso se suma acá arriba, antes de la espera entre alertas.
  if (ev === 'zona_entra') { settings.watchEnterCount++; saveSettings(); }
  if (ev === 'zona_sale') { settings.watchExitCount++; saveSettings(); }
  // No repetir el mismo aviso de la misma persona antes de la espera que el usuario
  // configuró ("Espera entre alertas"): la misma que se usa para el resto de las alertas,
  // así el usuario maneja un solo control para todas.
  const now = Date.now();
  person.track.lastEv ??= {};
  const minGap = settings.cooldownS * 1000;
  if (now - (person.track.lastEv[ev] || 0) < minGap) return;
  person.track.lastEv[ev] = now;

  const quien = `Persona ${person.id}`;
  addLog(a.text(quien, person));
  if (!settings[a.key]) return; // el usuario no pidió este aviso por Telegram
  const cuantas = total === 1 ? '1 persona a la vista' : `${total} personas a la vista`;
  const text = `📍 ${nombreVisible()}\n${a.icon} ${a.text(quien, person)}\n👥 ${cuantas}\n🕒 ${new Date().toLocaleString()}`;
  // Primero el texto solo (liviano, llega rápido aunque la red del celular esté lenta),
  // y la foto aparte después: así el aviso no espera a que termine de subir la imagen.
  try {
    await sendAlert({ text });
    addLog('Aviso enviado por Telegram');
  } catch (e) {
    addLog(`No se pudo enviar a Telegram: ${e.message}`, 'alert');
    return;
  }
  if (settings.sendPhoto) {
    try {
      const image = personPhoto(source, w, h, person.box);
      sendAlert({ text: `📷 Foto de: ${a.text(quien, person)}`, imageDataUrl: image }).catch((e) => addLog(`No se pudo enviar la foto: ${e.message}`, 'alert'));
    } catch (e) { console.warn('No se pudo capturar la foto', e); }
  }
}

// --- Zonas de cama: se marcan arrastrando el dedo o el mouse sobre la imagen ---
let bedMarking = false;
let bedDraft = null;

/** Pasa un punto de la pantalla a coordenadas 0..1 de la imagen (la imagen está centrada, con bordes negros). */
function toImageCoords(ev) {
  const c = els.overlay;
  const r = c.getBoundingClientRect();
  if (!c.width || !c.height || !r.width) return null;
  const scale = Math.min(r.width / c.width, r.height / c.height);
  const ox = (r.width - c.width * scale) / 2;
  const oy = (r.height - c.height * scale) / 2;
  let x = (ev.clientX - r.left - ox) / (c.width * scale);
  const y = (ev.clientY - r.top - oy) / (c.height * scale);
  if (settings.mirror) x = 1 - x; // si la imagen se ve en espejo
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

// Radio (en fracción 0..1 del ancho de imagen) para "agarrar" un vértice existente con el dedo.
const VERTEX_GRAB_R = 0.035;
// Vértice que se está arrastrando ahora mismo (fuera del modo "marcar"): { zoneIndex, pointIndex }.
let bedDraggingVertex = null;

function refreshBedInfo() {
  const n = settings.bedZones.length;
  els.bedInfo.textContent = bedMarking
    ? `Toque cada esquina de la cama en orden (lleva ${bedDraft ? bedDraft.length : 0} punto${bedDraft && bedDraft.length === 1 ? '' : 's'}, mínimo 3) y después toque "Listo".`
    : n ? `${n} cama${n > 1 ? 's' : ''} marcada${n > 1 ? 's' : ''}. Acostada ahí = "en la cama" (no es caída). Para ajustar la forma, arrastre cualquier vértice (punto) sobre la imagen.` : 'No hay camas marcadas: si alguien se acuesta, se toma como caída.';
  els.bedClearBtn.disabled = !n;
  els.bedMarkBtn.textContent = bedMarking ? 'Cancelar' : '🛏️ Marcar una cama';
  if (els.bedDoneBtn) {
    els.bedDoneBtn.hidden = !bedMarking;
    els.bedDoneBtn.disabled = !bedDraft || bedDraft.length < 3;
  }
}

function setupBedZones() {
  if (!Array.isArray(settings.bedZones)) settings.bedZones = [];
  // Compatibilidad: una cama marcada antes de este cambio (rectángulo {x,y,w,h}) se
  // convierte a sus 4 vértices la primera vez que se abre esta pantalla, así también se
  // puede ajustar arrastrando sus puntos.
  settings.bedZones = settings.bedZones.map((z) => (Array.isArray(z.pts) ? z : { pts: zonePoints(z) }));
  const viewer = els.overlay.parentElement;
  const startMarking = () => {
    bedMarking = true;
    watchMarking = false;
    bedDraft = [];
    viewer.classList.toggle('marking', true);
    refreshBedInfo();
  };
  const stopMarking = () => {
    bedMarking = false;
    bedDraft = null;
    viewer.classList.remove('marking');
    refreshBedInfo();
  };
  els.bedMarkBtn.addEventListener('click', () => {
    if (!bedMarking && !running) { addLog('Primero toque Iniciar para ver la imagen y después marque la cama.', 'alert'); return; }
    if (bedMarking) stopMarking(); else startMarking();
  });
  els.bedDoneBtn?.addEventListener('click', () => {
    if (!bedMarking || !bedDraft || bedDraft.length < 3) return;
    settings.bedZones = [...settings.bedZones, { pts: bedDraft }].slice(-3);
    saveSettings();
    stopMarking();
    addLog('Cama marcada');
  });
  els.bedClearBtn.addEventListener('click', () => {
    if (!confirm('¿Borrar todas las camas marcadas?')) return;
    settings.bedZones = [];
    saveSettings();
    refreshBedInfo();
  });
  viewer.addEventListener('pointerdown', (ev) => {
    const p = toImageCoords(ev);
    if (!p) return;
    if (bedMarking) {
      // Modo "marcar una cama nueva": cada toque agrega un vértice más.
      ev.preventDefault();
      bedDraft.push(p);
      refreshBedInfo();
      return;
    }
    // Fuera de ese modo: si el toque cae cerca de un vértice de una cama YA marcada,
    // arrastrarlo para corregir la forma (sin tener que volver a dibujar toda la cama).
    for (let zi = 0; zi < settings.bedZones.length; zi++) {
      const pts = settings.bedZones[zi].pts;
      for (let pi = 0; pi < pts.length; pi++) {
        if (Math.hypot(pts[pi].x - p.x, pts[pi].y - p.y) <= VERTEX_GRAB_R) {
          ev.preventDefault();
          viewer.setPointerCapture?.(ev.pointerId);
          bedDraggingVertex = { zoneIndex: zi, pointIndex: pi };
          return;
        }
      }
    }
  });
  viewer.addEventListener('pointermove', (ev) => {
    const p = toImageCoords(ev);
    if (!p) return;
    if (bedDraggingVertex) {
      settings.bedZones[bedDraggingVertex.zoneIndex].pts[bedDraggingVertex.pointIndex] = p;
      return;
    }
  });
  const finishDrag = () => {
    if (bedDraggingVertex) { bedDraggingVertex = null; saveSettings(); }
  };
  viewer.addEventListener('pointerup', finishDrag);
  viewer.addEventListener('pointercancel', finishDrag);
  refreshBedInfo();
}

/** Dibuja un polígono cerrado (lista de {x,y} 0..1) con sus vértices como círculos
 * arrastrables, y la etiqueta "🛏️ CAMA" en su primer punto. */
function drawPoligono(w, h, pts, { color, fill, label, fs, vertexHandles }) {
  if (pts.length < 2) return;
  octx.beginPath();
  octx.moveTo(pts[0].x * w, pts[0].y * h);
  for (const pt of pts.slice(1)) octx.lineTo(pt.x * w, pt.y * h);
  if (pts.length >= 3) octx.closePath();
  if (fill) { octx.fillStyle = fill; octx.fill(); }
  octx.strokeStyle = color;
  octx.stroke();
  if (label) {
    octx.fillStyle = color;
    octx.fillText(label, pts[0].x * w + 6, pts[0].y * h + fs + 4);
  }
  if (vertexHandles) {
    octx.setLineDash([]);
    for (const pt of pts) {
      octx.beginPath();
      octx.arc(pt.x * w, pt.y * h, Math.max(6, w * 0.012), 0, Math.PI * 2);
      octx.fillStyle = color;
      octx.fill();
    }
    octx.setLineDash([12, 8]);
  }
}

function drawBedZones(w, h) {
  const zones = settings.bedZones;
  const fs = Math.max(13, Math.round(w / 55));
  octx.save();
  octx.setLineDash([12, 8]);
  octx.lineWidth = Math.max(2, w / 350);
  octx.font = `bold ${fs}px system-ui, sans-serif`;
  for (const z of zones) {
    drawPoligono(w, h, z.pts, {
      color: 'rgba(96,165,250,.95)', fill: 'rgba(96,165,250,.10)', label: '🛏️ CAMA', fs, vertexHandles: true,
    });
  }
  if (bedMarking && bedDraft) {
    drawPoligono(w, h, bedDraft, {
      color: 'rgba(250,204,21,.95)', fill: bedDraft.length >= 3 ? 'rgba(250,204,21,.12)' : null, label: null, fs, vertexHandles: true,
    });
  }
  octx.restore();
}

// --- Zona de interés: igual mecanismo que las camas, pero genérico (cualquier lugar). ---
let watchMarking = false;
let watchDraft = null;

/** "90 s" → "1 min 30 s"; abajo de los 60 s queda tal cual, para que se lea fácil. */
function formatElapsed(totalS) {
  if (totalS < 60) return `${totalS} s`;
  const h = Math.floor(totalS / 3600);
  const m = Math.floor((totalS % 3600) / 60);
  const s = totalS % 60;
  return (h ? `${h} h ` : '') + (m ? `${m} min ` : '') + `${s} s`;
}

function refreshWatchZoneInfo() {
  const n = (settings.watchZones || []).length;
  const anyEnabled = settings.watchZoneEnter || settings.watchZoneExit || settings.watchZoneInside || settings.watchZoneOutside;
  const contador = n ? ` · Entradas: ${settings.watchEnterCount} · Salidas: ${settings.watchExitCount}` : '';
  els.watchZoneInfo.textContent = (watchMarking
    ? 'Arrastre el dedo sobre la imagen, de una esquina de la zona a la otra.'
    : n ? 'Zona marcada.' : 'No hay ninguna zona marcada.') + contador;
  // Reloj en vivo: por cada persona que se está siguiendo, cuánto tiempo lleva en el
  // mismo lugar (adentro o afuera), para ver que el conteo "corre" sin esperar la alerta.
  if (els.watchZoneLive) {
    if (!n || !people.tracks.length) {
      els.watchZoneLive.textContent = '';
    } else {
      els.watchZoneLive.textContent = people.tracks
        .map((t) => {
          const a = t.act;
          const donde = a.zoneInsideNow ? 'adentro' : 'afuera';
          return `Persona ${t.id}: ${donde} hace ${formatElapsed(Math.round(a.zoneElapsedMs / 1000))}`;
        })
        .join(' · ');
    }
  }
  els.watchZoneClearBtn.disabled = !n;
  els.watchZoneMarkBtn.textContent = watchMarking ? 'Cancelar' : '📍 Marcar zona';
  els.watchZoneMarkBtn.disabled = !anyEnabled;
  els.watchZoneClearBtn.disabled = !anyEnabled || !n;
  if (els.watchZoneResetBtn) els.watchZoneResetBtn.disabled = !n;
}

function setupWatchZone() {
  if (!Array.isArray(settings.watchZones)) settings.watchZones = [];
  const viewer = els.overlay.parentElement;
  els.watchZoneMarkBtn.addEventListener('click', () => {
    if (!(settings.watchZoneEnter || settings.watchZoneExit || settings.watchZoneInside || settings.watchZoneOutside)) return;
    if (!watchMarking && !running) { addLog('Primero toque Iniciar para ver la imagen y después marque la zona.', 'alert'); return; }
    bedMarking = false; // no se puede marcar las dos cosas a la vez
    watchMarking = !watchMarking;
    watchDraft = null;
    viewer.classList.toggle('marking', watchMarking);
    refreshWatchZoneInfo();
  });
  els.watchZoneClearBtn.addEventListener('click', () => {
    if (!confirm('¿Borrar la zona marcada?')) return;
    settings.watchZones = [];
    saveSettings();
    refreshWatchZoneInfo();
  });
  els.watchZoneResetBtn?.addEventListener('click', () => {
    settings.watchEnterCount = 0;
    settings.watchExitCount = 0;
    saveSettings();
    people.resetZoneCounters();
    addLog('Contadores de entradas/salidas de zona reiniciados');
    refreshWatchZoneInfo();
  });
  viewer.addEventListener('pointerdown', (ev) => {
    if (!watchMarking) return;
    const p = toImageCoords(ev);
    if (!p) return;
    ev.preventDefault();
    viewer.setPointerCapture?.(ev.pointerId);
    watchDraft = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  });
  viewer.addEventListener('pointermove', (ev) => {
    if (!watchMarking || !watchDraft) return;
    const p = toImageCoords(ev);
    if (p) { watchDraft.x1 = p.x; watchDraft.y1 = p.y; }
  });
  const finish = () => {
    if (!watchMarking || !watchDraft) return;
    const z = { x: Math.min(watchDraft.x0, watchDraft.x1), y: Math.min(watchDraft.y0, watchDraft.y1), w: Math.abs(watchDraft.x1 - watchDraft.x0), h: Math.abs(watchDraft.y1 - watchDraft.y0) };
    watchDraft = null;
    if (z.w < 0.05 || z.h < 0.05) return; // muy chica: seguramente fue un toque sin querer
    settings.watchZones = [z]; // una sola zona a la vez, para que sea simple
    saveSettings();
    watchMarking = false;
    viewer.classList.remove('marking');
    addLog('Zona marcada');
    refreshWatchZoneInfo();
  };
  viewer.addEventListener('pointerup', finish);
  viewer.addEventListener('pointercancel', () => { watchDraft = null; });
  refreshWatchZoneInfo();
}

function drawWatchZone(w, h) {
  const zones = [...(settings.watchZones || [])];
  if (watchDraft) zones.push({ x: Math.min(watchDraft.x0, watchDraft.x1), y: Math.min(watchDraft.y0, watchDraft.y1), w: Math.abs(watchDraft.x1 - watchDraft.x0), h: Math.abs(watchDraft.y1 - watchDraft.y0), draft: true });
  if (!zones.length) return;
  const fs = Math.max(13, Math.round(w / 55));
  octx.save();
  octx.setLineDash([4, 6]);
  octx.lineWidth = Math.max(2, w / 350);
  octx.font = `bold ${fs}px system-ui, sans-serif`;
  for (const z of zones) {
    octx.strokeStyle = z.draft ? 'rgba(250,204,21,.95)' : 'rgba(167,139,250,.95)';
    octx.fillStyle = z.draft ? 'rgba(250,204,21,.12)' : 'rgba(167,139,250,.10)';
    octx.fillRect(z.x * w, z.y * h, z.w * w, z.h * h);
    octx.strokeRect(z.x * w, z.y * h, z.w * w, z.h * h);
    octx.fillStyle = z.draft ? '#facc15' : '#c4b5fd';
    octx.fillText('📍 ZONA', z.x * w + 6, z.y * h + fs + 4);
  }
  octx.restore();
}

async function onPersonAlert(kind, person, total, w, h, source) {
  const when = new Date();
  const lado = person.res.side ? ` (mano ${person.res.side})` : '';
  const quien = `Persona ${person.id}`;
  const cuantas = total === 1 ? '1 persona a la vista' : `${total} personas a la vista`;
  const que = kind === 'fall' ? `🚨 ${quien} está CAÍDA en el suelo` : `⚠️ ${quien} se tocó la cabeza${lado}`;
  const text = `📍 ${nombreVisible()}\n${que}\n👥 ${cuantas}\n🕒 ${when.toLocaleString()}`;
  addLog(kind === 'fall' ? `${quien} caída en el suelo` : `${quien} se tocó la cabeza${lado}`, 'alert');
  if (settings.beep) { beep(); if (kind === 'fall') setTimeout(beep, 600); }
  navigator.vibrate?.(kind === 'fall' ? [300, 150, 300] : 300);

  let image;
  if (settings.sendPhoto) {
    try { image = personPhoto(source, w, h, person.box); } catch (e) { console.warn('No se pudo capturar la foto', e); }
  }
  try {
    await sendAlert({ text, imageDataUrl: image });
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

// Si hay un servidor propio (server.js) detrás de la app, se usa ese (el token queda
// ahí, nunca en el navegador). Si no (por ejemplo la app instalada desde GitHub Pages,
// sin ningún servidor propio), se manda directo desde el dispositivo: ver telegram-direct.js.
let hasBackend = null;

async function detectBackend() {
  try {
    const r = await fetch('/api/status', { cache: 'no-store' });
    if (!r.ok) throw new Error();
    hasBackend = true;
    return await r.json();
  } catch {
    hasBackend = false;
    return null;
  }
}

async function refreshTelegramStatus() {
  const s = await detectBackend();
  els.directTelegramFields.hidden = hasBackend;
  if (hasBackend) {
    localModels = Boolean(s.localModels);
    els.tgStatus.textContent = s.telegram
      ? `Configurado: las alertas se envían a ${s.chats} chat(s).`
      : s.hasToken
        ? 'Falta TELEGRAM_CHAT_ID. Escríbele algo a tu bot y presiona "Buscar mi chat_id".'
        : 'Sin configurar. Completa TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID en el archivo .env del servidor.';
    return;
  }
  // Modo directo (sin servidor): mostrar/precargar los campos de token y chat_id.
  const direct = loadDirectConfig();
  els.directToken.value = direct.token;
  els.directChatIds.value = direct.chatIds.join(',');
  // Un chat_id de GRUPO siempre empieza con "-" (negativo); uno sin el "-" es tu chat
  // PRIVADO con el bot (vos mismo), nunca el de la familia. Avisar esto solo con abrir
  // la app, sin que haga falta volver a buscar nada, para los casos en que ya quedó
  // guardado mal de antes (por ejemplo, de una búsqueda vieja con un bug ya arreglado).
  const privados = direct.chatIds.filter((c) => !c.startsWith('-'));
  if (privados.length) {
    els.tgStatus.textContent = `⚠️ El chat_id ${privados.join(', ')} es TU CHAT PRIVADO con el bot, no el grupo de la familia (los de un grupo siempre empiezan con "-"). Borralo del campo de abajo y volvé a tocar "Buscar mi chat_id".`;
    return;
  }
  els.tgStatus.textContent = direct.token && direct.chatIds.length
    ? `Configurado en este dispositivo: las alertas se mandan directo a ${direct.chatIds.length} chat(s), sin servidor.`
    : 'No hay ningún servidor detrás de esta app: cargá el token del bot y el chat_id acá abajo para que las alertas salgan directo desde este dispositivo.';
}

els.saveDirectBtn.addEventListener('click', () => {
  saveDirectConfig({ token: els.directToken.value, chatIds: els.directChatIds.value });
  addLog('Datos de Telegram guardados en este dispositivo');
  refreshTelegramStatus();
});

async function sendAlert({ text, imageDataUrl }) {
  const acceso = accesoActual();
  if (!acceso.permitido) throw new Error(mensajeBloqueo(acceso.motivo));
  if (hasBackend) {
    const r = await fetch('/api/alert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, image: imageDataUrl }),
    });
    const data = await r.json();
    if (!data.ok) throw new Error(data.error);
    return data.sent;
  }
  return sendDirectAlert({ text, imageDataUrl });
}

els.testBtn.addEventListener('click', async () => {
  els.testBtn.disabled = true;
  try {
    await sendAlert({ text: `✅ Prueba de DETEC MOV\n📍 ${nombreVisible()}\n🕒 ${new Date().toLocaleString()}` });
    addLog('Prueba enviada a Telegram');
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
    const chats = hasBackend ? (await (await fetch('/api/telegram/chats')).json()).chats : await findDirectChats(els.directToken.value);
    els.chatList.textContent = chats.length
      ? chats.map((c) => `${c.id}  ${c.name || ''} (${c.type})`).join('\n') + (hasBackend
        ? '\n\nCopia el número en TELEGRAM_CHAT_ID del .env y reinicia el servidor.'
        : '\n\nCopiá el número en "Chat ID(s)" de acá arriba y tocá Guardar.')
      : 'No hay mensajes. Abre tu bot en Telegram, envíale "hola" y vuelve a intentar.';
  } catch (e) {
    els.chatList.textContent = `Error: ${e.message}`;
  }
});

// ---------------------------------------------------------------------------
// Iniciar / detener

els.startBtn.addEventListener('click', async (ev) => {
  const acceso = accesoActual();
  if (!acceso.permitido) {
    setStatus('alert', mensajeBloqueo(acceso.motivo));
    addLog(mensajeBloqueo(acceso.motivo), 'alert');
    return;
  }
  // La primera vez que alguien toca Iniciar, se pide el nombre del equipo (en modo automático no se pregunta).
  if (ev.isTrusted && !settings.deviceNameAsked) {
    const n = prompt('¿Cómo se llama este equipo? Así aparece en cada aviso de Telegram.\n(Por ejemplo: Equipo 1 · Dormitorio)', deviceName());
    if (n && n.trim()) settings.deviceName = n.trim().slice(0, 40);
    settings.deviceNameAsked = true;
    saveSettings();
    els.deviceName.value = deviceName();
  }
  els.startBtn.disabled = true;
  try {
    await loadModels();
    setStatus('warn', 'Abriendo cámara…');
    running = true;
    await startSource();
    els.placeholder.hidden = true;
    els.stopBtn.disabled = false;
    people.reset(); // numeración nueva (Persona 1, 2…) en cada inicio
    addLog(`Vigilancia iniciada · ${deviceName()}`);
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* opcional */ }
    startLiveShare();
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
  stopLiveShare();
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

if ($('appVersion')) $('appVersion').textContent = APP_VERSION;
bindSettings();
refreshTelegramStatus();
listDevices().catch(() => {});
setupInstallButton($('installBtn'), $('iosDialog'));
iniciarChequeoLicencia();
iniciarPanelAdmin();

// ---------------------------------------------------------------------------
// Compartir la aplicación (para instalarla en el celular de una familia nueva)

// Pantalla completa, para ubicar bien la cámara al colocar el celular.
els.pantallaCompletaBtn?.addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) await els.viewer.requestFullscreen();
    else await document.exitFullscreen();
  } catch (e) {
    addLog('No se pudo pasar a pantalla completa: ' + e.message, 'alert');
  }
});

(function iniciarCompartir() {
  const URL_APP = 'https://aleortizcorrea22-ops.github.io/detec-mov/';
  const btn = $('compartirBtn');
  const fondo = $('compartirFondo');
  if (!btn || !fondo) return;
  btn.addEventListener('click', () => {
    fondo.hidden = false;
    const caja = $('compartirQr');
    if (caja && !caja.dataset.listo && typeof qrcode !== 'undefined') {
      const q = qrcode(0, 'M');
      q.addData(URL_APP);
      q.make();
      caja.innerHTML = q.createSvgTag({ cellSize: 5, margin: 3 });
      caja.dataset.listo = '1';
    }
  });
  if (navigator.share) {
    $('compartirNativoBtn').hidden = false;
    $('compartirNativoBtn').addEventListener('click', () => {
      navigator.share({ title: 'DETEC MOV', text: 'Instalá esta aplicación para avisarte por Telegram.', url: URL_APP }).catch(() => {});
    });
  }
  $('compartirCopiarBtn').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(URL_APP); addLog('Enlace de la app copiado'); }
    catch { /* el navegador no permite copiar: el texto ya está visible para seleccionar a mano */ }
  });
})();

$('shutdownBtn').addEventListener('click', async () => {
  if (!confirm('¿Apagar DETEC MOV? Se va a detener la vigilancia, incluida la que corre en segundo plano. Para volver a usarla vas a tener que prender la PC de nuevo o abrir el acceso directo del escritorio.')) return;
  try {
    running = false;
    stopSource();
    await fetch('/api/shutdown', { method: 'POST' }).catch(() => {});
  } finally {
    setStatus('', 'Sistema apagado');
    addLog('Sistema apagado desde la app');
    document.body.innerHTML = '<main style="display:grid;place-items:center;min-height:100vh;padding:24px;text-align:center;font:16px system-ui;color:var(--muted)"><p>DETEC MOV está apagado.<br>Prendé la PC de nuevo o abrí el acceso directo del escritorio para volver a usarlo.</p></main>';
  }
});

// Reanudar solo, con la ÚLTIMA configuración guardada: si este equipo ya se usó antes
// (tocó Iniciar alguna vez), cada vez que se abre o se recarga la página (por ejemplo,
// tras la actualización automática de más abajo) se prende la cámara y arranca a vigilar
// sola, sin que nadie la toque — las opciones (cama marcada, zona, qué alertas están
// activas, etc.) ya quedaron guardadas en este celular de la vez anterior. Si alguien
// toca "Detener" a propósito, no se vuelve a prender sola hasta la próxima vez que abra
// la página (para poder apagarla de verdad cuando haga falta).
if (settings.deviceNameAsked) {
  let detenidoPorUsuario = false;
  els.stopBtn.addEventListener('click', (e) => { if (e.isTrusted) detenidoPorUsuario = true; });
  els.startBtn.addEventListener('click', (e) => { if (e.isTrusted) detenidoPorUsuario = false; });
  const autoStart = () => {
    if (detenidoPorUsuario || running || els.startBtn.disabled) return;
    els.startBtn.click();
  };
  setTimeout(autoStart, 1500);
  setInterval(autoStart, 15000); // reintenta solo si falló (ej. la cámara tardó en estar lista)
}

// Actualización automática: un celular de vigía puede quedar con la pantalla prendida
// DÍAS sin que nadie lo toque, y el navegador por sí solo a veces tarda mucho (o nunca)
// en darse cuenta de que hay una versión nueva, porque nunca vuelve a "navegar" a la
// página. Acá se le pide explícitamente cada pocos minutos ("¿hay una versión nueva?"),
// y apenas la hay, se recarga sola (unos segundos sin vigilar, mucho mejor que quedarse
// semanas con una versión vieja sin que nadie se entere). No hace falta tocar el celular.
if ('serviceWorker' in navigator) {
  // `updateViaCache: 'none'`: al chequear sw.js, ignorar cualquier caché HTTP intermedio
  // (del navegador, del proveedor de internet, etc.) y pedirlo siempre directo al
  // servidor. Sin esto, un chequeo podría "confirmar" una copia vieja en caché y pensar
  // que no hay nada nuevo, aunque sí lo haya.
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    reg.update().catch(() => {}); // chequeo inmediato, no esperar los primeros 5 minutos
    const UPDATE_CHECK_MS = 5 * 60 * 1000; // cada 5 minutos
    setInterval(() => reg.update().catch(() => {}), UPDATE_CHECK_MS);
    // También al volver a tener la app en pantalla (la vuelven a mirar, cambian de app y
    // vuelven) o al recuperar internet, por si se perdió alguna revisión periódica.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
    window.addEventListener('online', () => reg.update().catch(() => {}));
  }).catch((e) => console.warn('SW no registrado', e));

  // Red de seguridad extra, que NO depende de que este JavaScript siga vivo: una
  // recarga forzada de la página cada 20 minutos (el navegador la hace solo, nativa,
  // aunque el script se haya colgado o tirado un error). Cada recarga es una "navegación"
  // de verdad, que es el momento en que el navegador SIEMPRE revisa si el service worker
  // tiene una versión nueva — la forma más segura que existe de no quedar pegado en una
  // versión vieja para siempre en un celular que nadie va a tocar.
  if (settings.deviceNameAsked) {
    const meta = document.createElement('meta');
    meta.httpEquiv = 'refresh';
    meta.content = '1200';
    document.head.appendChild(meta);
  }

  let yaRecargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Se activó una versión nueva del service worker (sw.js sube VERSION en cada
    // publicación): recargar para que tome el código nuevo (app.js, rules.js, etc.) sin
    // depender de que alguien cierre y abra la app a mano.
    if (yaRecargando) return;
    yaRecargando = true;
    addLog('Hay una actualización nueva: reiniciando la app para aplicarla…');
    setTimeout(() => window.location.reload(), 1500);
  });
}

setInterval(refreshWatchZoneInfo, 1000); // reloj en vivo de la zona (entradas/salidas y tiempo adentro/afuera)
