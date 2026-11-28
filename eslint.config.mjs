// Config mínima solo para encontrar errores reales (variables sin declarar, no usadas,
// etc.) en el código del navegador (docs/js, lo que se publica en GitHub Pages). No
// cambia nada del programa ni se publica: es una herramienta de desarrollo nada más.
export default [
  {
    ignores: ['docs/js/qrcode-lib.js'], // librería externa vendorizada, no es nuestro código
    files: ['docs/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        window: 'readonly', document: 'readonly', navigator: 'readonly', localStorage: 'readonly',
        console: 'readonly', fetch: 'readonly', performance: 'readonly', crypto: 'readonly',
        requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly', location: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly',
        self: 'readonly', caches: 'readonly', URL: 'readonly', URLSearchParams: 'readonly', Blob: 'readonly',
        FormData: 'readonly', Image: 'readonly', Audio: 'readonly', Notification: 'readonly',
        RTCPeerConnection: 'readonly', MediaRecorder: 'readonly', MediaStream: 'readonly', WebSocket: 'readonly',
        alert: 'readonly', confirm: 'readonly', prompt: 'readonly', createImageBitmap: 'readonly',
        atob: 'readonly', btoa: 'readonly', AbortController: 'readonly',
        Peer: 'readonly', qrcode: 'readonly', // librerías cargadas por <script> desde CDN (peerjs, qrcode)
      },
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', varsIgnorePattern: '^_' }],
      'no-redeclare': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      'no-unreachable': 'error',
      'no-fallthrough': 'error',
      'no-const-assign': 'error',
      'no-self-assign': 'error',
      'no-cond-assign': 'error',
    },
  },
  {
    files: ['docs/sw.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { self: 'readonly', caches: 'readonly', fetch: 'readonly', URL: 'readonly', console: 'readonly' },
    },
    rules: { 'no-undef': 'error', 'no-unused-vars': 'warn' },
  },
];
