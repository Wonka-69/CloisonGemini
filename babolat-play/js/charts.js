// Petits graphiques SVG sans dépendance, avec infobulles au survol et au focus clavier.

const NS = 'http://www.w3.org/2000/svg';
const tip = () => document.getElementById('tooltip');

function el(name, attrs = {}, parent) {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
}

function text(parent, x, y, str, attrs = {}) {
  const t = el('text', { x, y, ...attrs }, parent);
  t.textContent = str;
  return t;
}

/** Barre aux coins arrondis côté donnée (4px), base droite sur l'axe. */
function barPath(x, y, w, h, r = 4, horizontal = false) {
  if (h <= 0 || w <= 0) return '';
  if (!horizontal) {
    r = Math.min(r, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  r = Math.min(r, h / 2, w);
  return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}

/** Largeur réelle du conteneur : le SVG est dessiné à l'échelle 1, le texte garde sa taille lisible. */
function widthOf(container) {
  return Math.max(260, Math.round(container.clientWidth || 640));
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

/** rows: [{ label, value, color }] pour l'infobulle. */
function bindTooltip(node, title, rows) {
  const show = (ev) => {
    const t = tip();
    t.replaceChildren();
    const h = document.createElement('div');
    h.className = 't-title';
    h.textContent = title;
    t.appendChild(h);
    for (const r of rows) {
      const row = document.createElement('div');
      row.className = 't-row';
      if (r.color) {
        const k = document.createElement('span');
        k.className = 't-key';
        k.style.background = r.color;
        row.appendChild(k);
      }
      const b = document.createElement('b');
      b.textContent = r.value;
      row.appendChild(b);
      const s = document.createElement('span');
      s.textContent = r.label;
      row.appendChild(s);
      t.appendChild(row);
    }
    t.hidden = false;
    let x, y;
    if (ev && 'clientX' in ev && ev.clientX) { x = ev.clientX; y = ev.clientY; }
    else { const b = node.getBoundingClientRect(); x = b.left + b.width / 2; y = b.top; }
    const tw = t.offsetWidth, th = t.offsetHeight;
    t.style.left = `${Math.max(8, Math.min(window.innerWidth - tw - 8, x + 12))}px`;
    t.style.top = `${Math.max(8, y - th - 12)}px`;
  };
  const hide = () => { tip().hidden = true; };
  node.setAttribute('tabindex', '0');
  node.setAttribute('aria-label', `${title} : ${rows.map((r) => `${r.label} ${r.value}`).join(', ')}`);
  node.addEventListener('pointermove', show);
  node.addEventListener('pointerleave', hide);
  node.addEventListener('focus', show);
  node.addEventListener('blur', hide);
}

export function legend(container, series) {
  container.replaceChildren();
  for (const s of series) {
    const span = document.createElement('span');
    const i = document.createElement('i');
    i.style.background = s.color;
    span.append(i, document.createTextNode(s.label));
    container.appendChild(span);
  }
}

/**
 * Barres empilées verticales.
 * categories: [{ label, title }]   series: [{ key, label, color }]
 * values[c][key] = nombre
 */
export function stackedBars(container, { categories, series, values, unit = '' }) {
  container.replaceChildren();
  const W = widthOf(container), H = 240, m = { t: 12, r: 8, b: 26, l: 40 };
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' }, container);
  const totals = values.map((v) => series.reduce((a, s) => a + (v[s.key] || 0), 0));
  const max = niceMax(Math.max(0, ...totals));
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const y = (v) => m.t + ih - (v / max) * ih;
  for (let k = 0; k <= 4; k++) {
    const v = (max / 4) * k;
    el('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: k ? 'gridline' : 'baseline' }, svg);
    text(svg, m.l - 6, y(v) + 4, Math.round(v).toLocaleString('fr-FR'), { 'text-anchor': 'end' });
  }
  const n = categories.length;
  const band = iw / Math.max(n, 1);
  const bw = Math.max(4, Math.min(36, band * 0.62));
  const labelEvery = Math.ceil(n / Math.max(2, Math.floor(iw / 64)));
  categories.forEach((cat, i) => {
    const cx = m.l + band * i + band / 2;
    const g = el('g', { class: 'mark' }, svg);
    let acc = 0;
    const visible = series.filter((s) => (values[i][s.key] || 0) > 0);
    visible.forEach((s, j) => {
      const v = values[i][s.key] || 0;
      const y0 = y(acc), y1 = y(acc + v);
      const gap = j > 0 ? 2 : 0; // 2px d'espace entre segments
      const top = j === visible.length - 1;
      const h = Math.max(0, y0 - y1 - gap);
      if (top) el('path', { d: barPath(cx - bw / 2, y1, bw, h), fill: s.color }, g);
      else el('rect', { x: cx - bw / 2, y: y1, width: bw, height: h, fill: s.color }, g);
      acc += v;
    });
    // zone de survol plus grande que la barre
    el('rect', { x: m.l + band * i, y: m.t, width: band, height: ih, fill: 'transparent' }, g);
    bindTooltip(g, cat.title || cat.label, [
      ...series.map((s) => ({ label: s.label, value: `${(values[i][s.key] || 0).toLocaleString('fr-FR')}${unit}`, color: s.color })),
      { label: 'au total', value: `${totals[i].toLocaleString('fr-FR')}${unit}` },
    ]);
    if (i % labelEvery === 0) text(svg, cx, H - 8, cat.label, { 'text-anchor': 'middle' });
  });
}

/** Barres horizontales à une seule série, étiquetées directement. rows: [{ label, value, color, display }] */
export function hBars(container, rows, { max, suffix = '' } = {}) {
  container.replaceChildren();
  const rowH = 34, W = widthOf(container), labelW = 84, valueW = 92;
  const H = rows.length * rowH + 6;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' }, container);
  const mx = max ?? niceMax(Math.max(0, ...rows.map((r) => r.value)));
  const iw = W - labelW - valueW;
  el('line', { x1: labelW, x2: labelW, y1: 0, y2: H, class: 'baseline' }, svg);
  rows.forEach((r, i) => {
    const y = i * rowH + 6;
    const g = el('g', { class: 'mark' }, svg);
    text(g, labelW - 10, y + 17, r.label, { 'text-anchor': 'end', class: 'lbl' });
    const w = mx ? (r.value / mx) * iw : 0;
    el('path', { d: barPath(labelW, y + 4, w, 18, 4, true), fill: r.color || 'var(--s1)' }, g);
    text(g, labelW + w + 8, y + 17, r.display ?? `${r.value.toLocaleString('fr-FR')}${suffix}`, { class: 'val' });
    el('rect', { x: 0, y, width: W, height: rowH - 2, fill: 'transparent' }, g);
    bindTooltip(g, r.label, [{ label: r.tipLabel || '', value: r.display ?? `${r.value.toLocaleString('fr-FR')}${suffix}`, color: r.color }]);
  });
}

/** Barres 100 % empilées horizontales (part de chaque effet par type de coup). */
export function stacked100(container, { rows, series }) {
  container.replaceChildren();
  const rowH = 38, W = widthOf(container), labelW = 84;
  const H = rows.length * rowH + 4;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' }, container);
  const iw = W - labelW - 8;
  rows.forEach((r, i) => {
    const y = i * rowH + 4;
    const total = series.reduce((a, s) => a + (r.values[s.key] || 0), 0);
    const g = el('g', { class: 'mark' }, svg);
    text(g, labelW - 10, y + 19, r.label, { 'text-anchor': 'end', class: 'lbl' });
    let x = labelW;
    const parts = series.filter((s) => (r.values[s.key] || 0) > 0);
    parts.forEach((s, j) => {
      const share = total ? r.values[s.key] / total : 0;
      const w = Math.max(0, share * iw - (j < parts.length - 1 ? 2 : 0));
      const last = j === parts.length - 1;
      if (last) el('path', { d: barPath(x, y + 4, w, 22, 4, true), fill: s.color }, g);
      else el('rect', { x, y: y + 4, width: w, height: 22, fill: s.color }, g);
      if (w > 44) text(g, x + w / 2, y + 19, `${Math.round(share * 100)} %`, { 'text-anchor': 'middle', style: 'fill:#fff;font-weight:600;font-size:11px' });
      x += share * iw;
    });
    el('rect', { x: 0, y, width: W, height: rowH - 2, fill: 'transparent' }, g);
    bindTooltip(g, r.label, series.map((s) => ({
      label: s.label,
      value: total ? `${Math.round(((r.values[s.key] || 0) / total) * 100)} %` : '–',
      color: s.color,
    })));
  });
}

/** Carte de chaleur 3x3 dans la silhouette d'un tamis. cells: 9 nombres. */
export function impactMap(container, cells) {
  container.replaceChildren();
  const W = 240, H = 300;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' }, container);
  const total = cells.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...cells);
  const cx = 120, cy = 128, rx = 96, ry = 116;
  const clipId = `clip-${Math.random().toString(36).slice(2)}`;
  const defs = el('defs', {}, svg);
  const cp = el('clipPath', { id: clipId }, defs);
  el('ellipse', { cx, cy, rx, ry }, cp);
  const g = el('g', { 'clip-path': `url(#${clipId})` }, svg);
  const names = ['Haut gauche', 'Haut centre', 'Haut droite', 'Gauche', 'Centre (sweet spot)', 'Droite', 'Bas gauche', 'Bas centre', 'Bas droite'];
  const cw = (rx * 2) / 3, ch = (ry * 2) / 3;
  cells.forEach((v, i) => {
    const r = Math.floor(i / 3), c = i % 3;
    const step = v === 0 ? 0 : 1 + Math.round((v / max) * 6);
    const rect = el('rect', {
      x: cx - rx + c * cw + 1, y: cy - ry + r * ch + 1, width: cw - 2, height: ch - 2,
      fill: `var(--seq-${step})`, class: 'mark',
    }, g);
    const pct = total ? Math.round((v / total) * 100) : 0;
    bindTooltip(rect, names[i], [{ label: 'des impacts', value: `${pct} %` }, { label: 'coups', value: v.toLocaleString('fr-FR') }]);
    // Les coins sont rognés par l'ellipse : on rapproche leur étiquette du centre.
    const pull = r !== 1 && c !== 1 ? 0.22 : 0;
    const lx = cx - rx + c * cw + cw / 2 + (1 - c) * cw * pull;
    const ly = cy - ry + r * ch + ch / 2 + 4 + (1 - r) * ch * pull;
    const tx = text(svg, lx, ly, `${pct} %`, { 'text-anchor': 'middle', 'pointer-events': 'none' });
    tx.setAttribute('style', `fill:var(--seq-ink-${step});font-weight:600;font-size:13px`);
  });
  el('ellipse', { cx, cy, rx, ry, fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': 3 }, svg);
  el('path', { d: `M${cx - 14},${cy + ry - 2} L${cx - 8},${H - 6} H${cx + 8} L${cx + 14},${cy + ry - 2}`, fill: 'var(--ink-2)' }, svg);
}

export function hideTooltip() {
  const t = tip();
  if (t) t.hidden = true;
}
