/** Tiny DOM helpers, so UI code does not read like a wall of `createElement`. */

export type Attrs = Record<string, string | number | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: { className?: string; text?: string; attrs?: Attrs; html?: string } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = options.text;
  if (options.html !== undefined) node.innerHTML = options.html;

  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      if (value === undefined || value === false) continue;
      node.setAttribute(key, value === true ? '' : String(value));
    }
  }
  return node;
}

export interface ButtonOptions {
  readonly className?: string;
  readonly title?: string;
  readonly onClick: () => void;
}

export function button(label: string, options: ButtonOptions): HTMLButtonElement {
  const node = el('button', {
    className: options.className ?? 'btn',
    text: label,
    attrs: { type: 'button', ...(options.title ? { title: options.title } : {}) },
  });
  node.addEventListener('click', options.onClick);
  return node;
}

/** Shows or hides an element via the `hidden` attribute (never `style`). */
export function setHidden(node: HTMLElement, hidden: boolean): void {
  if (hidden) node.setAttribute('hidden', '');
  else node.removeAttribute('hidden');
}

/** Formats a vector for the debug HUD, e.g. `( 12.34, -0.50, 3.00)`. */
export function formatVector(v: { x: number; y: number; z: number }, decimals = 2): string {
  const format = (value: number): string => (Number.isFinite(value) ? value.toFixed(decimals) : 'NaN');
  return `${format(v.x).padStart(8)} ${format(v.y).padStart(8)} ${format(v.z).padStart(8)}`;
}

export function formatNumber(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return 'NaN';
  return value.toFixed(decimals);
}
