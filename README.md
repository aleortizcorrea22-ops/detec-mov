# DETEC MOV

App web instalable (PWA) que mira la cámara, detecta a la persona y **avisa por Telegram cuando se toca o se rasca la cabeza**.

- Funciona en PC (Windows / Mac / Linux), Android y iPhone / iPad desde el navegador.
- Al abrir la página aparece el botón **Instalar**; una vez instalada la app, el botón desaparece.
- Dibuja el **esqueleto** de la persona sobre el video (brazos en amarillo, dedos en celeste) y la **zona de la cabeza** (círculo verde, se pone rojo cuando la mano entra).
- Funciona con la persona cerca o lejos: todas las medidas se ajustan al tamaño del cuerpo en la imagen.
- La detección corre en el propio equipo (MediaPipe). El video no se sube a ningún lado; solo se manda la foto de la alerta a Telegram.

> Es un MVP: sirve para probar y calibrar. Ver "Límites conocidos" abajo.

## Cómo funciona

1. Se toma el video de la cámara: cámara del equipo, **Iriun Webcam**, o una **cámara IP** por HTTP.
2. MediaPipe Pose encuentra 33 puntos del cuerpo (hombros, codos, muñecas, dedos, nariz, ojos, orejas). Si está activado, MediaPipe Hands encuentra además los 21 puntos de cada mano.
3. Se calcula una zona circular sobre la cabeza, con tamaño proporcional al cuerpo (ancho de hombros / cabeza).
4. Si un punto de la mano entra en la zona, por encima de la nariz y de los hombros, durante al menos el **tiempo mínimo de contacto** (0,6 s por defecto), se dispara la alerta.
5. El servidor envía a Telegram "⚠️ Se tocó la cabeza" con la hora y una foto. Después espera el tiempo configurado (30 s por defecto) antes de volver a avisar.

Tocarse la boca o el mentón (comer, tomar algo) **no** cuenta, salvo que actives "Contar también tocarse la cara".

## Puesta en marcha

Necesitas [Node.js](https://nodejs.org) 18.17 o más nuevo.

```bash
npm install
cp .env.example .env      # en Windows: copy .env.example .env
npm run models            # opcional: descarga los modelos para no depender de internet
npm start
```

Abre <http://localhost:3000> en Chrome, Edge o Safari.

### Configurar Telegram

1. En Telegram, habla con **@BotFather**, envía `/newbot` y sigue los pasos. Te da un **token** (algo como `123456789:AA...`).
2. Pon el token en `.env`, en `TELEGRAM_BOT_TOKEN=`, y reinicia el servidor (`npm start`).
3. Abre tu bot en Telegram y envíale "hola". Si las alertas van a un grupo, agrega el bot al grupo y escribe algo en él.
4. En la app, presiona **Buscar mi chat_id**. Copia el número en `TELEGRAM_CHAT_ID=` en `.env` (varios separados por coma) y reinicia.
5. Presiona **Enviar alerta de prueba**: debe llegarte el mensaje.

El token queda solo en el servidor; nunca se envía al navegador.

### Usar Iriun Webcam (para probar ahora)

Iriun convierte el celular en una webcam de la PC:

1. Instala Iriun Webcam en el celular y el programa de Iriun en la PC (misma red Wi-Fi).
2. En la app elige **Fuente: Cámara del equipo / Iriun Webcam**, presiona **Iniciar** y acepta el permiso de cámara.
3. En **Dispositivo** elige "Iriun Webcam" y presiona Detener / Iniciar.

### Usar una cámara IP

Elige **Cámara IP (stream MJPEG)** o **Cámara IP (foto JPG)** y escribe la URL. El servidor hace de puente para que el navegador pueda analizar los cuadros. Por seguridad solo acepta direcciones de la red local (192.168.x.x, 10.x.x.x, etc.).

| Cámara | URL de ejemplo |
| --- | --- |
| App "IP Webcam" (Android) | `http://192.168.1.50:8080/video` (MJPEG) o `http://192.168.1.50:8080/shot.jpg` (foto) |
| Cámaras con usuario y clave | `http://usuario:clave@192.168.1.60/cgi-bin/snapshot.cgi` |

Muchas cámaras IP ofrecen una URL de foto (snapshot) o MJPEG además de RTSP; busca "snapshot URL" o "MJPEG URL" con la marca y modelo. **RTSP todavía no está soportado** (los navegadores no lo leen). Es el siguiente paso cuando llegue la cámara: convertirlo en el servidor con ffmpeg.

### Usarla desde el celular

Los navegadores solo dejan usar la cámara e instalar la app en `https://` (o en `localhost`). Para abrir la app desde el celular:

- **Rápido para probar:** crea un túnel HTTPS, por ejemplo `npx cloudflared tunnel --url http://localhost:3000`, y abre la URL `https://….trycloudflare.com` que te muestra.
- **Red local:** genera un certificado (por ejemplo con [mkcert](https://github.com/FiloSottile/mkcert)) y completa `HTTPS_CERT` y `HTTPS_KEY` en `.env`.
- **Más adelante:** publicar el servidor en un hosting con HTTPS.

Si usas un túnel o publicas la app en internet, cualquiera que tenga el enlace podrá abrirla y mandar alertas a tu Telegram. Para pruebas está bien. Antes de dejarla publicada de forma fija, hay que agregar una contraseña.

### Instalar la app

- **Chrome / Edge (PC y Android):** botón **Instalar** arriba a la derecha.
- **iPhone / iPad:** el botón muestra cómo hacerlo: en Safari, *Compartir → Agregar a pantalla de inicio*.
- Abierta como app instalada, el botón no aparece.

## Ajustes

| Ajuste | Para qué sirve |
| --- | --- |
| Sensibilidad | Tamaño de la zona de la cabeza. Súbelo si no detecta, bájalo si da falsas alarmas. |
| Tiempo mínimo de contacto | Cuánto tiempo debe estar la mano en la cabeza para avisar. |
| Espera entre alertas | Evita recibir muchos mensajes seguidos. |
| Modelo de pose | *Liviano* para celulares lentos, *Pesado* si la persona está lejos de la cámara. |
| Detectar los dedos | Usa el modelo de manos además del de pose. Más preciso de cerca. |

## Límites conocidos (MVP)

- Analiza **una persona** por cámara.
- La cámara (o el navegador con la app) debe quedar **abierta y en primer plano**. Con la app minimizada, el navegador reduce la velocidad de análisis. La app pide que la pantalla no se apague.
- Visto de espaldas, o con la cabeza tapada, la pose es menos fiable.
- Todavía no distingue "rascar" (movimiento repetido) de "tocar". Avisa ante cualquier contacto sostenido de la mano con la cabeza.
- RTSP pendiente (ver arriba).

## Desarrollo

```bash
npm test     # pruebas de la regla mano-cabeza (cerca, lejos, pecho, mentón, saludo…)
npm run dev  # servidor que se reinicia al cambiar archivos
```

- `server.js`: servidor HTTP sin dependencias. Sirve la app, envía a Telegram y hace de puente para las cámaras IP.
- `public/js/rules.js`: la regla de detección y el control de repeticiones (probados en `test/`).
- `public/js/app.js`: cámara, MediaPipe, dibujo del esqueleto y alertas.
- `public/js/install.js`: botón Instalar.
- `public/sw.js` y `public/manifest.webmanifest`: lo que hace la app instalable.
