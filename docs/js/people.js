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
  // La rodilla visible tiene que estar a una distancia razonable de la cadera (continuar
  // el cuerpo), no en cualquier lado: si está pegada a la cadera o rarísimo de lejos,
  // tampoco es una pierna real.
  const kneePt = vis(pose[KNEE.L]) ? px(pose[KNEE.L], w, h) : px(pose[KNEE.R], w, h);
  const hipKneeDist = dist(hp, kneePt);
  if (hipKneeDist < 0.3 * torso || hipKneeDist > 3 * torso) return { lying: false, angle: null, reason: 'rodilla en posición inválida' };

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
  for (const hand of hands || []) {
    if (!hand?.[0]) continue;
    const wrist = px(hand[0], w, h);
    let best = -1;
    let bestD = Infinity;
    poses.forEach((pose, i) => {
      const cands = [P.L_WRIST, P.R_WRIST, P.L_INDEX, P.R_INDEX].map((k) => pose[k]).filter(vis).map((l) => px(l, w, h));
      if (!cands.length) { const a = poseAnchor(pose, w, h); if (a) cands.push(a); }
      for (const c of cands) { const d = dist(c, wrist); if (d < bestD) { bestD = d; best = i; } }
    });
    if (best >= 0) out[best].push(hand);
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
        id: this.freeId(), x: a.x, y: a.y, size: a.size, lastSeen: now,
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

/** ¿El punto (en píxeles) cae dentro de alguna zona marcada? Zonas en coordenadas 0..1. */
export function inZones(pt, zones, w, h) {
  return (zones || []).some((z) => pt.x >= z.x * w && pt.x <= (z.x + z.w) * w && pt.y >= z.y * h && pt.y <= (z.y + z.h) * h);
}

/** ¿Tiene uno de los dos brazos bien levantado (como pidiendo algo o llamando)?
 * Exige el brazo ESTIRADO hacia arriba (hombro, codo y muñeca alineados hacia arriba,
 * no solo la mano cerca del hombro), con una distancia mínima que se ajusta sola según
 * el tamaño de la persona en la imagen (no importa si está cerca o lejos de cámara). */
export function brazoLevantado(pose, w, h) {
  const lado = (shIdx, elIdx, wrIdx) => {
    const sh = pose[shIdx], el = pose[elIdx], wr = pose[wrIdx];
    if (!vis(sh) || !vis(wr)) return false;
    const shP = px(sh, w, h);
    const wrP = px(wr, w, h);
    const otroHombro = pose[shIdx === P.L_SHOULDER ? P.R_SHOULDER : P.L_SHOULDER];
    // Escala de referencia: preferí el ancho de hombros si se ven los dos; si no (de
    // costado, encuadre cerrado), usá el recuadro de la persona como respaldo, así no
    // se pierde la detección solo porque no entró el otro hombro en cámara.
    let escala = vis(otroHombro) ? dist(shP, px(otroHombro, w, h)) : null;
    if (!escala) {
      const box = poseBox(pose, w, h);
      escala = box ? box.h * 0.3 : null;
    }
    if (!escala || escala < 2) return false;
    // Mano bien por encima del hombro (no solo un poco, para no confundir con un gesto chico).
    return (shP.y - wrP.y) > 0.5 * escala;
  };
  return lado(P.L_SHOULDER, P.L_ELBOW, P.L_WRIST) || lado(P.R_SHOULDER, P.R_ELBOW, P.R_WRIST);
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
  const ankles = [pose[ANKLE.L], pose[ANKLE.R]].filter(vis).map((l) => px(l, w, h));
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
  }

  /** @returns {{posture:string, walking:boolean, events:string[], lyingNow:boolean, inBed:boolean, huboPosturaNormalAntes:boolean}} */
  update(pose, w, h, now, { bedZones = [], detectarBrazoArriba = false, watchZones = [], watchDwellMs = null } = {}) {
    const events = [];
    const p = classifyPosture(pose, w, h, bedZones);
    const s = p.posture === 'acostada' && p.inBed ? 'cama' : p.posture;

    // --- zona de interés: entrar/salir, y "lleva más de X tiempo ahí" ---
    if (watchZones.length && p.hip) {
      const dentro = inZones(p.hip, watchZones, w, h);
      if (dentro !== this.zoneInside) {
        this.zoneInside = dentro;
        if (dentro) {
          this.zoneSince = now;
          this.zoneAlerted = false;
          events.push('zona_entra');
        } else {
          this.zoneSince = null;
          this.zoneAlerted = false;
          events.push('zona_sale');
        }
      } else if (dentro && watchDwellMs && !this.zoneAlerted && this.zoneSince !== null && now - this.zoneSince >= watchDwellMs) {
        this.zoneAlerted = true;
        events.push('zona_tiempo');
      }
    }

    // --- brazo levantado (pidiendo algo / llamando) ---
    if (detectarBrazoArriba) {
      const arriba = brazoLevantado(pose, w, h);
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
        if (s === 'parada' || s === 'sentada') this.huboPosturaNormalAntes = true;
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
    return { posture: this.state || 'desconocida', walking: this.walking, events, lyingNow: p.posture === 'acostada', inBed: p.inBed, huboPosturaNormalAntes: this.huboPosturaNormalAntes };
  }
}
