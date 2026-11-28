import test from 'node:test';
import assert from 'node:assert/strict';
import { P } from '../docs/js/rules.js';
import { isLying, assignHands, PeopleTracker, poseBox, filtrarPosesDuplicadas, brazoLevantado, evidenciaDeCuerpoReal } from '../docs/js/people.js';

const W = 1280;
const H = 720;

// Persona de pie (o sentada derecha), centrada en (cx, cy) = cara.
function standing({ cx = 640, cy = 150, s = 1 } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0.1 }));
  const set = (i, dx, dy) => { lm[i] = { x: (cx + dx * s) / W, y: (cy + dy * s) / H, visibility: 0.99 }; };
  set(P.NOSE, 0, 10); set(P.L_EYE, -18, -5); set(P.R_EYE, 18, -5); set(P.L_EAR, -40, 0); set(P.R_EAR, 40, 0);
  set(P.L_SHOULDER, -80, 120); set(P.R_SHOULDER, 80, 120);
  set(P.L_ELBOW, -100, 230); set(P.R_ELBOW, 100, 230);
  set(P.L_WRIST, -95, 330); set(P.R_WRIST, 95, 330);
  set(23, -60, 330); set(24, 60, 330); // caderas
  set(25, -60, 470); set(26, 60, 470); set(27, -60, 600); set(28, 60, 600);
  return lm;
}

// La misma persona tirada en el suelo: rotada 90° (cabeza a la izquierda, pies a la derecha).
function lyingDown({ cx = 200, cy = 560, s = 0.8 } = {}) {
  const up = standing({ cx: 0, cy: 0, s: 1 });
  return up.map((l) => {
    if (l.visibility < 0.5) return l;
    const dx = l.x * W;
    const dy = l.y * H;
    return { x: (cx + dy * s) / W, y: (cy - dx * s) / H, visibility: 0.99 };
  });
}

test('persona de pie → no está caída', () => {
  const r = isLying(standing(), W, H);
  assert.equal(r.lying, false);
  assert.ok(r.angle < 20);
});

test('persona acostada en el suelo → caída', () => {
  const r = isLying(lyingDown(), W, H);
  assert.equal(r.lying, true);
  assert.ok(r.angle > 70);
});

test('hombros y cadera en ángulos incoherentes entre sí (mezcla de dos lugares distintos) → no cuenta como caída', () => {
  const p = lyingDown();
  // Gira solo la línea de la cadera 90° alrededor de su propio centro (sin tocar los
  // hombros): mismo ancho y misma posición media, pero ya no coherente con los hombros,
  // como si el modelo hubiera tomado la cadera de otro lado.
  const cx = ((p[23].x + p[24].x) / 2) * W;
  const cy = ((p[23].y + p[24].y) / 2) * H;
  const dx23 = p[23].x * W - cx; const dy23 = p[23].y * H - cy;
  const dx24 = p[24].x * W - cx; const dy24 = p[24].y * H - cy;
  p[23] = { ...p[23], x: (cx - dy23) / W, y: (cy + dx23) / H };
  p[24] = { ...p[24], x: (cx - dy24) / W, y: (cy + dx24) / H };
  assert.equal(isLying(p, W, H).lying, false);
});

test('inclinada un poco (agachándose) → no cuenta como caída', () => {
  const p = standing();
  // corre los hombros hacia un costado: tronco a ~30°
  for (const i of [P.L_SHOULDER, P.R_SHOULDER, P.NOSE, P.L_EYE, P.R_EYE, P.L_EAR, P.R_EAR]) p[i] = { ...p[i], x: p[i].x + 120 / W };
  assert.equal(isLying(p, W, H).lying, false);
});

test('sin caderas visibles → no decide caída', () => {
  const p = lyingDown();
  p[23].visibility = 0.1; p[24].visibility = 0.1;
  assert.equal(isLying(p, W, H).lying, false);
});

test('persona sentada/acostada en la cama con "rodilla" alucinada sobre un objeto del fondo (ej. mesita de luz), en un ángulo que no continúa el cuerpo → no cuenta como caída', () => {
  // Hombros y cadera reales, bastante verticales (alguien recostado contra el respaldo).
  const p = standing({ cx: 640, cy: 150 });
  // La rodilla "real" no se ve (tapada), pero el modelo adivina un punto con buena
  // confianza muy lejos y en un ángulo cualquiera (no continuando hombro→cadera), como
  // una esquina de mueble en el piso.
  p[25] = { x: (200) / W, y: (650) / H, visibility: 0.9 };
  p[26] = { ...p[26], visibility: 0.1 };
  assert.equal(isLying(p, W, H).lying, false);
});

test('rodilla visible pero con confianza baja (<0.7) → no alcanza para contar una caída', () => {
  const p = lyingDown();
  // Baja la confianza de las dos rodillas por debajo del nuevo umbral más estricto.
  p[25] = { ...p[25], visibility: 0.6 };
  p[26] = { ...p[26], visibility: 0.6 };
  assert.equal(isLying(p, W, H).lying, false);
});

test('solo una mano/brazo (proporción de cuerpo imposible) → no cuenta como caída ni como postura', () => {
  // Simula al modelo "alucinando" hombros y caderas con buena confianza a partir de
  // poco más que una mano cerca de cámara: los hombros quedan muy juntos (típico de un
  // antebrazo, no de un torso real) y el "torso" resultante es desproporcionado.
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0.1 }));
  const set = (i, x, y) => { lm[i] = { x: x / W, y: y / H, visibility: 0.9 }; };
  set(P.L_SHOULDER, 630, 300); set(P.R_SHOULDER, 650, 300); // hombros a 20px (imposible)
  set(23, 500, 600); set(24, 800, 600); // caderas lejísimos, tronco gigante en comparación
  set(P.L_WRIST, 640, 280); set(P.R_WRIST, 645, 285);
  const r = isLying(lm, W, H);
  assert.equal(r.lying, false);
  assert.equal(classifyPosture(lm, W, H).posture, 'desconocida');
  // Ni cara (nunca se vieron ojos/nariz/orejas) ni pierna creíble: no hay evidencia real
  // de cuerpo humano, aunque el modelo haya "completado" hombros y cadera.
  assert.equal(evidenciaDeCuerpoReal(lm), false);
});

test('evidenciaDeCuerpoReal: una persona de pie (con cara visible) sí cuenta', () => {
  assert.equal(evidenciaDeCuerpoReal(standing()), true);
});

test('evidenciaDeCuerpoReal: un solo punto de cara suelto (ej. una oreja sola) NO alcanza', () => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0.1 }));
  lm[P.L_EAR] = { x: 600 / W, y: 150 / H, visibility: 0.9 }; // solo una oreja, nada más de cara
  assert.equal(evidenciaDeCuerpoReal(lm), false);
});

test('evidenciaDeCuerpoReal: dos ojos sin nariz debajo (ej. un mouse de PC) NO alcanza', () => {
  // Caso real: el modelo le "adivinó" dos puntos de ojo a los botones/rueda de un mouse,
  // pero sin una nariz ubicada por debajo en el lugar correcto.
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0.1 }));
  lm[P.L_EYE] = { x: 600 / W, y: 150 / H, visibility: 0.9 };
  lm[P.R_EYE] = { x: 620 / W, y: 150 / H, visibility: 0.9 };
  assert.equal(evidenciaDeCuerpoReal(lm), false);
});

test('evidenciaDeCuerpoReal: dos orejas sin nariz entre ellas NO alcanza', () => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0.1 }));
  lm[P.L_EAR] = { x: 590 / W, y: 150 / H, visibility: 0.9 };
  lm[P.R_EAR] = { x: 630 / W, y: 150 / H, visibility: 0.9 };
  assert.equal(evidenciaDeCuerpoReal(lm), false);
});

test('evidenciaDeCuerpoReal: boca visible pero NO debajo de la nariz → rechaza aunque el resto diera creíble', () => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0.1 }));
  lm[P.L_EYE] = { x: 600 / W, y: 150 / H, visibility: 0.9 };
  lm[P.R_EYE] = { x: 620 / W, y: 150 / H, visibility: 0.9 };
  lm[P.NOSE] = { x: 610 / W, y: 165 / H, visibility: 0.9 };
  lm[P.MOUTH_L] = { x: 605 / W, y: 160 / H, visibility: 0.9 }; // arriba de la nariz: inválido
  lm[P.MOUTH_R] = { x: 615 / W, y: 160 / H, visibility: 0.9 };
  assert.equal(evidenciaDeCuerpoReal(lm), false);
});

test('evidenciaDeCuerpoReal: dos ojos CON una nariz creíble debajo → sí cuenta', () => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0.1 }));
  lm[P.L_EYE] = { x: 600 / W, y: 150 / H, visibility: 0.9 };
  lm[P.R_EYE] = { x: 620 / W, y: 150 / H, visibility: 0.9 };
  lm[P.NOSE] = { x: 610 / W, y: 165 / H, visibility: 0.9 }; // debajo de los ojos
  assert.equal(evidenciaDeCuerpoReal(lm), true);
});

test('hombros+cadera con proporción creíble pero sin ninguna rodilla visible → no cuenta como caída', () => {
  // Reusa la geometría de una persona acostada real, pero sin las rodillas (como si el
  // modelo hubiera "completado" un torso creíble a partir de un objeto, sin ver piernas).
  const p = lyingDown();
  p[25].visibility = 0.1; p[26].visibility = 0.1; // KNEE.L, KNEE.R
  assert.equal(isLying(p, W, H).lying, false);
});

test('PeopleTracker: numera 1 y 2 y mantiene el número aunque cambie el orden', () => {
  const t = new PeopleTracker();
  const a = standing({ cx: 300 });
  const b = standing({ cx: 900 });
  const r1 = t.update([a, b], W, H, 0);
  const idA = r1.find((p) => p.index === 0).id;
  const idB = r1.find((p) => p.index === 1).id;
  assert.deepEqual([idA, idB].sort(), [1, 2]);
  // siguiente cuadro: el modelo las devuelve al revés y se movieron un poco
  const r2 = t.update([standing({ cx: 910 }), standing({ cx: 310 })], W, H, 100);
  assert.equal(r2.find((p) => p.index === 1).id, idA);
  assert.equal(r2.find((p) => p.index === 0).id, idB);
});

test('PeopleTracker: si alguien se va, al rato se olvida y el número se reusa', () => {
  const t = new PeopleTracker({ forgetMs: 1000 });
  t.update([standing({ cx: 300 }), standing({ cx: 900 })], W, H, 0);
  t.update([standing({ cx: 900 })], W, H, 500); // la Persona 1 salió de cuadro
  t.update([standing({ cx: 900 })], W, H, 2000); // pasó el tiempo: se olvida
  const r = t.update([standing({ cx: 900 }), standing({ cx: 300 })], W, H, 2100);
  assert.deepEqual(r.map((p) => p.id), [1, 2]);
});

test('PeopleTracker: cada persona tiene su propia alerta', () => {
  const t = new PeopleTracker({ touch: { holdMs: 200, cooldownMs: 10000, graceMs: 100 } });
  const states = { 1: [], 2: [] };
  for (let ms = 0; ms <= 300; ms += 100) {
    const people = t.update([standing({ cx: 300 }), standing({ cx: 900 })], W, H, ms);
    for (const p of people) states[p.id].push(p.track.touch.update(p.id === 2, ms));
  }
  assert.ok(!states[1].includes('alert'));
  assert.ok(states[2].includes('alert'));
});

test('assignHands: la mano va a la persona cuya muñeca está más cerca', () => {
  const a = standing({ cx: 300 });
  const b = standing({ cx: 900 });
  const hand = Array.from({ length: 21 }, () => ({ x: (900 + 95) / W, y: (150 + 320) / H }));
  const per = assignHands([a, b], [hand], W, H);
  assert.equal(per[0].length, 0);
  assert.equal(per[1].length, 1);
});

test('assignHands: una "mano" varias veces más grande que el cuerpo de la persona (ej. patrón del respaldo tapizado) se descarta', () => {
  const a = standing({ cx: 900 }); // ancho de hombros ≈ 160px
  const hand = Array.from({ length: 21 }, () => ({ x: 900 / W, y: 470 / H }));
  hand[0] = { x: 900 / W, y: 470 / H }; // muñeca
  hand[9] = { x: 900 / W, y: (470 - 300) / H }; // punta del dedo mayor, a 300px (gigante)
  const per = assignHands([a], [hand], W, H);
  assert.equal(per[0].length, 0);
});

test('poseBox: recuadro alrededor de la persona', () => {
  const box = poseBox(standing({ cx: 640 }), W, H);
  assert.ok(box.x < 640 && box.x + box.w > 640);
  assert.ok(box.h > box.w);
});

// ---------------- Postura y actividades ----------------
import { classifyPosture, ActivityTracker, inZones } from '../docs/js/people.js';

// Sentada de frente: las rodillas quedan casi a la altura de la cadera.
function sitting({ cx = 640, cy = 150 } = {}) {
  const p = standing({ cx, cy });
  const set = (i, dx, dy) => { p[i] = { x: (cx + dx) / W, y: (cy + dy) / H, visibility: 0.99 }; };
  set(25, -70, 360); set(26, 70, 360); // rodillas
  set(27, -70, 470); set(28, 70, 470); // tobillos
  return p;
}

test('postura: parada / sentada / acostada', () => {
  assert.equal(classifyPosture(standing(), W, H).posture, 'parada');
  assert.equal(classifyPosture(sitting(), W, H).posture, 'sentada');
  assert.equal(classifyPosture(lyingDown(), W, H).posture, 'acostada');
});

test('postura: acostada dentro de la zona de cama → inBed', () => {
  const bed = [{ x: 0, y: 0.5, w: 0.6, h: 0.5 }];
  assert.equal(classifyPosture(lyingDown(), W, H, bed).inBed, true);
  assert.equal(classifyPosture(lyingDown(), W, H, [{ x: 0.7, y: 0, w: 0.3, h: 0.3 }]).inBed, false);
});

test('inZones: cama dibujada como polígono libre (no solo rectángulo), mínimo 3 vértices', () => {
  // Una cama "en diagonal", imposible de describir bien con un rectángulo recto.
  const camaTriangular = [{ pts: [{ x: 0.1, y: 0.9 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.9 }] }];
  assert.equal(inZones({ x: 0.5 * W, y: 0.8 * H }, camaTriangular, W, H), true); // adentro del triángulo
  assert.equal(inZones({ x: 0.5 * W, y: 0.1 * H }, camaTriangular, W, H), false); // afuera (arriba)
  assert.equal(inZones({ x: 0.02 * W, y: 0.95 * H }, camaTriangular, W, H), false); // afuera (fuera del lado izquierdo)

  // Un polígono de 5 vértices también tiene que andar (forma de "L", típica de una cama
  // pegada a una pared en ángulo).
  const formaL = [{ pts: [{ x: 0, y: 0 }, { x: 0.6, y: 0 }, { x: 0.6, y: 0.6 }, { x: 1, y: 0.6 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }];
  assert.equal(inZones({ x: 0.1 * W, y: 0.1 * H }, formaL, W, H), true);
  assert.equal(inZones({ x: 0.8 * W, y: 0.1 * H }, formaL, W, H), false); // en el "hueco" de la L

  // Rectángulo viejo ({x,y,w,h}, sin `pts`) sigue andando igual que antes (compatibilidad).
  assert.equal(inZones({ x: 0.3 * W, y: 0.7 * H }, [{ x: 0, y: 0.5, w: 0.6, h: 0.5 }], W, H), true);
});

test('postura: sin piernas visibles → desconocida (no inventa)', () => {
  const p = standing();
  for (const i of [25, 26, 27, 28]) p[i].visibility = 0.1;
  assert.equal(classifyPosture(p, W, H).posture, 'desconocida');
});

const run = (tr, poseFn, from, to, opts) => { const ev = []; for (let t = from; t <= to; t += 100) ev.push(...tr.update(poseFn(t), W, H, t, opts).events); return ev; };

test('actividad: se sentó y se levantó', () => {
  const tr = new ActivityTracker();
  assert.deepEqual(run(tr, () => standing(), 0, 2000), []);
  assert.deepEqual(run(tr, () => sitting(), 2100, 4500), ['sento']);
  assert.deepEqual(run(tr, () => standing(), 4600, 7000), ['levanto']);
});

test('actividad: un movimiento corto no cuenta (tiene que mantenerse)', () => {
  const tr = new ActivityTracker();
  run(tr, () => standing(), 0, 2000);
  assert.deepEqual(run(tr, () => sitting(), 2100, 2600), []); // medio segundo sentada
  assert.deepEqual(run(tr, () => standing(), 2700, 5000), []);
});

test('actividad: se metió en la cama y se levantó de la cama', () => {
  const bed = { bedZones: [{ x: 0, y: 0.5, w: 0.6, h: 0.5 }] };
  const tr = new ActivityTracker();
  run(tr, () => sitting({ cx: 300, cy: 300 }), 0, 2000, bed);
  assert.deepEqual(run(tr, () => lyingDown(), 2100, 4500, bed), ['cama_entra']);
  assert.deepEqual(run(tr, () => sitting({ cx: 300, cy: 300 }), 4600, 7000, bed), ['cama_sale']);
});

test('actividad: acostada FUERA de la cama no es "se metió en la cama"', () => {
  const tr = new ActivityTracker();
  run(tr, () => standing(), 0, 2000);
  assert.deepEqual(run(tr, () => lyingDown(), 2100, 4500, { bedZones: [] }), []);
});

test('caída real: tiene que haber estado parada o sentada ANTES para contar', () => {
  // Un objeto que "nace" ya con pose de acostado (sin haber estado nunca de pie) no
  // tiene que poder avisar una caída: no hay un "antes" normal que lo respalde.
  const sinAntes = new ActivityTracker();
  let r;
  for (let t = 0; t <= 3000; t += 100) r = sinAntes.update(lyingDown(), W, H, t, { bedZones: [] });
  assert.equal(r.huboPosturaNormalAntes, false);

  // Una persona que sí estuvo parada antes y después se cae: el "antes" queda registrado.
  const conAntes = new ActivityTracker();
  for (let t = 0; t <= 2000; t += 100) conAntes.update(standing(), W, H, t, { bedZones: [] });
  for (let t = 2100; t <= 4500; t += 100) r = conAntes.update(lyingDown(), W, H, t, { bedZones: [] });
  assert.equal(r.huboPosturaNormalAntes, true);
});

test('un pliegue de sábana clasificado como "sentada" por el cálculo APROXIMADO (sin rodillas) no habilita la garantía de "estuvo parada/sentada antes" de una caída', () => {
  // Mismos hombros/cadera que standing(), pero la cadera más cerca (torso corto →
  // ratio torso/hombros < 1.05): el cálculo aproximado la lee como "sentada", sin ver
  // nunca una rodilla real.
  const p = standing();
  for (const i of [23, 24]) { const hipY = 270 + 150; p[i] = { ...p[i], y: hipY / H }; } // torso ≈ 150px (antes 210)
  for (const i of [25, 26, 27, 28]) p[i] = { ...p[i], visibility: 0.1 }; // sin rodillas/tobillos
  assert.equal(classifyPosture(p, W, H).aprox, true);
  assert.equal(classifyPosture(p, W, H).posture, 'sentada');

  const tr = new ActivityTracker();
  let r;
  for (let t = 0; t <= 3000; t += 100) r = tr.update(p, W, H, t, { bedZones: [] });
  assert.equal(r.huboPosturaNormalAntes, false);
});

test('peakSpeedRecent: alto si la cadera bajó rápido hace poco (caída real), bajo si fue lento y controlado (se acostó a propósito)', () => {
  // Misma distancia total (300px) recorrida por la cadera, pero una vez en 1 segundo
  // (brusco, como una caída) y otra en 5 segundos (lento, como acostarse a propósito).
  const trRapido = new ActivityTracker();
  let r;
  for (let t = 0; t <= 1000; t += 100) {
    r = trRapido.update(standing({ cy: 150 + (t / 1000) * 300 }), W, H, t, { bedZones: [] });
  }
  assert.ok(r.peakSpeedRecent >= 1.1, `esperaba un pico de velocidad alto, dio ${r.peakSpeedRecent}`);

  const trLento = new ActivityTracker();
  for (let t = 0; t <= 5000; t += 100) {
    r = trLento.update(standing({ cy: 150 + (t / 5000) * 300 }), W, H, t, { bedZones: [] });
  }
  assert.ok(r.peakSpeedRecent < 1.1, `esperaba un pico de velocidad bajo, dio ${r.peakSpeedRecent}`);
});

test('actividad: camina y después se queda quieta', () => {
  const tr = new ActivityTracker();
  run(tr, () => standing({ cx: 200 }), 0, 2000);
  // camina: 300 px/s (el tronco mide 210 px → ~1.4 troncos por segundo)
  const walk = run(tr, (t) => standing({ cx: 200 + ((t - 2000) / 1000) * 300 }), 2100, 4000);
  assert.deepEqual(walk, ['camina']);
  const stop = run(tr, () => standing({ cx: 770 }), 4100, 9000);
  assert.deepEqual(stop, ['quieta']);
});

test('actividad: parada sin moverse no avisa "camina"', () => {
  const tr = new ActivityTracker();
  assert.deepEqual(run(tr, () => standing(), 0, 6000), []);
});

test('un objeto con pocos puntos débiles (ej. un sillón) no se cuenta como persona', () => {
  // Solo 4 puntos "visibles" con baja confianza: ni siquiera llega al mínimo de 6
  // que ahora se exige para armar el recuadro de una persona.
  const pose = Array(33).fill({ x: 0, y: 0, z: 0, visibility: 0.5 });
  const pocos = pose.map((l, i) => (i < 4 ? l : { ...l, visibility: 0.1 }));
  assert.equal(poseBox(pocos, 1280, 720), null);
});

test('una persona de verdad (muchos puntos visibles) sí arma el recuadro', () => {
  const pose = Array(33).fill(0).map(() => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 }));
  assert.notEqual(poseBox(pose, 1280, 720), null);
});

test('filtrarPosesDuplicadas: una persona detectada dos veces casi superpuesta queda como una sola', () => {
  const persona = standing({ cx: 640 });
  const fantasma = standing({ cx: 660 }).map((l) => ({ ...l, visibility: l.visibility > 0.5 ? 0.6 : l.visibility })); // casi encima, menos confianza
  const resultado = filtrarPosesDuplicadas([persona, fantasma], W, H);
  assert.equal(resultado.length, 1);
});

test('filtrarPosesDuplicadas: dos personas de verdad, separadas, quedan las dos', () => {
  const p1 = standing({ cx: 200 });
  const p2 = standing({ cx: 1000 });
  const resultado = filtrarPosesDuplicadas([p1, p2], W, H);
  assert.equal(resultado.length, 2);
});

test('filtrarPosesDuplicadas: sin poses no rompe nada', () => {
  assert.deepEqual(filtrarPosesDuplicadas([], W, H), []);
});

function brazoArriba(base = standing()) {
  const p = base.map((l) => ({ ...l }));
  // Brazo derecho (R_ en MediaPipe) estirado bien arriba del hombro.
  p[P.R_ELBOW] = { ...p[P.R_ELBOW], y: (150 - 150) / H }; // a la altura de la cara
  p[P.R_WRIST] = { ...p[P.R_WRIST], y: (150 - 250) / H }; // bien por encima de la cabeza
  return p;
}

test('brazoLevantado: brazo estirado hacia arriba → true; brazo abajo (normal) → false', () => {
  assert.equal(brazoLevantado(standing(), W, H), false);
  assert.equal(brazoLevantado(brazoArriba(), W, H), true);
});

test('brazoLevantado: muñeca arriba del hombro pero CODO en una posición imposible (no en el medio) → false', () => {
  // La muñeca sola ya no alcanza: si se ve el codo, tiene que estar entre el hombro y la
  // muñeca. Acá la muñeca está bien arriba (pasaría el chequeo viejo), pero el codo queda
  // MÁS ABAJO que la muñeca Y que el hombro — una "alucinación" del modelo, no un brazo real.
  const p = brazoArriba();
  p[P.R_ELBOW] = { ...p[P.R_ELBOW], y: (150 + 300) / H }; // codo muy por debajo de todo
  assert.equal(brazoLevantado(p, W, H), false);
});

test('brazoLevantado: codo NO visible (poca confianza) → sigue confiando solo en hombro/muñeca (no se castiga lo que no se ve)', () => {
  const p = brazoArriba();
  p[P.R_ELBOW] = { ...p[P.R_ELBOW], visibility: 0.1 };
  assert.equal(brazoLevantado(p, W, H), true);
});

test('actividad: levantar el brazo pidiendo algo, solo si se pide analizarlo', () => {
  const tr = new ActivityTracker();
  // Sin detectarBrazoArriba: no se analiza, aunque el brazo esté levantado todo el rato.
  assert.deepEqual(run(tr, () => brazoArriba(), 0, 2000), []);

  // Con detectarBrazoArriba activado: primero abajo (antes), después arriba y sostenido.
  const tr2 = new ActivityTracker();
  const opts = { detectarBrazoArriba: true };
  assert.deepEqual(run(tr2, () => standing(), 0, 1500, opts), []); // antes: brazo abajo
  assert.deepEqual(run(tr2, () => brazoArriba(), 1600, 3000, opts), ['pide_ayuda']); // durante → después
});

// Solo cintura para arriba: sin rodillas ni tobillos visibles (cámara apoyada en una mesa, etc.)
function cinturaArriba(base, torsoY) {
  const p = base.map((l) => ({ ...l }));
  for (const i of [25, 26, 27, 28, 29, 30, 31, 32]) p[i] = { ...p[i], visibility: 0.05 };
  p[23] = { ...p[23], y: torsoY / H };
  p[24] = { ...p[24], y: torsoY / H };
  return p;
}

test('classifyPosture aproximado (sin rodillas): torso corto → sentada; torso largo → parada', () => {
  const base = standing();
  // Sentada: cadera bien cerca de los hombros (torso corto respecto del ancho de hombros).
  assert.equal(classifyPosture(cinturaArriba(base, 170), W, H).posture, 'sentada');
  // Parada: cadera bien lejos de los hombros (torso largo).
  assert.equal(classifyPosture(cinturaArriba(base, 520), W, H).posture, 'parada');
});

test('classifyPosture aproximado no se arriesga con una proporción de cuerpo imposible', () => {
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0.1 }));
  const set = (i, x, y) => { lm[i] = { x: x / W, y: y / H, visibility: 0.9 }; };
  set(P.L_SHOULDER, 630, 300); set(P.R_SHOULDER, 650, 300); // hombros a 20px (imposible)
  set(23, 500, 600); set(24, 800, 600); // caderas lejísimos
  assert.equal(classifyPosture(lm, W, H).posture, 'desconocida');
});

test('zona de interés: avisa al entrar, al salir, y tras el tiempo configurado adentro (cada aviso con su propio tilde)', () => {
  // Filtra los eventos de "caminar/quieta" (un salto brusco de posición entre pasos de
  // este test, no real, puede disparar "camina" de paso: no es lo que se está probando acá).
  const soloZona = (evs) => evs.filter((e) => e.startsWith('zona_'));
  const zone = [{ x: 0.3, y: 0.5, w: 0.3, h: 0.3 }]; // cubre donde cae la cadera de standing({cx:640})
  const tr = new ActivityTracker();
  const opts = { watchZones: zone, watchEnter: true, watchExit: true, watchInsideMs: 1000 };
  assert.deepEqual(soloZona(run(tr, () => standing({ cx: 100 }), 0, 300, opts)), []); // afuera, nada
  assert.deepEqual(soloZona(run(tr, () => standing({ cx: 640 }), 400, 400, opts)), ['zona_entra']); // entra
  assert.deepEqual(soloZona(run(tr, () => standing({ cx: 640 }), 500, 1500, opts)), ['zona_tiempo_dentro']); // sigue adentro, pasa el tiempo
  assert.deepEqual(soloZona(run(tr, () => standing({ cx: 100 }), 1600, 1600, opts)), ['zona_sale']); // sale
});

test('zona de interés: "tiempo afuera" usa su propio tiempo, distinto del de adentro', () => {
  const soloZona = (evs) => evs.filter((e) => e.startsWith('zona_'));
  const zone = [{ x: 0.3, y: 0.5, w: 0.3, h: 0.3 }];
  const tr = new ActivityTracker();
  const opts = { watchZones: zone, watchInsideMs: 5000, watchOutsideMs: 1000 };
  assert.deepEqual(soloZona(run(tr, () => standing({ cx: 100 }), 0, 300, opts)), []); // afuera, todavía no pasó el tiempo
  assert.deepEqual(soloZona(run(tr, () => standing({ cx: 100 }), 400, 1200, opts)), ['zona_tiempo_fuera']); // pasó el tiempo de afuera
});

test('zona de interés: solo avisa lo que el usuario tildó (entrar sin salir, por ejemplo)', () => {
  const soloZona = (evs) => evs.filter((e) => e.startsWith('zona_'));
  const zone = [{ x: 0.3, y: 0.5, w: 0.3, h: 0.3 }];
  const tr = new ActivityTracker();
  const opts = { watchZones: zone, watchEnter: true }; // sin watchExit ni tiempos
  assert.deepEqual(soloZona(run(tr, () => standing({ cx: 100 }), 0, 300, opts)), []);
  assert.deepEqual(soloZona(run(tr, () => standing({ cx: 640 }), 400, 400, opts)), ['zona_entra']);
  assert.deepEqual(soloZona(run(tr, () => standing({ cx: 100 }), 500, 500, opts)), []); // sale, pero no se avisó porque no se tildó
});

test('zona de interés: cuenta entradas/salidas y dice por qué lado', () => {
  const zone = [{ x: 0.3, y: 0.5, w: 0.3, h: 0.3 }];
  const tr = new ActivityTracker();
  const opts = { watchZones: zone, watchEnter: true, watchExit: true };
  run(tr, () => standing({ cx: 100 }), 0, 300, opts); // afuera, a la izquierda de la zona
  run(tr, () => standing({ cx: 640 }), 400, 400, opts); // entra
  assert.equal(tr.zoneEnterCount, 1);
  assert.equal(tr.zoneLastSide, 'izquierda'); // venía de la izquierda de la zona
  run(tr, () => standing({ cx: 100 }), 2000, 2000, opts); // sale
  assert.equal(tr.zoneExitCount, 1);
  assert.equal(tr.zoneLastSide, 'izquierda'); // sale también hacia la izquierda
});

test('zona de interés: sin dibujar ninguna, no analiza nada (no gasta de más)', () => {
  const tr = new ActivityTracker();
  assert.deepEqual(run(tr, () => standing({ cx: 640 }), 0, 1500, { watchZones: [], watchEnter: true, watchExit: true, watchInsideMs: 1000, watchOutsideMs: 1000 }), []);
});
