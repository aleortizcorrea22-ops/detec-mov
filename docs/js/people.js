// Varias personas a la vez: numeración estable (Persona 1, 2…), a qué persona pertenece
// cada mano, detección de "persona caída en el suelo" y el recuadro de cada persona
// (para recortar la foto que se manda a Telegram).
// Funciones puras: se pueden probar sin navegador (ver test/people.test.mjs).

import { P, TouchTracker } from './rules.js';


const MIN_VIS = 0.55;
const vis = (lm) => lm && (lm.visibility === undefined || lm.visibility >= MIN_VIS);
const px = (lm, w, h) => ({ x: lm.x * w, y: lm.y * h });
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export const HIP = { L: 23, R: 24 };

/**
 * ¿Hay evidencia real de que esto es un CUERPO HUMANO (y no, por ejemplo, un mouse de PC
 * o una mano sola cerca de cámara con un par de puntos de cara "completados" por el
 * modelo)? Dos pruebas independientes, cualquiera alcanza:
 *  - Cara creíble: hace falta SIEMPRE la nariz (es el punto que, puesto al azar sobre un
 *    objeto cualquiera, rara vez cae en el lugar anatómico correcto) Y que esté bien
 *    ubicada respecto de los ojos o las orejas: por DEBAJO de los ojos (nunca al lado o
 *    arriba), o ENTRE las dos orejas en sentido horizontal. Dos ojos o dos orejas sueltos,
 *    sin una nariz en el medio en la posición correcta, ya no alcanzan por sí solos (un
 *    botón y una ruedita de un mouse pueden parecer "dos ojos" para el modelo, pero no le
 *    arma además una nariz debajo, en el lugar justo).
 *  - Pierna creíble: al menos una rodilla con confianza ALTA (0.70, no el mínimo general
 *    de 0.55 — es el punto que más se "inventa" con mantas o objetos de por medio).
 * Se usa para la caída (la alerta más grave): sin cara NI piernas, no se arriesga nada.
 */
export function evidenciaDeCuerpoReal(pose) {
  const nose = pose[P.NOSE];
  let caraCreible = false;
  if (vis(nose)) {
    const ojosVis = [pose[P.L_EYE], pose[P.R_EYE]].filter(vis);
    if (ojosVis.length) {
      const eyeYAvg = ojosVis.reduce((s, e) => s + e.y, 0) / ojosVis.length;
      if (nose.y > eyeYAvg) caraCreible = true; // la nariz va por debajo de los ojos
    } else if (vis(pose[P.L_EAR]) && vis(pose[P.R_EAR])) {
      const le = pose[P.L_EAR]; const re = pose[P.R_EAR];
      const minX = Math.min(le.x, re.x); const maxX = Math.max(le.x, re.x);
      const earYAvg = (le.y + re.y) / 2;
      // la nariz, entre las dos orejas (en x) y no mucho más lejos que ese ancho (en y).
      if (nose.x >= minX && nose.x <= maxX && Math.abs(nose.y - earYAvg) <= (maxX - minX)) caraCreible = true;
    }
    // (El chequeo de "boca debajo de la nariz" que hubo acá se sacó: en la práctica
    // rechazaba caras reales — los puntos de boca de MediaPipe no son lo bastante
    // precisos con cualquier ángulo/luz como para exigirles una posición exacta.)
  }
  const piernaCreible = [pose[25], pose[26]].some((k) => k && k.visibility !== undefined && k.visibility >= 0.7);
  return caraCreible || piernaCreible;
}

/** Recuadro (en píxeles) de los puntos visibles de una persona. */
export function poseBox(pose, w, h) {
  const pts = pose.filter(vis).map((l) => px(l, w, h));
  if (pts.length < 6) return null; // evita que una silla/sillón con pocos puntos débiles cuente como persona
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x1 = Math.max(0, Math.min(...xs));
  const y1 = Math.max(0, Math.min(...ys));
  const x2 = Math.min(w, Math.max(...xs));
  const y2 = Math.min(h, Math.max(...ys));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
}

/** Centro y tamaño de referencia de una persona (para seguirla de un cuadro al siguiente). */
export function poseAnchor(pose, w, h) {
  const ls = pose[P.L_SHOULDER];
  const rs = pose[P.R_SHOULDER];
  if (vis(ls) && vis(rs)) {
    const a = px(ls, w, h);
    const b = px(rs, w, h);
    return { ...mid(a, b), size: Math.max(dist(a, b), 1) };
  }
  const box = poseBox(pose, w, h);
  if (!box) return null;
  return { x: box.cx, y: box.cy, size: Math.max(box.w, box.h, 1) / 2 };
}

/**
 * A veces el modelo detecta a la MISMA persona dos veces (dos "poses" casi superpuestas,
 * típico cuando hay algo cerca que confunde al modelo, o con poca luz). Si dos poses
 * quedan muy cerca una de la otra (en relación a su tamaño), se descarta la que tiene
 * menos puntos visibles, y queda una sola persona real.
 */
export function filtrarPosesDuplicadas(poses, w, h, umbral = 0.5) {
  const anchors = poses.map((p) => poseAnchor(p, w, h));
  const descartar = new Set();
  for (let i = 0; i < poses.length; i++) {
    if (descartar.has(i) || !anchors[i]) continue;
    for (let j = i + 1; j < poses.length; j++) {
      if (descartar.has(j) || !anchors[j]) continue;
      const d = dist(anchors[i], anchors[j]) / Math.max(anchors[i].size, anchors[j].size, 1);
      if (d < umbral) {
        const visI = poses[i].filter(vis).length;
        const visJ = poses[j].filter(vis).length;
        descartar.add(visI >= visJ ? j : i);
      }
    }
  }
  return poses.filter((_, i) => !descartar.has(i));
}

/**
 * ¿La persona está acostada / caída en el suelo?
 * Usa el tronco (centro de hombros → centro de caderas): parado o sentado está casi vertical;
 * tirado en el suelo queda casi horizontal y la cabeza a la altura de la cadera.
 * @returns {{lying:boolean, angle:number|null, reason:string}}
 */
export function isLying(pose, w, h) {
  const ls = pose[P.L_SHOULDER];
  const rs = pose[P.R_SHOULDER];
  const lh = pose[HIP.L];
  const rh = pose[HIP.R];
  if (!(vis(ls) && vis(rs) && vis(lh) && vis(rh))) return { lying: false, angle: null, reason: 'no se ve el tronco' };
  // Evita que el modelo "alucine" un torso completo a partir de, por ejemplo, solo una
  // mano cerca de cámara: sin suficiente evidencia de cuerpo real, no hay caída posible.
  if (!poseBox(pose, w, h)) return { lying: false, angle: null, reason: 'sin evidencia de cuerpo' };

  // Una caída real deja ver el cuerpo entero (incluidas las piernas): exigir al menos
  // una rodilla visible descarta la mayoría de las "alucinaciones" de hombros+cadera a
  // partir de un objeto cualquiera cerca de cámara (mano, vaso, etc.), que casi nunca
  // vienen acompañadas de una rodilla creíble y bien ubicada.
  if (!vis(pose[KNEE.L]) && !vis(pose[KNEE.R])) return { lying: false, angle: null, reason: 'sin rodillas visibles' };

  const sh = mid(px(ls, w, h), px(rs, w, h));
  const hp = mid(px(lh, w, h), px(rh, w, h));
  const torso = dist(sh, hp);
  if (torso < 5) return { lying: false, angle: null, reason: 'muy chico' };
  // Proporción del cuerpo (torso vs. ancho de hombros): NO depende de si la persona
  // está cerca o lejos de la cámara (los dos miden más chico o más grande por igual),
  // así que sirve para distinguir una persona real de puntos sueltos adivinados (por
  // ejemplo, a partir de solo una mano cerca de cámara) sin penalizar a quien está lejos.
  // Rango ajustado a proporciones humanas reales (antes era demasiado permisivo).
  const shoulderW = dist(px(ls, w, h), px(rs, w, h));
  if (shoulderW > 0) {
    const ratio = torso / shoulderW;
    if (ratio < 0.6 || ratio > 2.8) return { lying: false, angle: null, reason: 'proporción de cuerpo inválida' };
  }
  // Coherencia hombros↔cadera: en un cuerpo real, la línea de los hombros y la línea de
  // la cadera son casi paralelas (el torso es rígido) — los hombros ya dicen bastante de
  // cómo está parada/acostada la persona antes de mirar nada más. Si estas dos líneas
  // quedan en ángulos muy distintos entre sí, es más probable que el modelo haya mezclado
  // partes de dos lugares distintos (dos personas, o un hombro con una cadera ajena) que
  // un cuerpo real.
  const anguloHombros = Math.atan2(px(rs, w, h).y - px(ls, w, h).y, px(rs, w, h).x - px(ls, w, h).x);
  const anguloCadera = Math.atan2(px(rh, w, h).y - px(lh, w, h).y, px(rh, w, h).x - px(lh, w, h).x);
  let difHombrosCadera = Math.abs(anguloHombros - anguloCadera) * 180 / Math.PI;
  if (difHombrosCadera > 180) difHombrosCadera = 360 - difHombrosCadera;
  if (difHombrosCadera > 45) return { lying: false, angle: null, reason: 'hombros y cadera no son coherentes entre sí' };
  // La rodilla visible tiene que estar a una distancia razonable de la cadera (continuar
  // el cuerpo), no en cualquier lado: si está pegada a la cadera o rarísimo de lejos,
  // tampoco es una pierna real.
  const kneeSrc = vis(pose[KNEE.L]) ? pose[KNEE.L] : pose[KNEE.R];
  const kneePt = px(kneeSrc, w, h);
  const hipKneeDist = dist(hp, kneePt);
  if (hipKneeDist < 0.3 * torso || hipKneeDist > 3 * torso) return { lying: false, angle: null, reason: 'rodilla en posición inválida' };
  // Objetos del fondo (mesita de luz, almohada, etc.) a veces se "completan" con puntos
  // sueltos que caen cerca de la cadera en distancia pero en un ángulo cualquiera: una
  // pierna real sigue aprox. la MISMA dirección general que el tronco (hombro→cadera),
  // no se dobla en cualquier sentido. Si el ángulo cadera→rodilla se aparta demasiado del
  // ángulo hombro→cadera, es más probable que sea un punto alucinado que una pierna.
  const torsoAngle = Math.atan2(hp.y - sh.y, hp.x - sh.x);
  const legAngle = Math.atan2(kneePt.y - hp.y, kneePt.x - hp.x);
  let angleDiff = Math.abs(torsoAngle - legAngle) * 180 / Math.PI;
  if (angleDiff > 180) angleDiff = 360 - angleDiff;
  if (angleDiff > 75) return { lying: false, angle: null, reason: 'pierna en ángulo inválido respecto del tronco' };
  // La rodilla usada tiene que tener confianza alta de verdad (no el mínimo general):
  // es el punto que más se "inventa" sobre objetos del fondo cuando hay mantas de por medio.
  if (kneeSrc.visibility !== undefined && kneeSrc.visibility < 0.7) {
    return { lying: false, angle: null, reason: 'rodilla con poca confianza' };
  }

  // 0° = tronco vertical, 90° = horizontal
  const angle = (Math.atan2(Math.abs(sh.x - hp.x), Math.abs(sh.y - hp.y)) * 180) / Math.PI;

  const headPts = [P.NOSE, P.L_EAR, P.R_EAR, P.L_EYE, P.R_EYE].map((i) => pose[i]).filter(vis).map((l) => px(l, w, h));
  const headY = headPts.length ? headPts.reduce((s, p) => s + p.y, 0) / headPts.length : sh.y;
  // Parado: la cabeza está bastante más arriba que la cadera. Caído: casi a la misma altura (o más abajo).
  const headNotAbove = headY > hp.y - 0.45 * torso;

  const box = poseBox(pose, w, h);
  const wide = box ? box.w > box.h * 1.3 : false;

  const lying = (angle >= 55 && headNotAbove) || (angle >= 40 && wide && headNotAbove);
  return { lying, angle: Math.round(angle), reason: lying ? 'tronco horizontal' : 'tronco vertical' };
}

/**
 * Reparte las manos del modelo de manos (21 puntos c/u) entre las personas:
 * cada mano va a la persona cuya muñeca (o cabeza) está más cerca.
 * @returns {Array<Array>} manos por índice de persona
 */
export function assignHands(poses, hands, w, h) {
  const out = poses.map(() => []);
  if (!poses.length) return out;
  const anchors = poses.map((p) => poseAnchor(p, w, h));
  for (const hand of hands || []) {
    if (!hand?.[0]) continue;
    const wrist = px(hand[0], w, h);
    let best = -1;
    let bestD = Infinity;
    poses.forEach((pose, i) => {
      const cands = [P.L_WRIST, P.R_WRIST, P.L_INDEX, P.R_INDEX].map((k) => pose[k]).filter(vis).map((l) => px(l, w, h));
      if (!cands.length) { const a = anchors[i]; if (a) cands.push(a); }
      for (const c of cands) { const d = dist(c, wrist); if (d < bestD) { bestD = d; best = i; } }
    });
    if (best < 0) continue;
    // Una mano real mide, de muñeca a punta de dedo mayor, bastante menos que el ancho de
    // hombros de esa persona. Un patrón repetido (botones de un respaldo tapizado, una
    // reja, etc.) a veces se lee como una "mano" varias veces más grande de lo que le
    // correspondería a esa persona: se descarta antes de que cuente para nada (ni toque
    // de cabeza ni ninguna otra regla).
    const anchor = anchors[best];
    if (anchor && hand[9]) {
      const tip = px(hand[9], w, h);
      const handSize = dist(wrist, tip);
      if (handSize > 1.3 * anchor.size) continue;
    }
    out[best].push(hand);
  }
  return out;
}

/**
 * Sigue a cada persona entre cuadros y le da un número estable (Persona 1, 2…).
 * Cada persona tiene su propio contador de "mano en la cabeza" y de "caída",
 * así una alerta de la Persona 2 no se mezcla con la Persona 1.
 */
export class PeopleTracker {
  constructor({ touch = {}, fall = {}, forgetMs = 4000, maxJump = 1.2 } = {}) {
    this.touchCfg = { holdMs: 600, cooldownMs: 30000, graceMs: 1500, ...touch };
    this.fallCfg = { holdMs: 2500, cooldownMs: 60000, graceMs: 2500, ...fall };
    this.forgetMs = forgetMs;
    this.maxJump = maxJump; // cuánto se puede mover entre cuadros, en "anchos de hombros"
    this.tracks = []; // { id, x, y, size, lastSeen, touch, fall }
  }

  configure({ touch, fall } = {}) {
    if (touch) Object.assign(this.touchCfg, touch);
    if (fall) Object.assign(this.fallCfg, fall);
    for (const t of this.tracks) {
      if (touch) Object.assign(t.touch, touch);
      if (fall) Object.assign(t.fall, fall);
    }
  }

  /** Pone en 0 los contadores de entradas/salidas de la zona de todas las personas que se están siguiendo ahora. */
  resetZoneCounters() {
    for (const t of this.tracks) t.act.resetZoneCounters();
  }

  /** @returns {Array<{id:number, index:number, track:object}>} una entrada por cada pose recibida */
  update(poses, w, h, now) {
    const anchors = poses.map((p) => poseAnchor(p, w, h));
    const pairs = [];
    anchors.forEach((a, i) => {
      if (!a) return;
      this.tracks.forEach((t, j) => {
        const d = dist(a, t) / Math.max(a.size, t.size);
        if (d <= this.maxJump) pairs.push({ i, j, d });
      });
    });
    pairs.sort((x, y) => x.d - y.d);
    const usedPose = new Set();
    const usedTrack = new Set();
    const result = [];
    for (const { i, j } of pairs) {
      if (usedPose.has(i) || usedTrack.has(j)) continue;
      usedPose.add(i); usedTrack.add(j);
      const t = this.tracks[j];
      Object.assign(t, { x: anchors[i].x, y: anchors[i].y, size: anchors[i].size, lastSeen: now });
      result.push({ id: t.id, index: i, track: t });
    }
    anchors.forEach((a, i) => {
      if (!a || usedPose.has(i)) return;
      const t = {
        id: this.freeId(), x: a.x, y: a.y, size: a.size, lastSeen: now, createdAt: now,
        touch: new TouchTracker(this.touchCfg), fall: new TouchTracker(this.fallCfg), act: new ActivityTracker(),
      };
      this.tracks.push(t);
      result.push({ id: t.id, index: i, track: t });
    });
    this.tracks = this.tracks.filter((t) => now - t.lastSeen <= this.forgetMs);
    return result.sort((a, b) => a.id - b.id);
  }

  freeId() {
    const used = new Set(this.tracks.map((t) => t.id));
    let id = 1;
    while (used.has(id)) id++;
    return id;
  }

  reset() { this.tracks = []; }
}

// ---------------------------------------------------------------------------
// Postura (parada / sentada / acostada) y actividades: se sentó, se levantó,
// se metió en la cama, salió de la cama, empezó a caminar, se quedó quieta.

const KNEE = { L: 25, R: 26 };
const ANKLE = { L: 27, R: 28 };

/**
 * Puntos (vértices) de una zona, en coordenadas 0..1.
 * Soporta el formato nuevo (polígono libre, `pts`: lista de {x,y}, 3 o más puntos —
 * la cama puede dibujarse con cualquier forma, no solo un rectángulo) y, para no perder
 * las camas ya marcadas antes de este cambio, el formato viejo (`{x,y,w,h}`, rectángulo),
 * que se convierte sobre la marcha a sus 4 vértices.
 */
export function zonePoints(zone) {
  if (Array.isArray(zone.pts) && zone.pts.length >= 3) return zone.pts;
  return [
    { x: zone.x, y: zone.y },
    { x: zone.x + zone.w, y: zone.y },
    { x: zone.x + zone.w, y: zone.y + zone.h },
    { x: zone.x, y: zone.y + zone.h },
  ];
}

/** ¿El punto (x,y) cae dentro del polígono (lista de {x,y}, mismas unidades)? */
function pointInPolygon(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x; const yi = poly[i].y;
    const xj = poly[j].x; const yj = poly[j].y;
    const cruza = (yi > pt.y) !== (yj > pt.y) && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (cruza) inside = !inside;
  }
  return inside;
}

/** ¿El punto (en píxeles) cae dentro de alguna zona marcada? Zonas en coordenadas 0..1,
 * cualquier forma (polígono) con 3 vértices o más. */
export function inZones(pt, zones, w, h) {
  return (zones || []).some((z) => pointInPolygon(pt, zonePoints(z).map((p) => ({ x: p.x * w, y: p.y * h }))));
}

/** Intersección sobre unión de dos cajas {x0,y0,x1,y1} (cualquier unidad, la misma en las dos). */
export function iouCajas(a, b) {
  const iw = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const ih = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (iw <= 0 || ih <= 0) return 0;
  const inter = iw * ih;
  const union = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - inter;
  return union > 0 ? inter / union : 0;
}

/** Caja {x0,y0,x1,y1} (0..1) → zona de 4 vértices, igual que una cama marcada a mano. */
export function zonaDeCaja(c) {
  return { pts: [{ x: c.x0, y: c.y0 }, { x: c.x1, y: c.y0 }, { x: c.x1, y: c.y1 }, { x: c.x0, y: c.y1 }] };
}

/** Centro de la parte de arriba del cuerpo (cara y hombros) en píxeles, o null si se ven
 * menos de 2 de esos puntos. Sirve para saber si alguien está en la cama sin depender de las
 * caderas, que de noche y tapado casi nunca se ven. */
export function centroSuperior(pose, w, h) {
  const pts = [P.NOSE, P.L_EYE, P.R_EYE, P.L_EAR, P.R_EAR, P.L_SHOULDER, P.R_SHOULDER]
    .map((i) => pose[i]).filter(vis).map((l) => px(l, w, h));
  if (pts.length < 2) return null;
  return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
}

/** ¿La parte de arriba de este cuerpo (cara y hombros) cae dentro de alguna cama marcada? */
export function enZonaCama(pose, w, h, zonas) {
  if (!zonas?.length) return false;
  const c = centroSuperior(pose, w, h);
  return !!c && inZones(c, zonas, w, h);
}

/** ¿Por qué lado del recuadro de la zona está más cerca el punto? (para decir "entró por la
 * derecha", etc.). pt y zone en las mismas unidades (0..1 de la imagen). */
export function ladoDeZona(pt, zone) {
  if (!zone) return null;
  const left = zone.x, right = zone.x + zone.w, top = zone.y, bottom = zone.y + zone.h;
  // Cuánto se pasa el punto de cada lado del recuadro (positivo = afuera de ese lado).
  // El lado con más "afuera" es por el que entró o salió.
  const d = { izquierda: left - pt.x, derecha: pt.x - right, arriba: top - pt.y, abajo: pt.y - bottom };
  return Object.entries(d).sort((a, b) => b[1] - a[1])[0][0];
}

/**
 * Los eventos de actividad (pidió ayuda, se sentó, caminó, zona...) se generan en UN solo
 * cuadro. Si justo en ese cuadro la persona todavía no estaba confirmada, o el verificador
 * (COCO) dudó un instante, el aviso se perdía para siempre. Acá se guardan hasta `ventanaMs`
 * y salen apenas se puede avisar.
 * @param {Object} pend memoria por persona (se modifica): { evento: instante }
 * @param {string[]} nuevos eventos de este cuadro
 * @param {boolean} puedeAvisar si ahora la persona está confirmada
 * @param {(e:string)=>boolean} excluido eventos que ahora no deben salir (se mantienen pendientes)
 * @returns {string[]} eventos que salen ahora
 */
export function eventosPendientes(pend, nuevos, ahora, puedeAvisar, excluido = () => false, ventanaMs = 4000) {
  for (const e of nuevos) pend[e] = ahora;
  const listos = [];
  for (const [e, t] of Object.entries(pend)) {
    if (ahora - t > ventanaMs) delete pend[e];
    else if (puedeAvisar && !excluido(e)) { listos.push(e); delete pend[e]; }
  }
  return listos;
}

/**
 * Fracción de píxeles que cambiaron entre dos cuadros (RGBA, mismo tamaño): `dentro` = adentro del
 * círculo (cx, cy, radio) y `fuera` = en el resto del cuadro de la parte de abajo del 30 %, fuera de
 * un círculo del doble de radio (para distinguir un movimiento local de un cambio de luz global).
 */
export function fraccionCambiada(cur, prev, sw, sh, cx, cy, radio, umbralDif = 14) {
  let dentro = 0; let nDentro = 0; let fuera = 0; let nFuera = 0;
  const r2 = radio * 2;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const dd = Math.hypot(x - cx, y - cy);
      if (dd > r2 && y <= sh * 0.3) continue;
      const k = (y * sw + x) * 4;
      const dif = (Math.abs(cur[k] - prev[k]) + Math.abs(cur[k + 1] - prev[k + 1]) + Math.abs(cur[k + 2] - prev[k + 2])) / 3;
      const cambio = dif > umbralDif ? 1 : 0;
      if (dd <= radio) { dentro += cambio; nDentro++; } else if (dd > r2) { fuera += cambio; nFuera++; }
    }
  }
  return { dentro: nDentro ? dentro / nDentro : 0, fuera: nFuera ? fuera / nFuera : 0 };
}

/**
 * Movimiento por zonas entre dos cuadros (RGBA): `cabeza` = círculo alrededor de la cabeza, `torso` =
 * círculo alrededor de los hombros (sin lo que ya cuenta como cabeza) y `fuera` = el resto del cuadro
 * de la parte de abajo del 30 %, lejos de las dos zonas. Un brazo que se rasca mueve la cabeza pero
 * deja el torso quieto; sentarse o girar mueve las dos.
 */
export function movimientoRegiones(cur, prev, sw, sh, cab, tor, umbralDif = 10) {
  let c = 0; let nc = 0; let t = 0; let nt = 0; let f = 0; let nf = 0;
  const lejos = Math.max(cab.r, tor.r) * 2.2;
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const dc = Math.hypot(x - cab.x, y - cab.y);
      const dt = Math.hypot(x - tor.x, y - tor.y);
      const enCab = dc <= cab.r;
      const enTor = !enCab && dt <= tor.r;
      const enFuera = dc > lejos && dt > lejos && y > sh * 0.3;
      if (!enCab && !enTor && !enFuera) continue;
      const k = (y * sw + x) * 4;
      const dif = (Math.abs(cur[k] - prev[k]) + Math.abs(cur[k + 1] - prev[k + 1]) + Math.abs(cur[k + 2] - prev[k + 2])) / 3;
      const cambio = dif > umbralDif ? 1 : 0;
      if (enCab) { c += cambio; nc++; } else if (enTor) { t += cambio; nt++; } else { f += cambio; nf++; }
    }
  }
  return { cabeza: nc ? c / nc : 0, torso: nt ? t / nt : 0, fuera: nf ? f / nf : 0 };
}

/**
 * ¿Hay movimiento SOSTENIDO cerca de la cabeza? `hist` = [{t, s, f}] (s = movimiento cerca de la
 * cabeza, f = movimiento afuera). Se queda con los últimos 3 s (modifica el arreglo). Cuenta como
 * movimiento una muestra con s >= umbral y concentrada (s >= concentrado veces lo de afuera); hace
 * falta una fracción de las muestras de la ventana, y un mínimo de muestras, para que un instante
 * suelto (un giro de cabeza, un cambio de luz) no alcance.
 */
export function movimientoSostenido(hist, now, { ventanaMs = 3000, umbral = 0.015, fraccion = 0.6, minMuestras = 2, separacionMs = 800, concentrado = 3, torsoMax = 0.6, fueraMax = 0.02 } = {}) {
  while (hist.length && now - hist[0].t > 3000) hist.shift();
  const v = hist.filter((m) => now - m.t <= ventanaMs);
  if (v.length < minMuestras) return false;
  // tor = movimiento del torso (si se midió): un brazo rascándose mueve la cabeza y deja el torso quieto.
  const buenas = v.filter((m) => m.s >= umbral && m.s >= concentrado * Math.max(m.f, 0.003) && m.f <= fueraMax && (m.tor === undefined || m.tor <= torsoMax * m.s));
  // Por TIEMPO y no por cantidad de muestras (el celular puede procesar solo 2 cuadros por segundo): hacen falta
  // al menos 2 muestras buenas separadas por separacionMs, para que un instante suelto no alcance.
  if (buenas.length < 2 || buenas[buenas.length - 1].t - buenas[0].t < separacionMs) return false;
  return buenas.length / v.length >= fraccion;
}

/**
 * ¿Lo que el modelo de pose tomó por una persona es en realidad una MANO? Típico: la palma
 * mostrada a la cámara, de cerca: el modelo de pose "inventa" un cuerpo sobre ella y hasta el
 * detector de personas (COCO) puede darle puntaje. Si una mano detectada tiene su centro
 * dentro del recuadro de ese "cuerpo" y ocupa buena parte de él, es una mano: en una persona
 * real la mano es chica frente al cuerpo (típicamente menos del 10 % de su recuadro).
 * @param {Array<Array<{x:number,y:number}>>} manos manos (landmarks 0..1) de TODO el cuadro
 */
export function manoNoPersona(pose, manos, w, h, minRatio = 0.4) {
  const box = poseBox(pose, w, h);
  if (!box || !manos?.length) return false;
  const areaPose = Math.max(box.w * box.h, 1);
  for (const mano of manos) {
    if (!mano?.length) continue;
    const xs = mano.map((p) => p.x * w);
    const ys = mano.map((p) => p.y * h);
    const x0 = Math.min(...xs); const x1 = Math.max(...xs);
    const y0 = Math.min(...ys); const y1 = Math.max(...ys);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const dentro = cx >= box.x - box.w * 0.2 && cx <= box.x + box.w * 1.2
      && cy >= box.y - box.h * 0.2 && cy <= box.y + box.h * 1.2;
    if (dentro && (x1 - x0) * (y1 - y0) >= minRatio * areaPose) return true;
  }
  return false;
}

/** ¿Tiene un brazo levantado MÁS ARRIBA QUE LA CABEZA (como pidiendo algo o llamando)?
 * Tres formas de verlo, de la más a la menos directa:
 *  1. la muñeca se ve y queda por encima de la cabeza (con el codo en el medio, si se ve);
 *  2. la muñeca queda cortada fuera del cuadro (pasa mucho al levantar la mano bien alto con
 *     el celular cerca) pero el codo se ve por encima de los ojos (el antebrazo sigue hacia arriba);
 *  3. el detector de manos ve una mano por encima de la cabeza, cerca de esta persona.
 * Todas las distancias se miden en "anchos de hombros", así no importa si está cerca o lejos.
 * @param {Array<Array<{x:number,y:number}>>} manos manos (landmarks 0..1) asignadas a esta persona */
export function brazoLevantado(pose, w, h, manos = []) {
  const caraYs = [P.NOSE, P.L_EYE, P.R_EYE].map((i) => pose[i]).filter(vis).map((l) => px(l, w, h).y);
  const escalaDe = (shIdx) => {
    const sh = pose[shIdx];
    const otro = pose[shIdx === P.L_SHOULDER ? P.R_SHOULDER : P.L_SHOULDER];
    // Preferí el ancho de hombros si se ven los dos; si no (de costado, encuadre cerrado),
    // el recuadro de la persona como respaldo.
    let escala = vis(sh) && vis(otro) ? dist(px(sh, w, h), px(otro, w, h)) : null;
    if (!escala) {
      const box = poseBox(pose, w, h);
      escala = box ? box.h * 0.3 : null;
    }
    return escala;
  };
  // Línea que la mano tiene que pasar: 0.8 anchos de hombro por encima de los ojos, o sea
  // CLARAMENTE más arriba que la cabeza (la coronilla queda ~0.4 arriba de los ojos). Así
  // no se mezcla con tocarse la cabeza. Sin cara visible, bien arriba del hombro.
  const ojosDe = (shP, escala) => (caraYs.length ? Math.min(...caraYs) : shP.y - 1.0 * escala);
  const techoDe = (shP, escala) => ojosDe(shP, escala) - 0.8 * escala;

  const lado = (shIdx, elIdx, wrIdx) => {
    const sh = pose[shIdx], el = pose[elIdx], wr = pose[wrIdx];
    if (!vis(sh)) return false;
    const shP = px(sh, w, h);
    const escala = escalaDe(shIdx);
    if (!escala || escala < 2) return false;
    const techo = techoDe(shP, escala);
    if (vis(wr)) {
      const wrP = px(wr, w, h);
      if (wrP.y >= techo) return false;
      // Si se ve el codo, tiene que estar entre el hombro y la muñeca (en altura): así se
      // confirma un brazo de verdad estirado, no una muñeca "adivinada" sin codo real.
      if (vis(el)) {
        const elP = px(el, w, h);
        const margen = 0.35 * escala;
        if (elP.y < wrP.y - margen || elP.y > shP.y + margen) return false;
      }
      return true;
    }
    // Muñeca fuera de cuadro o sin confianza: el codo por encima de los ojos alcanza.
    if (vis(el)) return px(el, w, h).y < ojosDe(shP, escala);
    return false;
  };
  if (lado(P.L_SHOULDER, P.L_ELBOW, P.L_WRIST) || lado(P.R_SHOULDER, P.R_ELBOW, P.R_WRIST)) return true;

  // 3) manos vistas por el detector de manos, por encima de la cabeza y cerca de la persona.
  const hombros = [P.L_SHOULDER, P.R_SHOULDER].filter((i) => vis(pose[i]));
  if (manos.length && hombros.length) {
    const shPs = hombros.map((i) => px(pose[i], w, h));
    const cx = shPs.reduce((a, p) => a + p.x, 0) / shPs.length;
    const sy = shPs.reduce((a, p) => a + p.y, 0) / shPs.length;
    const escala = escalaDe(hombros[0]);
    if (escala && escala >= 2) {
      const techo = techoDe({ x: cx, y: sy }, escala);
      for (const mano of manos) {
        const pts = [mano[0], mano[9]].filter(Boolean).map((l) => px(l, w, h));
        if (pts.length && pts.every((p) => p.y < techo) && pts.some((p) => Math.abs(p.x - cx) < 2.5 * escala)) return true;
      }
    }
  }
  return false;
}

/**
 * Postura de una persona.
 * - acostada: el tronco queda horizontal (ver isLying).
 * - sentada: el muslo (cadera → rodilla) queda más bien horizontal, o la rodilla casi a la altura de la cadera.
 * - parada: tronco y muslos verticales.
 * Si no se ven bien las piernas devuelve 'desconocida' (no inventa).
 * `inBed`: está acostada con la cadera dentro de una zona marcada como cama.
 * @returns {{posture:'parada'|'sentada'|'acostada'|'desconocida', inBed:boolean, hip:{x,y}|null, torso:number}}
 */
export function classifyPosture(pose, w, h, bedZones = []) {
  const ls = pose[P.L_SHOULDER];
  const rs = pose[P.R_SHOULDER];
  const lh = pose[HIP.L];
  const rh = pose[HIP.R];
  if (!(vis(lh) && vis(rh))) return { posture: 'desconocida', inBed: false, hip: null, torso: 0 };
  // Sin evidencia real de cuerpo (por ejemplo, solo una mano cerca de cámara con puntos
  // de cadera adivinados), no se arriesga una postura: mejor "desconocida" que inventar.
  if (!poseBox(pose, w, h)) return { posture: 'desconocida', inBed: false, hip: null, torso: 0 };
  const hip = mid(px(lh, w, h), px(rh, w, h));
  const torso = vis(ls) && vis(rs) ? dist(mid(px(ls, w, h), px(rs, w, h)), hip) : 0;

  if (isLying(pose, w, h).lying) return { posture: 'acostada', inBed: inZones(hip, bedZones, w, h), hip, torso };
  if (!torso) return { posture: 'desconocida', inBed: false, hip, torso };

  // Muslos: ángulo respecto de la vertical (0° = de pie, 90° = horizontal, sentada).
  const thighs = [[lh, pose[KNEE.L]], [rh, pose[KNEE.R]]]
    .filter(([a, b]) => vis(a) && vis(b))
    .map(([a, b]) => {
      const A = px(a, w, h); const B = px(b, w, h);
      return { angle: (Math.atan2(Math.abs(B.x - A.x), Math.abs(B.y - A.y)) * 180) / Math.PI, drop: (B.y - A.y) / torso };
    });
  if (!thighs.length) {
    // No se ven las rodillas (cámara que solo toma de la cintura para arriba): sin esa
    // evidencia no se puede estar 100% seguro, pero a pedido se arriesga un cálculo
    // aproximado con hombros y cadera. Torso "corto" respecto del ancho de hombros suele
    // darse sentada (el cuerpo se acorta de cintura para arriba al sentarse, sobre todo
    // visto de una cámara apoyada en una mesa); torso "largo" es parada. Si queda en el
    // medio, mejor no arriesgar nada ("desconocida").
    const anchoHombros = dist(px(ls, w, h), px(rs, w, h));
    const anchoCadera = dist(px(lh, w, h), px(rh, w, h));
    // Hombros y cadera tienen que guardar una proporción de cuerpo real (en una persona
    // real nunca son tan distintos entre sí); si no, es más probable que sea una mano u
    // objeto "completado" como torso por el modelo, y no hay que arriesgar nada.
    const proporcionCreible = anchoHombros >= 2 && anchoCadera >= 2
      && anchoHombros / anchoCadera >= 0.4 && anchoHombros / anchoCadera <= 2.5;
    if (proporcionCreible) {
      const ratio = torso / anchoHombros;
      if (ratio < 1.05) return { posture: 'sentada', inBed: false, hip, torso, aprox: true };
      if (ratio >= 1.4) return { posture: 'parada', inBed: false, hip, torso, aprox: true };
    }
    return { posture: 'desconocida', inBed: false, hip, torso };
  }
  const angle = thighs.reduce((s, t) => s + t.angle, 0) / thighs.length;
  const drop = thighs.reduce((s, t) => s + t.drop, 0) / thighs.length; // cuánto baja la rodilla, en "troncos"

  // Sentada: muslo inclinado (>= 50°) o rodilla casi a la altura de la cadera (vista de frente, el muslo "se acorta").
  // El tobillo (si se ve) tiene que continuar la pierna de verdad: por DEBAJO de su
  // rodilla correspondiente (nunca arriba) y a una distancia razonable (una espinilla
  // real), no un punto suelto en cualquier lado. Mismo patrón que el codo o la rodilla.
  const ankles = [[KNEE.L, ANKLE.L], [KNEE.R, ANKLE.R]]
    .filter(([kIdx, aIdx]) => vis(pose[kIdx]) && vis(pose[aIdx]))
    .map(([kIdx, aIdx]) => ({ knee: px(pose[kIdx], w, h), ankle: px(pose[aIdx], w, h) }))
    .filter(({ knee, ankle }) => ankle.y > knee.y && dist(knee, ankle) >= 0.2 * torso && dist(knee, ankle) <= 3 * torso)
    .map(({ ankle }) => ankle);
  const legShort = ankles.length ? (Math.max(...ankles.map((a) => a.y)) - hip.y) / torso < 1.25 : false;
  if (angle >= 50 || drop < 0.45 || (drop < 0.65 && legShort)) return { posture: 'sentada', inBed: false, hip, torso };
  if (angle <= 30 && drop >= 0.6) return { posture: 'parada', inBed: false, hip, torso };
  return { posture: 'desconocida', inBed: false, hip, torso };
}

/**
 * Sigue la postura y el movimiento de UNA persona y avisa cuándo cambian.
 * Eventos: 'sento' (se sentó), 'levanto' (se levantó de la silla/sillón),
 * 'cama_entra' (se acostó en la cama), 'cama_sale' (se levantó de la cama),
 * 'camina' (empezó a caminar), 'quieta' (dejó de caminar y se quedó quieta).
 * Cada cambio tiene que mantenerse un rato (stableMs) para no avisar por un movimiento suelto.
 */
export class ActivityTracker {
  constructor({ stableMs = 1500, walkSpeed = 0.7, stillSpeed = 0.15, stillMs = 3000, windowMs = 1500, brazoStableMs = 500 } = {}) {
    Object.assign(this, { stableMs, walkSpeed, stillSpeed, stillMs, windowMs, brazoStableMs });
    this.state = null; // 'parada' | 'sentada' | 'acostada' | 'cama'
    this.cand = null;
    this.candSince = 0;
    this.trail = []; // [{t, x, y, torso}]
    this.walking = false;
    this.slowSince = null;
    // Para que una caída cuente de verdad, esta persona tiene que haber estado parada o
    // sentada en algún momento ANTES (no alcanza con aparecer ya tirada): evita que un
    // objeto que "nace" ya con pose de acostado (un cable, una caja en el piso) cuente
    // como una caída real, sin tener que esperar a ver primero a una persona de pie.
    this.huboPosturaNormalAntes = false;
    // Picos recientes de velocidad de la cadera (en "troncos por segundo"), para saber si
    // hubo un movimiento BRUSCO hace poco (una caída real es rápida: de pie/sentado a
    // tirado en 1-2 segundos). Acostarse a propósito (a descansar, a dormir) es lento y
    // controlado (sentarse en el borde, acomodar las piernas, recostarse de a poco): no
    // llega a ese pico de velocidad. Así se distingue una caída real de alguien
    // acostándose, SIN necesitar marcar la cama (sirve para cámaras donde no se puede
    // marcar nada, ej. cámaras IP ajenas a la app).
    this.speedTrail = []; // [{t, speed}]
    // Brazo levantado (pidiendo algo): se analiza antes/durante/después. Solo se calcula
    // si se pide explícitamente (ver opts.detectarBrazoArriba), para no gastar de más en
    // quien no activó esta opción.
    this.brazoState = 'abajo';
    this.brazoCand = 'abajo';
    this.brazoCandSince = 0;
    // Zona de interés (dibujada por el usuario, como la cama): si está adentro o no, y
    // desde cuándo, para poder avisar recién después de X tiempo ahí adentro (configurable).
    this.zoneInside = false;
    this.zoneSince = null;
    this.zoneAlerted = false;
    // Contadores de cuántas veces entró/salió, y por qué lado cada vez.
    this.zoneEnterCount = 0;
    this.zoneExitCount = 0;
    this.zoneLastSide = null;
    this.lastHipNorm = null; // posición anterior (0..1), para saber por dónde se cruzó la zona
  }

  /** Vuelve a 0 los contadores de entradas/salidas de la zona (lo pide el usuario, cuando quiera). */
  resetZoneCounters() {
    this.zoneEnterCount = 0;
    this.zoneExitCount = 0;
    this.zoneLastSide = null;
  }

  /** @returns {{posture:string, walking:boolean, events:string[], lyingNow:boolean, inBed:boolean, huboPosturaNormalAntes:boolean}} */
  update(pose, w, h, now, {
    bedZones = [], detectarBrazoArriba = false, manos = [], watchZones = [],
    watchEnter = false, watchExit = false, watchInsideMs = null, watchOutsideMs = null,
  } = {}) {
    const events = [];
    const p = classifyPosture(pose, w, h, bedZones);
    const s = p.posture === 'acostada' && p.inBed ? 'cama' : p.posture;

    // --- zona de interés: 4 avisos independientes, cada uno con su propio tilde:
    // entra, sale, lleva mucho tiempo ADENTRO (su propio tiempo) y lleva mucho tiempo
    // AFUERA (otro tiempo distinto, los dos los define el usuario). ---
    if (watchZones.length && p.hip) {
      const dentro = inZones(p.hip, watchZones, w, h);
      const hipNorm = { x: p.hip.x / w, y: p.hip.y / h };
      if (dentro !== this.zoneInside) {
        this.zoneInside = dentro;
        this.zoneSince = now;
        this.zoneAlerted = false;
        // Al entrar, el lado se mira desde DÓNDE VENÍA (la posición de afuera, el cuadro
        // anterior); al salir, desde dónde está AHORA (recién afuera). Así dice "por dónde"
        // de verdad cruzó, no un lado cualquiera que le quede cerca adentro de la zona.
        this.zoneLastSide = ladoDeZona(dentro ? (this.lastHipNorm || hipNorm) : hipNorm, watchZones[0]);
        if (dentro) { this.zoneEnterCount++; if (watchEnter) events.push('zona_entra'); }
        else { this.zoneExitCount++; if (watchExit) events.push('zona_sale'); }
      } else {
        if (this.zoneSince === null) this.zoneSince = now; // primera vez que se ve a esta persona
        if (this.zoneAlerted) { /* ya avisado para este tramo */ }
        else if (dentro && watchInsideMs && now - this.zoneSince >= watchInsideMs) {
          this.zoneAlerted = true;
          events.push('zona_tiempo_dentro');
        } else if (!dentro && watchOutsideMs && now - this.zoneSince >= watchOutsideMs) {
          this.zoneAlerted = true;
          events.push('zona_tiempo_fuera');
        }
      }
      this.lastHipNorm = hipNorm;
    }

    // --- brazo levantado (pidiendo algo / llamando) ---
    if (detectarBrazoArriba) {
      const arriba = brazoLevantado(pose, w, h, manos);
      const bs = arriba ? 'arriba' : 'abajo';
      if (bs !== this.brazoCand) { this.brazoCand = bs; this.brazoCandSince = now; }
      if (bs !== this.brazoState && now - this.brazoCandSince >= this.brazoStableMs) {
        const prevBrazo = this.brazoState;
        this.brazoState = bs;
        if (bs === 'arriba' && prevBrazo === 'abajo') events.push('pide_ayuda');
      }
    }

    // --- postura estable ---
    if (s !== 'desconocida') {
      if (s !== this.cand) { this.cand = s; this.candSince = now; }
      if (s !== this.state && now - this.candSince >= this.stableMs) {
        const prev = this.state;
        this.state = s;
        // El cálculo APROXIMADO (sin rodillas visibles, solo hombros+cadera) es un
        // respaldo para mostrar algo razonable, pero es un terreno fácil para que un
        // pliegue de sábana o almohada "parezca" sentada un instante. No alcanza por sí
        // solo para habilitar la garantía de "estuvo parada/sentada antes" que después
        // permite confirmar una caída: para eso se exige una postura vista con evidencia
        // real de piernas (rodillas).
        if ((s === 'parada' || s === 'sentada') && !p.aprox) this.huboPosturaNormalAntes = true;
        if (prev) {
          if (s === 'sentada' && prev === 'parada') events.push('sento');
          if (s === 'parada' && prev === 'sentada') events.push('levanto');
          if (s === 'cama') events.push('cama_entra');
          if (prev === 'cama' && (s === 'sentada' || s === 'parada')) events.push('cama_sale');
        }
      }
    }

    // --- caminar / quieta (velocidad de la cadera, en "troncos por segundo") ---
    if (p.hip && p.torso) {
      this.trail.push({ t: now, x: p.hip.x, y: p.hip.y, torso: p.torso });
      while (this.trail.length && now - this.trail[0].t > this.windowMs) this.trail.shift();
      const first = this.trail[0];
      const dt = (now - first.t) / 1000;
      if (dt >= this.windowMs / 2000) {
        const torso = this.trail.reduce((a, b) => a + b.torso, 0) / this.trail.length;
        const speed = Math.hypot(p.hip.x - first.x, p.hip.y - first.y) / torso / dt;
        // Guarda este pico de velocidad un rato (PEAK_WINDOW_MS), para poder consultarlo
        // más tarde: justo cuando se termina de CONFIRMAR una caída (tras quedarse quieta
        // tirada un rato, ver stableMs), la velocidad "de ahora" ya es casi cero (se
        // quedó quieta) — lo que importa es si hubo un pico rápido hace poquito.
        this.speedTrail.push({ t: now, speed });
        const PEAK_WINDOW_MS = 4000;
        while (this.speedTrail.length && now - this.speedTrail[0].t > PEAK_WINDOW_MS) this.speedTrail.shift();
        // Caminar = moverse de costado estando de pie. Una caída o sentarse mueve la cadera hacia abajo: eso no es caminar.
        const dx = Math.abs(p.hip.x - first.x);
        const dy = Math.abs(p.hip.y - first.y);
        const upright = this.state === 'parada' && this.cand === 'parada' && dx >= 1.5 * dy;
        if (!this.walking && upright && speed >= this.walkSpeed) {
          this.walking = true;
          this.slowSince = null;
          events.push('camina');
        } else if (this.walking) {
          if (speed <= this.stillSpeed) {
            this.slowSince ??= now;
            if (now - this.slowSince >= this.stillMs) {
              this.walking = false;
              this.slowSince = null;
              events.push('quieta');
            }
          } else {
            this.slowSince = null;
          }
        }
      }
    }
    return {
      posture: this.state || 'desconocida', walking: this.walking, events, lyingNow: p.posture === 'acostada', inBed: p.inBed,
      brazoAhora: this.brazoCand === 'arriba',
      huboPosturaNormalAntes: this.huboPosturaNormalAntes,
      // Pico de velocidad de la cadera en los últimos 4 segundos (0 si no hay datos).
      peakSpeedRecent: this.speedTrail.length ? Math.max(...this.speedTrail.map((s) => s.speed)) : 0,
      zoneEnterCount: this.zoneEnterCount, zoneExitCount: this.zoneExitCount, zoneLastSide: this.zoneLastSide,
      zoneInsideNow: this.zoneInside, zoneElapsedMs: this.zoneSince !== null ? now - this.zoneSince : 0,
    };
  }
}
