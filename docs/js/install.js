// Botón "Instalar":
//  - Chrome / Edge / Android: usa el evento beforeinstallprompt.
//  - iPhone / iPad (Safari no tiene ese evento): muestra instrucciones.
//  - Si la app ya está instalada (se abrió como app) el botón no aparece.

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: window-controls-overlay)').matches
    || window.navigator.standalone === true;
}

function isIOS() {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function setupInstallButton(button, iosDialog) {
  let deferredPrompt = null;
  const hide = () => { button.hidden = true; };

  if (isStandalone()) return hide();

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    button.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hide();
  });

  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', (e) => { if (e.matches) hide(); });

  if (isIOS()) button.hidden = false;

  button.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (outcome === 'accepted') hide();
      else button.hidden = true; // Chrome volverá a lanzar beforeinstallprompt si se puede
    } else if (isIOS()) {
      iosDialog.showModal();
    }
  });
}
