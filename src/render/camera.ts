/**
 * Weiche Kamera, die der Figur folgt (bildratenunabhängig).
 * Der Abstand zur Figur ist auf `maxLag` begrenzt, damit sie auch bei extremem Tempo
 * (Tausende Felder pro Sekunde) nie aus dem Bild läuft.
 */
export function followCamera(cam: number, target: number, dt: number, maxLag: number, smoothing = 9): number {
  let next = cam + (target - cam) * (1 - Math.exp(-dt * smoothing));
  const rest = target - next;
  if (Math.abs(rest) > maxLag) next = target - Math.sign(rest) * maxLag;
  return next;
}
