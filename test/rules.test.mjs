import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFrame, TouchTracker, P, manoAbajo } from '../docs/js/rules.js';

const W = 1280;
const H = 720;

// Persona de frente. scale=1 cerca de la cámara, scale=0.2 lejos. (cx, cy) = centro de la cara en px.
function person({ scale = 1, cx = 640, cy = 200, hand = null } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0.1 }));
  const set = (i, dx, dy, v = 0.99) => { lm[i] = { x: (cx + dx * scale) / W, y: (cy + dy * scale) / H, visibility: v }; };
  set(P.NOSE, 0, 10);
  set(P.L_EYE, -18, -5); set(P.R_EYE, 18, -5);
  set(P.L_EAR, -40, 0); set(P.R_EAR, 40, 0);
  set(P.L_SHOULDER, -80, 120); set(P.R_SHOULDER, 80, 120);
  set(P.L_ELBOW, -100, 230); set(P.L_WRIST, -95, 330);
  set(P.L_INDEX, -95, 350); set(P.L_PINKY, -100, 345); set(P.L_THUMB, -85, 345);
  const [hx, hy] = hand || [110, 330]; // mano derecha: por defecto abajo
  set(P.R_ELBOW, 120, 200);
  set(P.R_WRIST, hx, hy);
  set(P.R_INDEX, hx - 5, hy - 20); set(P.R_PINKY, hx + 5, hy - 18); set(P.R_THUMB, hx - 12, hy - 8);
  return lm;
}

for (const scale of [1, 0.5, 0.2]) {
  test(`mano en la parte de arriba de la cabeza → detecta (escala ${scale})`, () => {
    const r = evaluateFrame(person({ scale, hand: [30, -40] }), [], W, H);
    assert.equal(r.touching, true);
    assert.equal(r.side, 'izquierda'); // R_ de MediaPipe = mano izquierda real (ver rules.js)
  });

  test(`mano al costado de la cabeza (rascando sobre la oreja) → detecta (escala ${scale})`, () => {
    const r = evaluateFrame(person({ scale, hand: [60, -10] }), [], W, H);
    assert.equal(r.touching, true);
  });

  test(`mano abajo → no detecta (escala ${scale})`, () => {
    assert.equal(evaluateFrame(person({ scale }), [], W, H).touching, false);
  });

  test(`mano en el pecho → no detecta (escala ${scale})`, () => {
    assert.equal(evaluateFrame(person({ scale, hand: [10, 160] }), [], W, H).touching, false);
  });

  test(`mano en el mentón → no detecta salvo que se active "incluir cara" (escala ${scale})`, () => {
    assert.equal(evaluateFrame(person({ scale, hand: [10, 65] }), [], W, H).touching, false);
    assert.equal(evaluateFrame(person({ scale, hand: [10, 65] }), [], W, H, { includeFace: true }).touching, true);
  });

  for (const [name, hand] of [['la mejilla', [25, 15]], ['los ojos', [15, 10]], ['la nariz', [5, 30]], ['la frente baja', [5, 5]], ['el costado de la cara', [50, 25]], ['la oreja', [48, 22]], ['la oreja (dedos arriba)', [50, 12]]]) {
    test(`mano en ${name} → NO detecta (solo cuenta la cabeza) (escala ${scale})`, () => {
      assert.equal(evaluateFrame(person({ scale, hand }), [], W, H).touching, false);
      assert.equal(evaluateFrame(person({ scale, hand }), [], W, H, { includeFace: true }).touching, true);
    });
  }

  test(`brazo levantado saludando, lejos de la cabeza → no detecta (escala ${scale})`, () => {
    assert.equal(evaluateFrame(person({ scale, hand: [260, -150] }), [], W, H).touching, false);
  });
}

test('sin persona → no detecta', () => {
  assert.equal(evaluateFrame(null, [], W, H).touching, false);
});

test('solo una mano suelta (sin hombros ni orejas ni cuerpo) → no detecta, aunque el modelo adivine 2-3 puntos de cara sueltos', () => {
  // Simula lo que puede pasar si solo hay una mano cerca de cámara: el modelo de pose
  // "adivina" con baja confianza algunos puntos (incluida la cara), pero no hay ninguna
  // evidencia real de hombros ni orejas. No tiene que contar como una persona.
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0.1 }));
  // Puntos de la mano/brazo, bien vistos (como si realmente hubiera una mano a la vista).
  lm[P.R_WRIST] = { x: 640 / W, y: 300 / H, visibility: 0.95 };
  lm[P.R_INDEX] = { x: 645 / W, y: 280 / H, visibility: 0.95 };
  lm[P.R_PINKY] = { x: 650 / W, y: 285 / H, visibility: 0.9 };
  lm[P.R_THUMB] = { x: 630 / W, y: 285 / H, visibility: 0.9 };
  lm[P.R_ELBOW] = { x: 660 / W, y: 200 / H, visibility: 0.8 };
  // Un par de puntos de cara "adivinados" con confianza media (antes alcanzaba, ahora no).
  lm[P.NOSE] = { x: 620 / W, y: 150 / H, visibility: 0.5 };
  lm[P.L_EYE] = { x: 610 / W, y: 145 / H, visibility: 0.48 };
  // La mano del modelo de manos, cerca de esos puntos de cara adivinados.
  const hand = Array.from({ length: 21 }, () => ({ x: 618 / W, y: 148 / H }));
  const r = evaluateFrame(lm, [hand], W, H);
  assert.equal(r.touching, false);
  assert.equal(r.zone, null);
});

test('headZone exige hombros u orejas: dos ojos solos (sin más estructura) no alcanzan', () => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0.1 }));
  lm[P.NOSE] = { x: 620 / W, y: 150 / H, visibility: 0.9 };
  lm[P.L_EYE] = { x: 610 / W, y: 145 / H, visibility: 0.9 };
  lm[P.R_EYE] = { x: 630 / W, y: 145 / H, visibility: 0.9 };
  const r = evaluateFrame(lm, [], W, H);
  assert.equal(r.zone, null);
});

test('manoAbajo: LAS DOS manos arriba (ninguna por el cuerpo) → NO cuenta como "abajo"', () => {
  // person() siempre deja la mano izquierda "de fábrica" abajo (dy=330); para probar de
  // verdad que ninguna mano está abajo, hay que subir también esa.
  const p = person({ hand: [30, -40] }); // mano derecha arriba de la cabeza
  p[P.L_WRIST] = { ...p[P.L_WRIST], y: (200 - 40) / H }; // mano izquierda también arriba
  p[P.L_INDEX] = { ...p[P.L_INDEX], y: (200 - 60) / H };
  p[P.L_PINKY] = { ...p[P.L_PINKY], y: (200 - 60) / H };
  p[P.L_THUMB] = { ...p[P.L_THUMB], y: (200 - 60) / H };
  assert.equal(manoAbajo(p, [], W, H), false);
});

test('manoAbajo: al menos una mano abajo (al costado del cuerpo) → sí cuenta como "abajo"', () => {
  assert.equal(manoAbajo(person({ hand: [110, 330] }), [], W, H), true); // el valor por defecto de person(): mano abajo
});

test('headZone rechaza una cara pegada a hombros de OTRA persona (dos personas cerca, poca luz): no confía en esa cabeza', () => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0.1 }));
  const set = (i, x, y) => { lm[i] = { x: x / W, y: y / H, visibility: 0.9 }; };
  // Hombros de la "persona A" (ancho de hombros = 160px).
  set(P.L_SHOULDER, 300, 300); set(P.R_SHOULDER, 460, 300);
  // Cara de la "persona B", lejos: a más de 3x el ancho de hombros de distancia.
  set(P.NOSE, 900, 150); set(P.L_EYE, 880, 145); set(P.R_EYE, 920, 145);
  const r = evaluateFrame(lm, [], W, H);
  assert.equal(r.zone, null);
});

test('dedos detectados por el modelo de manos cuentan aunque la pose no vea la muñeca', () => {
  const pose = person({ hand: [110, 330] });
  for (const i of [P.R_WRIST, P.R_INDEX, P.R_PINKY, P.R_THUMB]) pose[i].visibility = 0.1;
  const hand = Array.from({ length: 21 }, () => ({ x: 700 / W, y: 160 / H }));
  const r = evaluateFrame(pose, [hand], W, H);
  assert.equal(r.touching, true);
  assert.equal(r.via, 'mano');
});

test('TouchTracker: exige tiempo mínimo, alerta una vez y respeta la espera', () => {
  const t = new TouchTracker({ holdMs: 500, cooldownMs: 10000, graceMs: 300 });
  const touch = (from, to) => { let last; for (let ms = from; ms <= to; ms += 100) last = t.update(true, ms); return last; };
  assert.equal(touch(0, 400), 'touching');
  assert.equal(t.update(true, 500), 'alert');
  assert.equal(touch(600, 1500), 'touching'); // mismo contacto, no repite
  assert.equal(t.update(false, 2000), 'idle'); // contacto terminado
  assert.equal(touch(3000, 3400), 'touching');
  assert.equal(t.update(true, 3500), 'cooldown'); // nuevo contacto dentro de la espera
  t.update(false, 4000);
  assert.equal(touch(11000, 11400), 'touching');
  assert.equal(t.update(true, 11500), 'alert'); // pasada la espera, vuelve a alertar
});

test('TouchTracker: tolera cortes breves de detección', () => {
  const t = new TouchTracker({ holdMs: 500, cooldownMs: 0, graceMs: 300 });
  t.update(true, 0);
  t.update(true, 100);
  t.update(false, 200); // parpadeo de detección
  assert.equal(t.update(true, 300), 'touching');
  assert.equal(t.update(true, 500), 'alert'); // cuenta desde 0, no se reinició
});
