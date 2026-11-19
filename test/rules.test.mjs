import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateFrame, TouchTracker, P } from '../public/js/rules.js';

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
    assert.equal(r.side, 'derecha');
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

  test(`brazo levantado saludando, lejos de la cabeza → no detecta (escala ${scale})`, () => {
    assert.equal(evaluateFrame(person({ scale, hand: [260, -150] }), [], W, H).touching, false);
  });
}

test('sin persona → no detecta', () => {
  assert.equal(evaluateFrame(null, [], W, H).touching, false);
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
