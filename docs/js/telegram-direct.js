// Envía alertas a Telegram directo desde el navegador, sin pasar por ningún servidor propio.
// Se usa cuando la app corre sola (por ejemplo instalada desde GitHub Pages en un celular):
// la Bot API de Telegram acepta pedidos directos del navegador (CORS), así que no hace falta
// backend para esto, solo para evitar poner el token "a la vista" en el código fuente, cosa
// que acá no aplica porque el token lo carga la propia persona y queda solo en su aparato.
'use strict';

const STORAGE_KEY = 'detecmov.telegram.direct';

export function loadDirectConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const token = String(raw.token || '').trim();
    const chatIds = String(raw.chatIds || '').split(',').map((s) => s.trim()).filter(Boolean);
    return { token, chatIds };
  } catch {
    return { token: '', chatIds: [] };
  }
}

export function saveDirectConfig({ token, chatIds }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: token.trim(), chatIds: chatIds.trim() }));
  } catch { /* sin almacenamiento: no se puede guardar en este navegador */ }
}

async function call(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', body });
  const data = await r.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description || `Telegram respondió ${r.status}`);
  return data.result;
}

function photoFromDataUrl(imageDataUrl) {
  const m = typeof imageDataUrl === 'string' && imageDataUrl.match(/^data:image\/(jpeg|png);base64,(.+)$/);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: `image/${m[1]}` });
}

/** Manda el mensaje (con foto si se pasa) a cada chat configurado. Devuelve cuántos recibieron. */
export async function sendDirectAlert({ text, imageDataUrl }) {
  const { token, chatIds } = loadDirectConfig();
  if (!token || !chatIds.length) throw new Error('Falta configurar el token del bot y el chat_id en este dispositivo');
  const photo = photoFromDataUrl(imageDataUrl);
  let sent = 0;
  for (const chatId of chatIds) {
    const form = new FormData();
    form.append('chat_id', chatId);
    if (photo) {
      form.append('caption', text);
      form.append('photo', photo, 'alerta.jpg');
      await call(token, 'sendPhoto', form);
    } else {
      form.append('text', text);
      await call(token, 'sendMessage', form);
    }
    sent++;
  }
  return sent;
}

/** Busca los chats que le escribieron algo al bot, para ayudar a encontrar el chat_id. */
export async function findDirectChats() {
  const { token } = loadDirectConfig();
  if (!token) throw new Error('Cargá primero el token del bot');
  const updates = await call(token, 'getUpdates', new URLSearchParams({ limit: '50' }));
  const chats = new Map();
  for (const u of updates) {
    const chat = (u.message || u.channel_post || u.my_chat_member || {}).chat;
    if (chat) chats.set(chat.id, { id: chat.id, type: chat.type, name: chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username });
  }
  return [...chats.values()];
}
