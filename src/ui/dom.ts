type Child = Node | string | null | undefined | false;

/** Minimaler DOM-Helfer; setzt Text immer über textContent/createTextNode (kein innerHTML). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { class?: string; id?: string; onclick?: (e: MouseEvent) => void; disabled?: boolean; title?: string; style?: string } = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.id) el.id = props.id;
  if (props.title) el.title = props.title;
  if (props.style) el.setAttribute('style', props.style);
  if (props.onclick) el.addEventListener('click', props.onclick as EventListener);
  if (props.disabled && 'disabled' in el) (el as unknown as HTMLButtonElement).disabled = true;
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function fmt(n: number): string {
  return Math.round(n).toLocaleString('de-DE');
}

/** Text in die Zwischenablage kopieren (mit Ersatzweg für ältere Browser). Liefert, ob es geklappt hat. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
