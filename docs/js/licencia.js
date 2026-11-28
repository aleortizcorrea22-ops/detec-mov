// Chequeo de licencia del sistema (familia) contra el servicio de licencias que corre
// en la Raspberry del administrador. La detección sigue corriendo en este celular sin
// depender de la Raspberry para funcionar día a día, pero cada tanto este módulo le
// pregunta "¿sigo habilitado?" y actualiza una copia local de la respuesta.
//
// Si la Raspberry no contesta (sin internet, apagada, etc.) se sigue funcionando con la
// última respuesta conocida, pero solo hasta GRACIA_DIAS_SIN_CONTACTO días sin lograr
// contactarla; pasado ese plazo se bloquea por las dudas. Si la Raspberry sí contesta y
// dice "vencida", se bloquea de inmediato aunque haya internet y todo funcione bien.
//
// La misma lógica (evaluarAcceso) está probada con tests en licencias/licencia-cliente.test.mjs
// del lado del repositorio de administración; si se cambia una, cambiar la otra igual.
'use strict';

import { loadDirectConfig } from './telegram-direct.js';

const CONFIG_KEY = 'detecmov.licencia.config'; // { baseUrl, id } — id es opcional, por defecto el primer chat_id
const CACHE_KEY = 'detecmov.licencia.cache'; // { estado, vence, ultimoContactoOk }
const DIA_MS = 24 * 60 * 60 * 1000;
const GRACIA_DIAS_SIN_CONTACTO = 10;
const REVISAR_CADA_MS = 6 * 60 * 60 * 1000; // cada 6 horas mientras la app está abierta

// URL del servicio de licencias en la Raspberry del administrador.
// Se puede pisar guardando otra con saveLicenciaConfig({ baseUrl }) si hiciera falta.
const BASE_URL_POR_DEFECTO = 'https://detecmov.axivenvirtual.com';

function leerJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}

function guardarJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* sin almacenamiento disponible en este navegador */ }
}

export function loadLicenciaConfig() {
  const c = leerJson(CONFIG_KEY) || {};
  const baseUrl = String(c.baseUrl || BASE_URL_POR_DEFECTO).trim().replace(/\/$/, '');
  const idGuardado = String(c.id || '').trim();
  const idPorChatId = (loadDirectConfig().chatIds || [])[0] || '';
  return { baseUrl, id: idGuardado || idPorChatId };
}

export function saveLicenciaConfig({ baseUrl, id }) {
  guardarJson(CONFIG_KEY, { baseUrl: (baseUrl || '').trim().replace(/\/$/, ''), id: (id || '').trim() });
}

export function evaluarAcceso(cache, ahora = Date.now()) {
  if (!cache || !cache.estado) return { permitido: true, motivo: 'sin_datos' };
  if (cache.estado === 'vencida') return { permitido: false, motivo: 'vencida' };
  if (cache.estado === 'no_existe') return { permitido: false, motivo: 'no_existe' };
  const sinContactoDias = (ahora - (cache.ultimoContactoOk || 0)) / DIA_MS;
  if (sinContactoDias > GRACIA_DIAS_SIN_CONTACTO) return { permitido: false, motivo: 'sin_contacto_gracia_vencida' };
  return { permitido: true, motivo: 'activa' };
}

/** Estado actual según la última copia guardada (no hace red). */
export function accesoActual() {
  return evaluarAcceso(leerJson(CACHE_KEY));
}

export function mensajeBloqueo(motivo) {
  switch (motivo) {
    case 'vencida': return 'El servicio venció. Contactá al administrador para renovarlo.';
    case 'no_existe': return 'Este sistema no está dado de alta. Contactá al administrador.';
    case 'sin_contacto_gracia_vencida': return 'Hace más de 10 días que no se pudo confirmar la licencia. Conectá este aparato a internet.';
    default: return 'El sistema está bloqueado. Contactá al administrador.';
  }
}

/** Consulta al servidor de licencias y actualiza la copia local. No lanza error: si falla, deja la copia vieja. */
export async function revisarLicencia() {
  const { baseUrl, id } = loadLicenciaConfig();
  if (!baseUrl || !id) return accesoActual(); // no configurado todavía: no se bloquea
  try {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 8000);
    const r = await fetch(`${baseUrl}/api/licencia/${encodeURIComponent(id)}`, { signal: ac.signal });
    clearTimeout(to);
    const data = await r.json();
    guardarJson(CACHE_KEY, { estado: data.estado, vence: data.vence, ultimoContactoOk: Date.now() });
  } catch {
    // Sin conexión con la Raspberry: se deja la copia vieja, la gracia de 10 días la cubre.
  }
  return accesoActual();
}

function actualizarCartel() {
  const el = document.getElementById('licenciaBloqueo');
  if (!el) return; // por si este módulo se usa en una página sin el cartel (ver.html, manual.html)
  const acceso = accesoActual();
  el.hidden = acceso.permitido;
  if (!acceso.permitido) {
    const { id } = loadLicenciaConfig();
    // El id se muestra para poder diagnosticar por teléfono/chat sin entrar al código:
    // si no coincide con el que tiene el administrador, ese es el problema.
    document.getElementById('licenciaBloqueoTexto').textContent = `${mensajeBloqueo(acceso.motivo)} (id de este aparato: ${id || 'sin configurar'})`;
  }
}

/** Avisa al servidor de licencias "estoy transmitiendo en vivo, este es mi enlace ahora".
 *  Público pero acotado: solo sirve para ese id puntual, no deja ver nada que ya no se
 *  pudiera ver con el enlace de Telegram de siempre. Pensado para que el panel de
 *  administrador pueda listar "quién está en vivo ahora" sin buscar en cada grupo. */
export async function reportarPresenciaEnVivo(peerId, nombreEquipo) {
  const { baseUrl, id } = loadLicenciaConfig();
  if (!baseUrl || !id) return;
  try {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 8000);
    await fetch(`${baseUrl}/api/presencia/${encodeURIComponent(id)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ peerId, deviceName: nombreEquipo }),
      signal: ac.signal,
    });
    clearTimeout(to);
  } catch {
    // Sin conexión: no importa, se reintenta en el próximo latido.
  }
}

let intervalo = null;

/** Arranca el chequeo periódico y muestra/oculta el cartel de bloqueo. Llamar una vez al cargar la app. */
export function iniciarChequeoLicencia() {
  actualizarCartel();
  revisarLicencia().then(actualizarCartel);
  if (intervalo) clearInterval(intervalo);
  intervalo = setInterval(() => revisarLicencia().then(actualizarCartel), REVISAR_CADA_MS);
}
