// 小工具：建立 DOM 元素
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export function button(className: string, text: string, onClick: () => void, parent?: HTMLElement) {
  const b = el('button', className, text, parent);
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}
