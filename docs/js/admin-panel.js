// Panel de administrador, escondido dentro de la misma app que usan las familias.
// Solo aparece en el aparato cuyo "nombre de equipo" es la palabra secreta de abajo.
// Las familias nunca ven esto: su nombre de equipo es otro, así que la sección queda oculta.
// Igual exige la clave de administrador real para poder hacer cualquier cosa (el nombre
// de equipo solo destapa la sección, no reemplaza el login).
'use strict';

const NOMBRE_ADMIN_SECRETO = 'rodolfo2200@';
const BASE_URL = 'https://detecmov.axivenvirtual.com';
const SESION_KEY = 'detecmov.adminpanel.sesion';

function leerNombreEquipo() {
  try {
    const s = JSON.parse(localStorage.getItem('detecmov.settings') || '{}');
    return String(s.deviceName || '').trim().toLowerCase();
  } catch {
    return '';
  }
}

function esDispositivoAdmin() {
  return leerNombreEquipo() === NOMBRE_ADMIN_SECRETO;
}

function sesion() {
  try { return JSON.parse(localStorage.getItem(SESION_KEY) || 'null'); } catch { return null; }
}
function guardarSesion(s) { try { localStorage.setItem(SESION_KEY, JSON.stringify(s)); } catch {} }

function fechaAR(iso) {
  if (!iso) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}
function escapar(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function llamar(path, opts = {}) {
  const s = sesion();
  if (!s) throw new Error('Iniciá sesión primero');
  const r = await fetch(BASE_URL + path, { ...opts, headers: { ...(opts.headers || {}), 'X-Admin-Session': s.token } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ('Error ' + r.status));
  return data;
}

function claseEstado(l) {
  if (l.estado === 'vencida') return 'estado-vencida';
  if (l.estado === 'activa' && l.diasRestantes <= 3) return 'estado-por-vencer';
  return 'estado-activa';
}

export function iniciarPanelAdmin() {
  if (!esDispositivoAdmin()) return; // en cualquier otro celular, esta función no hace nada

  const sec = document.getElementById('panelAdmin');
  if (!sec) return;
  sec.hidden = false;

  const $ = (id) => document.getElementById(id);
  const msg = (t, error) => { const el = $('paMsg'); el.textContent = t; el.style.color = error ? '#b91c1c' : 'inherit'; };

  async function mostrarHint() {
    try {
      const r = await fetch(BASE_URL + '/admin/hint');
      const { hint } = await r.json();
      $('paHint').textContent = hint ? `(${hint})` : '';
    } catch {}
  }

  async function login() {
    const password = $('paClave').value;
    try {
      const r = await fetch(BASE_URL + '/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'No se pudo entrar');
      guardarSesion({ token: data.token, expiresAt: Date.now() + data.expiresInMs });
      $('paLoginBox').hidden = true;
      $('paClave').value = '';
      cargar();
    } catch (e) {
      msg('Error: ' + e.message, true);
      mostrarHint();
    }
  }

  async function cargar() {
    try {
      const [{ licencias }, { presencia }] = await Promise.all([
        llamar('/admin/api/licencias'),
        llamar('/admin/api/presencia').catch(() => ({ presencia: [] })),
      ]);
      const presenciaPorId = new Map(presencia.map((p) => [p.id, p]));
      const tbody = $('paTabla').querySelector('tbody');
      tbody.innerHTML = '';
      for (const l of licencias) {
        const viva = presenciaPorId.get(l.id);
        const botonVivo = viva
          ? `<a class="btn" target="_blank" rel="noopener" href="ver.html?n=${encodeURIComponent(viva.deviceName || l.nombre)}#${encodeURIComponent(viva.peerId)}">🔴 Ver en vivo</a>`
          : `<span class="muted" style="font-size:.8em">sin transmisión ahora</span>`;
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapar(l.nombre)}</td>
          <td class="${claseEstado(l)}">${l.estado}</td>
          <td>${fechaAR(l.vence)}</td>
          <td>${l.diasRestantes ?? ''}</td>
          <td><button type="button" class="btn pa-renovar" data-id="${escapar(l.id)}">+30 días</button></td>
          <td>${botonVivo}</td>`;
        tr.querySelector('.pa-renovar').onclick = (ev) => renovar(ev.target.dataset.id);
        tbody.appendChild(tr);
      }
      msg('Lista actualizada: ' + licencias.length + ' sistema(s).');
    } catch (e) {
      msg('Error: ' + e.message, true);
    }
  }

  async function renovar(id) {
    try {
      await llamar(`/admin/api/licencias/${encodeURIComponent(id)}/renovar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dias: 30 }) });
      msg('Renovado 30 días: ' + id);
      cargar();
    } catch (e) {
      msg('Error: ' + e.message, true);
    }
  }

  async function crear() {
    const id = $('paNId').value.trim();
    const nombre = $('paNNombre').value.trim();
    const dias = Number($('paNDias').value) || 30;
    try {
      await llamar('/admin/api/licencias', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, nombre, dias }) });
      msg('Creado: ' + id);
      $('paNId').value = ''; $('paNNombre').value = '';
      cargar();
    } catch (e) {
      msg('Error: ' + e.message, true);
    }
  }

  $('paEntrar').addEventListener('click', login);
  $('paClave').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') login(); });
  $('paClaveShowBtn').addEventListener('click', () => {
    const verlo = $('paClave').type === 'password';
    $('paClave').type = verlo ? 'text' : 'password';
    $('paClaveShowBtn').textContent = verlo ? 'Ocultar' : 'Ver';
  });
  $('paCrear').addEventListener('click', crear);

  const s = sesion();
  if (s && s.expiresAt > Date.now()) {
    $('paLoginBox').hidden = true;
    cargar();
  } else {
    mostrarHint();
  }
}
