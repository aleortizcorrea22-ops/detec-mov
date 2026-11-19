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

loadEnv(path.join(__dirname, '.env'));

const PORT = Number(process.env.PORT) || 3000;
const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const CHAT_IDS = (process.env.TELEGRAM_CHAT_ID || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const TELEGRAM_API = (process.env.TELEGRAM_API_URL || 'https://api.telegram.org').replace(/\/$/, '');
const ALLOW_PUBLIC_CAMERAS = process.env.ALLOW_PUBLIC_CAMERAS === '1';

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
// Proxy de cámara IP

async function proxyCamera(req, res, url) {
  let target;
  try {
    target = new URL(url);
  } catch {
    return sendJson(res, 400, { error: 'URL de cámara inválida' });
  }
  if (!/^https?:$/.test(target.protocol)) return sendJson(res, 400, { error: 'Solo se admiten URLs http(s). Para RTSP ver el README.' });
  if (!ALLOW_PUBLIC_CAMERAS && !isLanHost(target.hostname)) {
    return sendJson(res, 403, { error: 'Solo se permiten cámaras de la red local (ALLOW_PUBLIC_CAMERAS=1 para desactivar)' });
  }
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

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/api/status' && req.method === 'GET') {
    const localModels = fs.existsSync(path.join(PUBLIC_DIR, 'models', 'pose_landmarker_full.task'));
    return sendJson(res, 200, { telegram: Boolean(TOKEN && CHAT_IDS.length), chats: CHAT_IDS.length, hasToken: Boolean(TOKEN), localModels });
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
