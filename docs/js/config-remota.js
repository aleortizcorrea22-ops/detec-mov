// Configuración remota de los tildes: el celular consulta cada tanto qué tildes le tocan
// (ver licencias/config-remota.js en el servidor) y las aplica SOLO si la revisión es más nueva
// que la última que aplicó. Lo que se cambia a mano en el celular queda hasta la próxima revisión.
// Solo tildes de detección (booleanos): nada de tokens ni datos del sistema.

export const CLAVES_REMOTAS = [
  'alertCabeza', 'includeFace', 'useHands', 'detectFalls', 'modoCama',
  'alertSento', 'alertLevanto', 'alertCamaEntra', 'alertCamaSale', 'alertCamina', 'alertQuieta', 'alertPideAyuda',
  'sendPhoto', 'beep', 'drawSkeleton',
];

/**
 * Aplica sobre `settings` (se modifica) lo que mandó el servidor.
 * @returns {{aplicada:boolean, rev:number, cambiados:string[]}}
 */
export function aplicarConfigRemota(settings, remota) {
  const rev = Number(remota?.rev) || 0;
  if (rev <= (Number(settings.remoteRev) || 0)) return { aplicada: false, rev, cambiados: [] };
  const cambiados = [];
  for (const k of CLAVES_REMOTAS) {
    const v = remota?.settings?.[k];
    if (typeof v === 'boolean' && settings[k] !== v) { settings[k] = v; cambiados.push(k); }
  }
  settings.remoteRev = rev;
  return { aplicada: true, rev, cambiados };
}
