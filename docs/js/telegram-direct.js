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
  if (!data.ok) {
    const err = new Error(data.description || `Telegram respondió ${r.status}`);
    // Cuando un grupo se convierte en supergrupo, Telegram le cambia el chat_id y avisa
    // el nuevo acá (migrate_to_chat_id); si no, cualquier mensaje a ese grupo falla para
    // siempre con este mismo error.
    if (data.parameters && data.parameters.migrate_to_chat_id) err.migrateToChatId = String(data.parameters.migrate_to_chat_id);
    throw err;
  }
  return data.result;
}

// Mismo servicio de licencias que usa licencia.js (no se importa de ahí para no armar
// una dependencia circular entre los dos módulos); si en licencia.js se guarda otra URL
// con saveLicenciaConfig(), esto la respeta leyendo la misma clave.
const LICENCIA_CONFIG_KEY = 'detecmov.licencia.config';
const LICENCIAS_BASE_URL_POR_DEFECTO = 'https://detecmov.axivenvirtual.com';

function licenciasBaseUrl() {
  try {
    const c = JSON.parse(localStorage.getItem(LICENCIA_CONFIG_KEY) || '{}');
    return String(c.baseUrl || LICENCIAS_BASE_URL_POR_DEFECTO).trim().replace(/\/$/, '');
  } catch {
    return LICENCIAS_BASE_URL_POR_DEFECTO;
  }
}

/** Avisa sola al servicio de licencias que este sistema cambió de id, para que la
 *  licencia se mueva sin que el administrador tenga que hacer nada a mano. Best-effort:
 *  si no se pudo avisar ahora, el chat_id local ya quedó corregido y se puede reintentar
 *  después (por ejemplo la próxima vez que se mande una alerta y vuelva a entrar aquí). */
async function avisarMigracionAlServidor(idViejo, idNuevo) {
  try {
    await fetch(`${licenciasBaseUrl()}/api/migrar-id/${encodeURIComponent(idViejo)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idNuevo }),
    });
  } catch { /* sin conexión con el servicio de licencias ahora; no es grave, se reintenta solo */ }
}

/** Si un chat_id guardado migró a supergrupo, lo reemplaza por el nuevo, lo guarda, y
 *  avisa sola al servicio de licencias para que mueva la licencia de ese sistema. */
function reemplazarChatIdMigrado(chatIdViejo, chatIdNuevo) {
  const cfg = loadDirectConfig();
  const chatIds = cfg.chatIds.map((c) => (c === chatIdViejo ? chatIdNuevo : c));
  saveDirectConfig({ token: cfg.token, chatIds: chatIds.join(',') });
  avisarMigracionAlServidor(chatIdViejo, chatIdNuevo);
  return chatIds;
}

function photoFromDataUrl(imageDataUrl) {
  const m = typeof imageDataUrl === 'string' && imageDataUrl.match(/^data:image\/(jpeg|png);base64,(.+)$/);
  if (!m) return null;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: `image/${m[1]}` });
}

/** Manda el mensaje (con foto si se pasa) a un chat puntual, con un solo reintento si
 *  Telegram avisa que ese grupo migró a supergrupo (usando el chat_id nuevo). */
async function enviarA(token, chatId, text, photo) {
  const form = new FormData();
  form.append('chat_id', chatId);
  if (photo) { form.append('caption', text); form.append('photo', photo, 'alerta.jpg'); }
  else form.append('text', text);
  try {
    await call(token, photo ? 'sendPhoto' : 'sendMessage', form);
    return chatId;
  } catch (e) {
    if (!e.migrateToChatId) throw e;
    reemplazarChatIdMigrado(chatId, e.migrateToChatId);
    const form2 = new FormData();
    form2.append('chat_id', e.migrateToChatId);
    if (photo) { form2.append('caption', text); form2.append('photo', photo, 'alerta.jpg'); }
    else form2.append('text', text);
    await call(token, photo ? 'sendPhoto' : 'sendMessage', form2);
    return e.migrateToChatId;
  }
}

/** Manda el mensaje (con foto si se pasa) a cada chat configurado. Devuelve cuántos recibieron. */
export async function sendDirectAlert({ text, imageDataUrl }) {
  const { token, chatIds } = loadDirectConfig();
  if (!token || !chatIds.length) throw new Error('Falta configurar el token del bot y el chat_id en este dispositivo');
  const photo = photoFromDataUrl(imageDataUrl);
  let sent = 0;
  for (const chatId of chatIds) {
    await enviarA(token, chatId, text, photo);
    sent++;
  }
  return sent;
}

/** Busca los chats que le escribieron algo al bot, para ayudar a encontrar el chat_id.
 * Usa el token que se le pase (por ejemplo el que está escrito en el campo, aunque
 * todavía no se haya guardado) y si no se pasa ninguno, el que ya está guardado. */
export async function findDirectChats(token) {
  token = String(token || '').trim() || loadDirectConfig().token;
  if (!token) throw new Error('Cargá primero el token del bot');
  const updates = await call(token, 'getUpdates', new URLSearchParams({ limit: '50' }));
  const chats = new Map();
  for (const u of updates) {
    const chat = (u.message || u.channel_post || u.my_chat_member || u.edited_message || {}).chat;
    // El chat privado con el bot (vos mismo escribiéndole) nunca es el chat_id de un
    // sistema: eso manda el aviso solo a tu chat privado, no al grupo de la familia.
    if (chat && chat.type !== 'private') chats.set(chat.id, { id: chat.id, type: chat.type, name: chat.title || chat.username });
    const migrado = u.message?.migrate_to_chat_id;
    if (migrado && chat) { chats.delete(chat.id); chats.set(migrado, { id: migrado, type: 'supergroup', name: chat.title || chat.username }); }
  }
  return [...chats.values()];
}
