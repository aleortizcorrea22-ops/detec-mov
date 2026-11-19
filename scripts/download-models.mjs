// Descarga los modelos de MediaPipe a public/models para usar la app sin depender de internet.
// Uso: npm run models
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'models');
const base = 'https://storage.googleapis.com/mediapipe-models';
const models = {
  'pose_landmarker_lite.task': `${base}/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task`,
  'pose_landmarker_full.task': `${base}/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task`,
  'pose_landmarker_heavy.task': `${base}/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task`,
  'hand_landmarker.task': `${base}/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task`,
};

await mkdir(dir, { recursive: true });
for (const [name, url] of Object.entries(models)) {
  process.stdout.write(`Descargando ${name}… `);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(path.join(dir, name), buf);
  console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
}
console.log('Listo. La app usará los modelos locales.');
