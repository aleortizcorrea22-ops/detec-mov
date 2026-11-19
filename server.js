// Servidor mínimo de DETEC MOV.
// - Sirve la PWA (carpeta public/) y la librería MediaPipe desde node_modules.
// - /api/alert: envía la alerta (texto + foto) a Telegram. El token NUNCA llega al navegador.
// - /api/camera: proxy de cámaras IP de la red local (MJPEG o foto JPG) para que el
//   navegador pueda analizar los cuadros (evita problemas de CORS).
'use strict';

const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { spawn } = require('node:child_process');

loadEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const CHAT_IDS = (process.env.TELEGRAM_CHAT_ID || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const TELEGRAM_API = (process.env.TELEGRAM_API_URL || 'https://api.telegram.org').replace(/\/$/, '');
const ALLOW_PUBLIC_CAMERAS = process.env.ALLOW_PUBLIC_CAMERAS === '1';
// Si se expone la app por internet (por ejemplo con cloudflared) para ver la cámara desde
// afuera de la red, esta clave protege esa vista. Sin ella, cualquiera con el link vería la cámara.
const VIEW_PASSWORD = (process.env.VIEW_PASSWORD || '').trim();

const PUBLIC_DIR = path.join(__dirname, 'public');
const VENDOR_DIR = path.join(__dirname, 'node_modules', '@mediapipe', 'tasks-vision');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.task': 'application/octet-stream',
};

// ---------------------------------------------------------------------------
// Utilidades

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Cuerpo demasiado grande'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function serveFile(res, file, cache) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No encontrado');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': cache,
    });
    fs.createReadStream(file).pipe(res);
  });
}

function safeJoin(base, rel) {
  const p = path.normalize(path.join(base, rel));
  return p.startsWith(base + path.sep) || p === base ? p : null;
}

// Solo se permiten cámaras de la red local (evita usar el servidor como proxy abierto).
function isLanHost(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.lan') || !h.includes('.') && !h.includes(':')) return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
  }
  return h === '::1' || h.startsWith('fd') || h.startsWith('fe80');
}

// ---------------------------------------------------------------------------
// Telegram

async function telegram(method, body) {
  const r = await fetch(`${TELEGRAM_API}/bot${TOKEN}/${method}`, { method: 'POST', body });
  const data = await r.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || `Telegram respondió ${r.status}`);
  return data.result;
}

async function sendAlert({ text, imageDataUrl }) {
  if (!TOKEN || CHAT_IDS.length === 0) throw new Error('Telegram no está configurado (revisa TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID en .env)');
  let photo = null;
  if (typeof imageDataUrl === 'string') {
    const m = imageDataUrl.match(/^data:image\/(jpeg|png);base64,(.+)$/);
    if (m) photo = new Blob([Buffer.from(m[2], 'base64')], { type: `image/${m[1]}` });
  }
  const results = [];
  for (const chatId of CHAT_IDS) {
    const form = new FormData();
    form.append('chat_id', chatId);
    if (photo) {
      form.append('caption', text);
      form.append('photo', photo, 'alerta.jpg');
      results.push(await telegram('sendPhoto', form));
    } else {
      form.append('text', text);
      results.push(await telegram('sendMessage', form));
    }
  }
  return results.length;
}

// ---------------------------------------------------------------------------
// Vista en vivo: el navegador que está vigilando manda el cuadro actual (con el
// esqueleto dibujado) y cualquier otro equipo de la red local lo puede ver en
// /live.html. No usa la cámara directamente, así que no necesita HTTPS.

let liveFrame = null; // { buf: Buffer, at: number }

// ---------------------------------------------------------------------------
// Cámaras RTSP (cámaras de seguridad): se convierten a un stream MJPEG con ffmpeg
// para que el navegador pueda mostrarlas y analizarlas igual que una cámara HTTP.

const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';
const JPEG_SOI = Buffer.from([0xff, 0xd8]);
const JPEG_EOI = Buffer.from([0xff, 0xd9]);
const MJPEG_BOUNDARY = 'detecmovframe';

function streamRtspAsMjpeg(req, res, rtspUrl) {
  const args = ['-loglevel', 'error', '-rtsp_transport', 'tcp', '-i', rtspUrl, '-an', '-f', 'mjpeg', '-q:v', '6', '-r', '8', '-'];
  let proc;
  try {
    proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return sendJson(res, 500, { error: `No se pudo iniciar ffmpeg: ${e.message}. Instalá ffmpeg y agregalo al PATH (o configurá FFMPEG_PATH en .env).` });
  }

  let stderr = '';
  proc.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-2000); });
  proc.on('error', (e) => {
    const hint = e.code === 'ENOENT' ? 'ffmpeg no está instalado o no está en el PATH.' : e.message;
    if (!res.headersSent) sendJson(res, 500, { error: `No se pudo iniciar ffmpeg: ${hint}` });
    else res.end();
  });

  let started = false;
  let buf = Buffer.alloc(0);
  proc.stdout.on('data', (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      const start = buf.indexOf(JPEG_SOI);
      if (start === -1) { buf = Buffer.alloc(0); break; }
      const end = buf.indexOf(JPEG_EOI, start + 2);
      if (end === -1) { if (start > 0) buf = buf.slice(start); break; }
      const frame = buf.subarray(start, end + 2);
      buf = buf.subarray(end + 2);
      if (!started) {
        started = true;
        res.writeHead(200, { 'Content-Type': `multipart/x-mixed-replace; boundary=${MJPEG_BOUNDARY}`, 'Cache-Control': 'no-store' });
      }
      res.write(`--${MJPEG_BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
      res.write(frame);
      res.write('\r\n');
    }
  });

  proc.on('exit', (code) => {
    if (!started && !res.headersSent) {
      const msg = stderr.split('\n').filter(Boolean).pop() || `ffmpeg terminó con código ${code}`;
      sendJson(res, 502, { error: `No se pudo leer la cámara RTSP: ${msg}` });
    } else if (!res.writableEnded) {
      res.end();
    }
  });

  req.on('close', () => { if (!proc.killed) proc.kill('SIGKILL'); });
}

// ---------------------------------------------------------------------------
// Proxy de cámara IP

async function proxyCamera(req, res, url) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return sendJson(res, 400, { error: 'URL de cámara inválida' });
  }
  if (!ALLOW_PUBLIC_CAMERAS && !isLanHost(target.hostname)) {
    return sendJson(res, 403, { error: 'Solo se permiten cámaras de la red local (ALLOW_PUBLIC_CAMERAS=1 para desactivar)' });
  }
  if (target.protocol === 'rtsp:') return streamRtspAsMjpeg(req, res, target.href);
  if (!/^https?:$/.test(target.protocol)) return sendJson(res, 400, { error: 'URL de cámara no soportada. Usá http(s) o rtsp.' });
  const headers = {};
  if (target.username || target.password) {
    headers.Authorization = 'Basic ' + Buffer.from(`${decodeURIComponent(target.username)}:${decodeURIComponent(target.password)}`).toString('base64');
    target.username = '';
    target.password = '';
  }
  const ac = new AbortController();
  req.on('close', () => ac.abort());
  try {
    const upstream = await fetch(target, { headers, signal: ac.signal });
    if (!upstream.ok || !upstream.body) return sendJson(res, 502, { error: `La cámara respondió ${upstream.status}` });
    res.writeHead(200, {
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    Readable.fromWeb(upstream.body).on('error', () => res.end()).pipe(res);
  } catch (e) {
    if (!res.headersSent) sendJson(res, 502, { error: `No se pudo conectar a la cámara: ${e.message}` });
    else res.end();
  }
}

// ---------------------------------------------------------------------------
// Rutas

// true solo para conexiones que llegan directo desde esta misma PC (no a través
// de un túnel público ni de otro equipo de la red). Se usa para lo más sensible:
// apagar el sistema y mandar cuadros a la vista en vivo.
function isLocalRequest(req) {
  const addr = (req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return (addr === '127.0.0.1' || addr === '::1') && !req.headers['x-forwarded-for'] && !req.headers['cf-connecting-ip'];
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/api/status' && req.method === 'GET') {
    const localModels = fs.existsSync(path.join(PUBLIC_DIR, 'models', 'pose_landmarker_full.task'));
    return sendJson(res, 200, { telegram: Boolean(TOKEN && CHAT_IDS.length), chats: CHAT_IDS.length, hasToken: Boolean(TOKEN), localModels });
  }

  // Apaga el servidor (y, con él, la vigilancia en segundo plano). Vuelve a arrancar
  // recién la próxima vez que se prenda la PC, o abriendo el acceso directo a mano.
  if (p === '/api/shutdown' && req.method === 'POST') {
    if (!isLocalRequest(req)) return sendJson(res, 403, { error: 'Solo se puede apagar desde esta misma PC.' });
    console.log('[sistema] apagado pedido desde la app');
    sendJson(res, 200, { ok: true });
    setTimeout(() => process.exit(0), 300);
    return;
  }

  // Recibe el cuadro actual (con el esqueleto dibujado) de quien está vigilando.
  if (p === '/api/live' && req.method === 'POST') {
    if (!isLocalRequest(req)) return sendJson(res, 403, { error: 'No permitido.' });
    const buf = await readBody(req, 4 * 1024 * 1024);
    if (buf.length) liveFrame = { buf, at: Date.now() };
    res.writeHead(204);
    return res.end();
  }

  // Lo que ve cualquier otro equipo de la red en /live.html.
  if (p === '/api/live.jpg' && req.method === 'GET') {
    if (!isLocalRequest(req) && VIEW_PASSWORD && url.searchParams.get('key') !== VIEW_PASSWORD) {
      return sendJson(res, 401, { error: 'Clave incorrecta o faltante (agregá ?key=... a la URL).' });
    }
    if (!liveFrame || Date.now() - liveFrame.at > 15000) return sendJson(res, 404, { error: 'No hay vista en vivo activa ahora mismo.' });
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store', 'Content-Length': liveFrame.buf.length });
    return res.end(liveFrame.buf);
  }

  // Estos dos solo los necesita el propio navegador que está vigilando, en esta misma PC.
  // Si la app se expone por un túnel público, no deben quedar accesibles desde afuera.
  if ((p === '/api/alert' || p === '/api/camera' || p === '/api/telegram/chats') && !isLocalRequest(req)) {
    return sendJson(res, 403, { error: 'No disponible desde afuera de esta PC.' });
  }

  if (p === '/api/alert' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
      const text = String(body.text || '⚠️ Se tocó la cabeza').slice(0, 1000);
      const sent = await sendAlert({ text, imageDataUrl: body.image });
      console.log(`[alerta] enviada a ${sent} chat(s): ${text.split('\n')[0]}`);
      return sendJson(res, 200, { ok: true, sent });
    } catch (e) {
      console.warn('[alerta] error:', e.message);
      return sendJson(res, 500, { ok: false, error: e.message });
    }
  }

  // Ayuda para encontrar el chat_id: escribe algo al bot y llama a este endpoint.
  if (p === '/api/telegram/chats' && req.method === 'GET') {
    if (!TOKEN) return sendJson(res, 400, { error: 'Falta TELEGRAM_BOT_TOKEN en .env' });
    try {
      const updates = await telegram('getUpdates', new URLSearchParams({ limit: '50' }));
      const chats = new Map();
      for (const u of updates) {
        const chat = (u.message || u.channel_post || u.my_chat_member || {}).chat;
        if (chat) chats.set(chat.id, { id: chat.id, type: chat.type, name: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username });
      }
      return sendJson(res, 200, { chats: [...chats.values()] });
    } catch (e) {
      return sendJson(res, 500, { error: e.message });
    }
  }

  if (p === '/api/camera' && req.method === 'GET') {
    return proxyCamera(req, res, url.searchParams.get('url') || '');
  }

  if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'No existe' });

  if (p.startsWith('/vendor/mediapipe/')) {
    const file = safeJoin(VENDOR_DIR, p.slice('/vendor/mediapipe/'.length));
    return file ? serveFile(res, file, 'public, max-age=604800') : sendJson(res, 400, {});
  }

  const file = safeJoin(PUBLIC_DIR, p === '/' ? 'index.html' : decodeURIComponent(p.slice(1)));
  if (!file) return sendJson(res, 400, {});
  return serveFile(res, file, 'no-cache');
}

const handler = (req, res) => handle(req, res).catch((e) => {
  console.error(e);
  if (!res.headersSent) sendJson(res, 500, { error: 'Error interno' });
});

// HTTPS opcional (necesario para usar la cámara del celular sin un túnel).
const certFile = process.env.HTTPS_CERT;
const keyFile = process.env.HTTPS_KEY;
const server = certFile && keyFile
  ? https.createServer({ cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) }, handler)
  : http.createServer(handler);

server.listen(PORT, () => {
  const proto = certFile && keyFile ? 'https' : 'http';
  console.log(`DETEC MOV listo en ${proto}://localhost:${PORT}`);
  console.log(TOKEN && CHAT_IDS.length
    ? `Telegram configurado (${CHAT_IDS.length} chat/s).`
    : 'Telegram SIN configurar: copia .env.example a .env y completa los datos.');
});
