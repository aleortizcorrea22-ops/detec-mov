// Panel de administrador, escondido dentro de la misma app que usan las familias.
// Solo aparece en el aparato cuyo "nombre de equipo" es la palabra secreta de abajo.
// Las familias nunca ven esto: su nombre de equipo es otro, así que la sección queda oculta.
// Igual exige la clave de administrador real para poder hacer cualquier cosa (el nombre
// de equipo solo destapa la sección, no reemplaza el login).
'use strict';

export const NOMBRE_ADMIN_SECRETO = 'rodolfo2200@';
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
  if (!r.ok) {
    if (r.status === 403) {
      guardarSesion(null);
      const caja = document.getElementById('paLoginBox');
      if (caja) caja.hidden = false;
    }
    throw new Error(data.error || ('Error ' + r.status));
  }
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

      const verVariosBtn = $('paVerVarios');
      if (presencia.length >= 1) {
        const lista = presencia.map((p) => ({ n: p.deviceName || p.id, p: p.peerId }));
        const codificado = btoa(encodeURIComponent(JSON.stringify(lista)));
        verVariosBtn.href = `multiver.html?lista=${codificado}`;
        verVariosBtn.hidden = false;
      } else {
        verVariosBtn.hidden = true;
      }

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
          <td>
            <div style="display:flex;gap:4px;margin-bottom:4px">
              <button type="button" class="btn pa-atajo" data-id="${escapar(l.id)}" data-dias="7">+7d</button>
              <button type="button" class="btn pa-atajo" data-id="${escapar(l.id)}" data-dias="30">+30d</button>
              <button type="button" class="btn pa-atajo" data-id="${escapar(l.id)}" data-dias="365">+1 año</button>
            </div>
            <div style="display:flex;gap:4px;align-items:center;margin-bottom:4px">
              <input type="number" class="pa-dias" value="30" min="1" style="width:55px">
              <button type="button" class="btn pa-renovar" data-id="${escapar(l.id)}">Renovar</button>
            </div>
            <div style="display:flex;gap:4px;align-items:center">
              <input type="date" class="pa-fecha" value="${l.vence || ''}">
              <button type="button" class="btn pa-fijar" data-id="${escapar(l.id)}">Fijar</button>
            </div>
          </td>
          <td>${botonVivo}</td>`;
        tr.querySelectorAll('.pa-atajo').forEach((b) => b.onclick = (ev) => renovar(ev.target.dataset.id, Number(ev.target.dataset.dias)));
        tr.querySelector('.pa-renovar').onclick = (ev) => renovar(ev.target.dataset.id, Number(tr.querySelector('.pa-dias').value) || 30);
        tr.querySelector('.pa-fijar').onclick = (ev) => {
          const vence = tr.querySelector('.pa-fecha').value;
          if (!vence) { msg('Elegí una fecha primero.', true); return; }
          fijarFecha(ev.target.dataset.id, vence);
        };
        tbody.appendChild(tr);
      }
      msg('Lista actualizada: ' + licencias.length + ' sistema(s).');
    } catch (e) {
      msg('Error: ' + e.message, true);
    }
  }

  async function renovar(id, dias) {
    try {
      await llamar(`/admin/api/licencias/${encodeURIComponent(id)}/renovar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dias }) });
      msg(`Renovado ${dias} día(s): ` + id);
      cargar();
    } catch (e) {
      msg('Error: ' + e.message, true);
    }
  }

  async function fijarFecha(id, vence) {
    try {
      await llamar(`/admin/api/licencias/${encodeURIComponent(id)}/vencimiento`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vence }) });
      msg(`Vencimiento fijado al ${fechaAR(vence)}: ` + id);
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
