// Regla "mano en la cabeza".
// Trabaja en píxeles y escala todo con el tamaño del cuerpo de la persona,
// así funciona igual si la persona está cerca o lejos de la cámara.

// Índices de MediaPipe Pose (33 puntos)
export const P = {
  NOSE: 0, L_EYE: 2, R_EYE: 5, L_EAR: 7, R_EAR: 8,
  L_SHOULDER: 11, R_SHOULDER: 12, L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16, L_PINKY: 17, R_PINKY: 18,
  L_INDEX: 19, R_INDEX: 20, L_THUMB: 21, R_THUMB: 22,
};

// Puntas de los dedos en MediaPipe Hands (21 puntos)
export const FINGERTIPS = [4, 8, 12, 16, 20];

const MIN_VIS = 0.55;
const visible = (lm) => lm && (lm.visibility === undefined || lm.visibility >= MIN_VIS);
const px = (lm, w, h) => ({ x: lm.x * w, y: lm.y * h });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mean = (pts) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });

/** Cuántos puntos de TODO el cuerpo están bien vistos (no solo la cara): si hay pocos,
 * es señal de que no hay una persona real a la vista (por ejemplo, solo una mano cerca
 * de cámara), aunque el modelo haya adivinado un par de puntos de cara sueltos. */
function pistasDeCuerpoSuficientes(pose) {
  return pose.filter(visible).length >= 6;
}

/**
 * Calcula la "zona de la cabeza" (círculo) a partir de los puntos de pose.
 * Devuelve null si no se ve bien la cabeza, o si no hay suficiente evidencia de que
 * haya una persona de verdad (y no, por ejemplo, solo una mano suelta cerca de cámara).
 */
export function headZone(pose, w, h, sensitivity = 1) {
  if (!pistasDeCuerpoSuficientes(pose)) return null;
  const facePts = [P.NOSE, P.L_EYE, P.R_EYE, P.L_EAR, P.R_EAR].map((i) => pose[i]).filter(visible).map((l) => px(l, w, h));
  if (facePts.length < 3) return null;
  const face = mean(facePts);

  // Tamaño de referencia: el mayor entre ancho de hombros, ancho de cabeza y cuello.
  // Hace falta al menos una pareja "estructural" (hombros u orejas): la sola distancia
  // entre los ojos es una señal débil (dos puntos sueltos, fácil de adivinar sin que
  // haya una persona real) y no alcanza por sí sola para confiar en la zona.
  const sizes = [];
  const hombrosOk = visible(pose[P.L_SHOULDER]) && visible(pose[P.R_SHOULDER]);
  const orejasOk = visible(pose[P.L_EAR]) && visible(pose[P.R_EAR]);
  if (hombrosOk) {
    const ls = px(pose[P.L_SHOULDER], w, h);
    const rs = px(pose[P.R_SHOULDER], w, h);
    sizes.push(dist(ls, rs));
    sizes.push(1.4 * Math.abs(mean([ls, rs]).y - face.y));
  }
  if (orejasOk) sizes.push(2.3 * dist(px(pose[P.L_EAR], w, h), px(pose[P.R_EAR], w, h)));
  if (!hombrosOk && !orejasOk) return null;
  if (visible(pose[P.L_EYE]) && visible(pose[P.R_EYE])) sizes.push(4.5 * dist(px(pose[P.L_EYE], w, h), px(pose[P.R_EYE], w, h)));
  if (sizes.length === 0) return null;
  const body = Math.max(...sizes);

  // El centro del cráneo está un poco por encima de los ojos/nariz.
  const center = { x: face.x, y: face.y - 0.18 * body };
  const radius = 0.48 * body * sensitivity;
  const shoulderY = visible(pose[P.L_SHOULDER]) && visible(pose[P.R_SHOULDER])
    ? (pose[P.L_SHOULDER].y + pose[P.R_SHOULDER].y) / 2 * h
    : face.y + 0.7 * body;

  // Solo cuenta la CABEZA (cuero cabelludo), no la cara:
  //  - delante de la cara (franja central): la mano tiene que estar por encima de la frente
  //    (bastante más arriba que los ojos). Tocarse ojos, nariz, mejillas, boca o la frente baja no cuenta.
  //  - a los costados (más afuera que las orejas): cuenta solo claramente por encima de la oreja
  //    (rascarse el costado de la cabeza). Tocarse la oreja no cuenta.
  // Si se activa includeFace, vuelve a contar toda la zona (incluida la cara).
  const eyes = [P.L_EYE, P.R_EYE].map((i) => pose[i]).filter(visible).map((l) => px(l, w, h));
  const ears = [P.L_EAR, P.R_EAR].map((i) => pose[i]).filter(visible).map((l) => px(l, w, h));
  const eyeY = eyes.length ? mean(eyes).y : face.y;
  const earY = ears.length ? mean(ears).y : eyeY;
  return {
    center, radius, body, shoulderY,
    faceX: face.x,
    faceHalfW: 0.22 * body, // media cara (de oreja a oreja / 2)
    crownLimitY: eyeY - 0.2 * body, // línea del pelo, aprox.
    sideLimitY: earY - 0.12 * body, // por encima de la oreja (tocarse la oreja no cuenta)
  };
}

/** Puntos de las manos que da el modelo de pose (muñeca, meñique, índice, pulgar). */
export function poseHandPoints(pose, w, h) {
  const sides = [
    // La cámara no está en espejo: lo que para la cámara es la izquierda/derecha de la persona
    // es al revés de lo que ella misma siente, por eso se informa invertido.
    { side: 'derecha', idx: [P.L_WRIST, P.L_PINKY, P.L_INDEX, P.L_THUMB] },
    { side: 'izquierda', idx: [P.R_WRIST, P.R_PINKY, P.R_INDEX, P.R_THUMB] },
  ];
  return sides.map(({ side, idx }) => ({ side, points: idx.map((i) => pose[i]).filter(visible).map((l) => px(l, w, h)) }));
}

/**
 * Evalúa un cuadro.
 * @param pose  landmarks de pose de UNA persona (array de 33 {x,y,visibility})
 * @param hands array de manos (cada una array de 21 {x,y}) del HandLandmarker, opcional
 * @param opts.sensitivity  tamaño de la zona (1 = normal)
 * @param opts.includeFace  si es true, tocarse la cara (ojos, nariz, mejillas, boca, mentón) también cuenta
 * @returns {{touching:boolean, zone, closest:number|null, via:string|null, side:string|null}}
 */
export function evaluateFrame(pose, hands, w, h, { sensitivity = 1, includeFace = false } = {}) {
  const zone = pose ? headZone(pose, w, h, sensitivity) : null;
  const result = { touching: false, zone, closest: null, via: null, side: null };
  if (!zone) return result;

  const check = (pt, via, side) => {
    // La mano tiene que estar por encima de los hombros (evita falsos positivos con la mano en el pecho).
    if (pt.y > zone.shoulderY) return;
    if (!includeFace) {
      const inFront = Math.abs(pt.x - zone.faceX) < zone.faceHalfW;
      if (pt.y > (inFront ? zone.crownLimitY : zone.sideLimitY)) return; // es la cara, no la cabeza
    }
    const d = dist(pt, zone.center) / zone.radius; // 1.0 = borde de la zona
    if (result.closest === null || d < result.closest) result.closest = d;
    if (d <= 1 && !result.touching) Object.assign(result, { touching: true, via, side });
  };

  for (const { side, points } of poseHandPoints(pose, w, h)) for (const pt of points) check(pt, 'pose', side);

  for (const hand of hands || []) {
    for (const i of FINGERTIPS) if (hand[i]) check(px(hand[i], w, h), 'mano', null);
  }
  return result;
}

/**
 * Máquina de estados para no mandar alertas de más:
 *  - el contacto debe durar al menos `holdMs`
 *  - después de alertar espera `cooldownMs` antes de volver a alertar
 *  - tolera cortes cortos de detección (`graceMs`)
 */
export class TouchTracker {
  constructor({ holdMs = 600, cooldownMs = 30000, graceMs = 400 } = {}) {
    Object.assign(this, { holdMs, cooldownMs, graceMs });
    this.since = null; // inicio del contacto actual
    this.lastSeen = null;
    this.lastAlert = -Infinity;
    this.alertedThisTouch = false;
  }

  /** @returns {'alert'|'touching'|'idle'|'cooldown'} */
  update(touching, now) {
    if (touching) {
      if (this.since === null || now - this.lastSeen > this.graceMs) {
        this.since = now;
        this.alertedThisTouch = false;
      }
      this.lastSeen = now;
      if (!this.alertedThisTouch && now - this.since >= this.holdMs) {
        if (now - this.lastAlert >= this.cooldownMs) {
          this.alertedThisTouch = true;
          this.lastAlert = now;
          return 'alert';
        }
        return 'cooldown';
      }
      return 'touching';
    }
    if (this.since !== null && now - this.lastSeen > this.graceMs) this.since = null;
    return 'idle';
  }

  touchDuration(now) {
    return this.since === null ? 0 : now - this.since;
  }
}
