/**
 * Tiny imperative DOM-building helper (Phase 13A vanilla migration) — deliberately NOT a
 * virtual-DOM/component framework, just a terser `document.createElement` +
 * `element.append`. Text content always goes through `textContent`/`Text` nodes, never
 * `innerHTML`, so user-controlled strings (usernames, document names, chat-free but
 * still untrusted input) can never be interpreted as markup.
 */
export function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (key === 'class') el.className = value;
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, String(value));
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Removes every child node — the vanilla equivalent of "re-render this subtree". */
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Replaces `el`'s children with `children` in one go. */
export function setChildren(el, children) {
  clear(el);
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}
