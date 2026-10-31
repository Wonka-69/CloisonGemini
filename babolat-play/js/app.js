import {
  store, normalizeSession, totalStrokes, STROKES, SPINS, toCsv, fromCsv, fromJson, demoSessions,
} from './store.js';
import { stackedBars, hBars, stacked100, impactMap, legend, hideTooltip } from './charts.js';
import { RacketConnection, bluetoothSupport } from './ble.js';
import {
  shortUuid, fromHex, KNOWN_CHARS, runDecoders, analyzeCapture, asciiPreview, normalizeUuid,
} from './protocol.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmtInt = (n) => Math.round(n).toLocaleString('fr-FR');
const fmtDate = (iso, opts = { day: 'numeric', month: 'short' }) => new Date(iso).toLocaleDateString('fr-FR', opts);
const fmtDateTime = (iso) => new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const SOURCE_LABEL = { manual: 'manuelle', import: 'importée', racket: 'raquette', demo: 'démo' };

function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._h);
  toast._h = setTimeout(() => { t.hidden = true; }, ms);
}

function download(name, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// =====================================================================
// Navigation
// =====================================================================
function showView(name) {
  for (const b of $$('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.view === name));
  for (const v of $$('.view')) v.toggleAttribute('data-active', v.id === `view-${name}`);
  hideTooltip();
  if (name === 'dashboard') renderDashboard();
  if (name === 'sessions') renderSessions();
  try { sessionStorage.setItem('playtracker.view', name); } catch { /* sans importance */ }
}
$$('.tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-goto]');
  if (go) showView(go.dataset.goto);
});

// =====================================================================
// Tableau de bord
// =====================================================================
let range = store.settings().range ?? 0;
let tables = {};

function filtered() {
  const all = store.sessions();
  if (!range) return all;
  const from = Date.now() - range * 86400000;
  return all.filter((s) => new Date(s.date).getTime() >= from);
}

function avg(list) {
  const v = list.filter((x) => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function tile(label, value, unit = '', sub = '') {
  const d = document.createElement('div');
  d.className = 'tile';
  const l = document.createElement('div'); l.className = 'label'; l.textContent = label;
  const v = document.createElement('div'); v.className = 'value'; v.textContent = value;
  if (unit) { const u = document.createElement('span'); u.className = 'unit'; u.textContent = unit; v.appendChild(u); }
  d.append(l, v);
  if (sub) { const s = document.createElement('div'); s.className = 'sub'; s.textContent = sub; d.appendChild(s); }
  return d;
}

function renderDashboard() {
  for (const c of $$('.filters .chip')) c.setAttribute('aria-pressed', String(Number(c.dataset.range) === range));
  const all = store.sessions();
  const list = filtered();
  $('#emptyState').hidden = all.length > 0;
  $('#dashContent').hidden = all.length === 0;
  if (!all.length) return;

  // ---- tuiles ----
  const strokes = list.reduce((a, s) => a + totalStrokes(s), 0);
  const minutes = list.reduce((a, s) => a + (s.durationMin || 0), 0);
  const active = list.reduce((a, s) => a + (s.activeMin || 0), 0);
  const sweet = avg(list.map((s) => s.sweetSpotPct));
  const powerAll = avg(list.flatMap((s) => STROKES.map(({ key }) => s.power[key]).filter((v) => v != null)));
  const rally = Math.max(0, ...list.map((s) => s.longestRally || 0));
  const tiles = $('#tiles');
  tiles.replaceChildren(
    tile('Séances', fmtInt(list.length), '', range ? `sur ${range} jours` : 'au total'),
    tile('Coups', fmtInt(strokes), '', list.length ? `${fmtInt(strokes / list.length)} par séance` : ''),
    tile('Temps de jeu', minutes >= 120 ? (minutes / 60).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : fmtInt(minutes), minutes >= 120 ? 'h' : 'min', active ? `dont ${fmtInt(active)} min actives` : ''),
    tile('Sweet spot', sweet == null ? '–' : fmtInt(sweet), sweet == null ? '' : '%', 'des impacts centrés'),
    tile('Puissance moy.', powerAll == null ? '–' : fmtInt(powerAll), powerAll == null ? '' : '/100', rally ? `plus long échange : ${rally} coups` : ''),
  );

  // ---- coups par séance ----
  const recent = list.slice(-20);
  const cats = recent.map((s) => ({ label: fmtDate(s.date), title: fmtDateTime(s.date) }));
  const vals = recent.map((s) => s.strokes);
  legend($('#legendPerSession'), STROKES);
  if (recent.length) stackedBars($('#chartPerSession'), { categories: cats, series: STROKES, values: vals });
  else $('#chartPerSession').textContent = 'Aucune séance sur cette période.';
  tables.perSession = {
    title: 'Coups par séance',
    head: ['Date', ...STROKES.map((s) => s.label), 'Total'],
    rows: recent.map((s) => [fmtDateTime(s.date), ...STROKES.map(({ key }) => s.strokes[key]), totalStrokes(s)]),
  };

  // ---- répartition ----
  const byType = STROKES.map((s) => ({ ...s, value: list.reduce((a, x) => a + (x.strokes[s.key] || 0), 0) }));
  const tot = byType.reduce((a, b) => a + b.value, 0);
  hBars($('#chartByType'), byType.map((s) => ({
    label: s.label, value: s.value, color: s.color, tipLabel: 'coups',
    display: `${fmtInt(s.value)} · ${tot ? Math.round((s.value / tot) * 100) : 0} %`,
  })));
  tables.byType = {
    title: 'Répartition des coups',
    head: ['Coup', 'Nombre', 'Part'],
    rows: byType.map((s) => [s.label, s.value, `${tot ? Math.round((s.value / tot) * 100) : 0} %`]),
  };

  // ---- impact ----
  const withImpact = list.filter((s) => s.impact);
  const cells = Array(9).fill(0);
  for (const s of withImpact) s.impact.forEach((v, i) => { cells[i] += v; });
  if (withImpact.length) impactMap($('#chartImpact'), cells);
  else $('#chartImpact').textContent = "Pas encore de données d'impact (elles viennent du capteur ou d'un import).";
  const zones = ['Haut gauche', 'Haut centre', 'Haut droite', 'Gauche', 'Centre', 'Droite', 'Bas gauche', 'Bas centre', 'Bas droite'];
  const ctot = cells.reduce((a, b) => a + b, 0);
  tables.impact = {
    title: "Zone d'impact",
    head: ['Zone', 'Coups', 'Part'],
    rows: zones.map((z, i) => [z, cells[i], `${ctot ? Math.round((cells[i] / ctot) * 100) : 0} %`]),
  };

  // ---- puissance ----
  const pw = STROKES.map((s) => ({ ...s, value: avg(list.map((x) => x.power[s.key])) }));
  const pwRows = pw.filter((p) => p.value != null);
  if (pwRows.length) {
    hBars($('#chartPower'), pwRows.map((p) => ({ label: p.label, value: p.value, color: p.color, tipLabel: 'indice moyen', display: `${fmtInt(p.value)} / 100` })), { max: 100 });
  } else $('#chartPower').textContent = 'Pas encore de données de puissance.';
  tables.power = { title: 'Puissance moyenne', head: ['Coup', 'Indice /100'], rows: pw.map((p) => [p.label, p.value == null ? '–' : fmtInt(p.value)]) };

  // ---- effets ----
  const spinRows = STROKES.filter((s) => s.key !== 'smash').map((s) => {
    const values = { topspin: 0, flat: 0, slice: 0 };
    for (const x of list) for (const sp of SPINS) values[sp.key] += x.spin?.[s.key]?.[sp.key] || 0;
    return { label: s.label, values };
  }).filter((r) => r.values.topspin + r.values.flat + r.values.slice > 0);
  legend($('#legendSpin'), SPINS);
  if (spinRows.length) stacked100($('#chartSpin'), { rows: spinRows, series: SPINS });
  else $('#chartSpin').textContent = "Pas encore de données d'effet.";
  tables.spin = {
    title: 'Effets par coup',
    head: ['Coup', ...SPINS.map((s) => s.label)],
    rows: spinRows.map((r) => [r.label, ...SPINS.map((s) => r.values[s.key])]),
  };
}

$$('.filters .chip').forEach((c) => c.addEventListener('click', () => {
  range = Number(c.dataset.range);
  store.saveSettings({ range });
  renderDashboard();
}));

$$('[data-table]').forEach((b) => b.addEventListener('click', () => openTable(tables[b.dataset.table])));

function openTable(t) {
  if (!t) return;
  $('#tableTitle').textContent = t.title;
  const table = document.createElement('table');
  const thead = table.createTHead().insertRow();
  for (const h of t.head) { const th = document.createElement('th'); th.textContent = h; thead.appendChild(th); }
  const tb = table.createTBody();
  for (const r of t.rows) {
    const tr = tb.insertRow();
    for (const c of r) tr.insertCell().textContent = typeof c === 'number' ? fmtInt(c) : c;
  }
  $('#tableBody').replaceChildren(table);
  $('#tableDialog').showModal();
}

$('#loadDemo').addEventListener('click', () => {
  store.addMany(demoSessions());
  toast('Données de démo chargées. Tu pourras les supprimer depuis « Séances ».');
  renderDashboard();
});

// =====================================================================
// Séances
// =====================================================================
function renderSessions() {
  const list = store.sessions().slice().reverse();
  const box = $('#sessionList');
  box.replaceChildren();
  if (list.some((s) => s.source === 'demo')) {
    const b = document.createElement('button');
    b.className = 'btn ghost';
    b.textContent = 'Supprimer les données de démo';
    b.addEventListener('click', () => { store.removeSource('demo'); renderSessions(); });
    box.appendChild(b);
  }
  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Aucune séance enregistrée.';
    box.appendChild(p);
    return;
  }
  for (const s of list) {
    const card = document.createElement('div');
    card.className = 'session';
    const when = document.createElement('div');
    when.className = 'when';
    when.textContent = fmtDateTime(s.date);
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = SOURCE_LABEL[s.source] || s.source;
    when.appendChild(badge);
    const actions = document.createElement('div');
    actions.className = 'actions';
    const edit = document.createElement('button');
    edit.className = 'link'; edit.textContent = 'Modifier';
    edit.addEventListener('click', () => openSessionForm(s));
    const del = document.createElement('button');
    del.className = 'link'; del.textContent = 'Supprimer';
    del.addEventListener('click', () => {
      if (confirm('Supprimer cette séance ?')) { store.remove(s.id); renderSessions(); }
    });
    actions.append(edit, del);
    const meta = document.createElement('div');
    meta.className = 'meta';
    const parts = [
      s.durationMin != null ? `${s.durationMin} min` : null,
      `${fmtInt(totalStrokes(s))} coups`,
      STROKES.map(({ key, label }) => `${label.toLowerCase()} ${s.strokes[key]}`).join(' · '),
      s.sweetSpotPct != null ? `sweet spot ${s.sweetSpotPct} %` : null,
    ].filter(Boolean);
    meta.textContent = parts.join(' — ') + (s.notes ? ` — ${s.notes}` : '');
    card.append(when, actions, meta);
    box.appendChild(card);
  }
}

let editing = null;
function openSessionForm(s = null) {
  editing = s;
  const f = $('#sessionForm');
  f.reset();
  $('#sessionFormTitle').textContent = s ? 'Modifier la séance' : 'Nouvelle séance';
  const d = s ? new Date(s.date) : new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  f.date.value = d.toISOString().slice(0, 16);
  if (s) {
    for (const k of ['durationMin', 'activeMin', 'longestRally', 'sweetSpotPct']) f[k].value = s[k] ?? '';
    for (const { key } of STROKES) {
      f[`s_${key}`].value = s.strokes[key] ?? 0;
      f[`p_${key}`].value = s.power[key] ?? '';
    }
    f.notes.value = s.notes || '';
  }
  $('#sessionDialog').showModal();
}
$('#newSession').addEventListener('click', () => openSessionForm());
$('#sessionDialog').addEventListener('close', () => {
  if ($('#sessionDialog').returnValue !== 'save') return;
  const f = $('#sessionForm');
  const data = {
    ...(editing || {}),
    date: new Date(f.date.value).toISOString(),
    source: editing?.source || 'manual',
    durationMin: f.durationMin.value,
    activeMin: f.activeMin.value,
    longestRally: f.longestRally.value,
    sweetSpotPct: f.sweetSpotPct.value,
    notes: f.notes.value,
    strokes: Object.fromEntries(STROKES.map(({ key }) => [key, f[`s_${key}`].value])),
    power: Object.fromEntries(STROKES.map(({ key }) => [key, f[`p_${key}`].value])),
  };
  store.upsert(normalizeSession(data));
  editing = null;
  renderSessions();
  toast('Séance enregistrée');
});

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const sessions = /\.csv$/i.test(file.name) || file.type === 'text/csv' ? fromCsv(text) : fromJson(text);
    const n = store.addMany(sessions);
    toast(`${n} séance(s) importée(s)`);
    renderSessions();
  } catch (err) {
    toast(`Import impossible : ${err.message}`);
  }
});
const stamp = () => new Date().toISOString().slice(0, 10);
$('#exportJson').addEventListener('click', () => download(`seances-${stamp()}.json`, JSON.stringify({ sessions: store.sessions() }, null, 2), 'application/json'));
$('#exportCsv').addEventListener('click', () => download(`seances-${stamp()}.csv`, toCsv(store.sessions()), 'text/csv'));

// =====================================================================
// Raquette (Bluetooth)
// =====================================================================
const racket = new RacketConnection();
const support = bluetoothSupport();
if (!support.ok) {
  $('#bleUnsupported').hidden = false;
  $('#bleUnsupportedMsg').textContent = support.reason;
  $('#btnScan').disabled = true;
}

racket.addEventListener('status', ({ detail }) => {
  $('#connBadge').dataset.state = detail.state;
  $('#connLabel').textContent = detail.label;
  const on = detail.state === 'on';
  $('#btnDisconnect').disabled = !on;
  $('#btnSync').disabled = !on;
  $('#btnScan').disabled = detail.state === 'busy' || !support.ok;
  refreshWritable();
});

racket.addEventListener('info', ({ detail }) => {
  const dl = $('#deviceInfo');
  dl.replaceChildren();
  const add = (k, v) => {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  };
  add('Nom', racket.device?.name || '(sans nom)');
  const entries = Object.entries(detail.info);
  for (const [k, v] of entries) add(k, v);
  if (!entries.length) add('Remarque', "La raquette n'expose pas de service d'information standard.");
});

racket.addEventListener('tree', ({ detail }) => {
  const box = $('#gattTree');
  box.classList.remove('muted');
  box.replaceChildren();
  if (!detail.services.length) {
    box.textContent = "Aucun service accessible. Repère les UUID des services avec l'appli nRF Connect, " +
      'ajoute-les dans « Labo capteur › Services supplémentaires », puis reconnecte.';
    return;
  }
  for (const s of detail.services) {
    const div = document.createElement('div');
    div.className = 'svc';
    const name = document.createElement('div');
    name.className = 'svc-name';
    name.textContent = s.name || 'Service inconnu';
    const u = document.createElement('div');
    u.className = 'uuid';
    u.textContent = s.uuid;
    const ul = document.createElement('ul');
    for (const c of s.chars) {
      const li = document.createElement('li');
      const n = document.createElement('div');
      n.textContent = c.name || shortUuid(c.uuid);
      const p = document.createElement('div');
      p.className = 'props';
      p.textContent = c.props.join(' · ') + (c.subscribed ? ' · abonné' : '');
      li.append(n, p);
      if (c.value) {
        const v = document.createElement('div');
        v.className = 'hexval';
        v.textContent = c.decoded ? `${c.decoded}  (${c.value})` : c.value;
        li.appendChild(v);
      }
      ul.appendChild(li);
    }
    div.append(name, u, ul);
    box.appendChild(div);
  }
});

$('#btnScan').addEventListener('click', async () => {
  try {
    const ok = await racket.connect(store.settings().extraUuids || []);
    if (ok) {
      toast('Raquette connectée');
      renderLog();
    }
  } catch (e) {
    toast(`Connexion impossible : ${e.message}`, 5000);
    racket.disconnect();
  }
});
$('#btnDisconnect').addEventListener('click', () => racket.disconnect());
$('#btnSync').addEventListener('click', async () => {
  try {
    await racket.discover();
  } catch (e) {
    toast(`Lecture impossible : ${e.message}`);
    return;
  }
  applyDecoder(racket.capture);
});

function applyDecoder(capture) {
  const res = runDecoders(capture);
  if (res.sessions.length) {
    const n = store.addMany(res.sessions.map((s) => normalizeSession({ source: 'racket', ...s })));
    toast(`${n} nouvelle(s) séance(s) récupérée(s)`);
  } else {
    toast(res.message, 6000);
    openTable(analysisTable(capture));
  }
}

function analysisTable(capture) {
  const rows = [];
  for (const a of analyzeCapture(capture)) {
    const varying = a.positions.filter((p) => p.kind !== 'constant');
    rows.push([
      a.name,
      a.count,
      a.lengths.join(', '),
      a.positions.filter((p) => p.kind === 'constant').map((p) => p.index).join(' ') || '–',
      varying.map((p) => `${p.index}${p.kind === 'compteur' ? '↑' : ''}`).join(' ') || '–',
    ]);
  }
  return {
    title: 'Analyse de la capture',
    head: ['Caractéristique', 'Paquets', 'Tailles (octets)', 'Octets fixes', 'Octets variables (↑ = compteur)'],
    rows: rows.length ? rows : [['Aucun paquet reçu', '', '', '', '']],
  };
}

// =====================================================================
// Labo : journal des paquets
// =====================================================================
const MAX_ROWS = 500;
const lastByChar = new Map();

function packetRow(p) {
  const row = document.createElement('div');
  row.className = `pkt ${p.dir}`;
  const t = document.createElement('span');
  t.className = 't';
  const d = new Date(p.t);
  t.textContent = `${d.toLocaleTimeString('fr-FR')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  const c = document.createElement('span');
  c.className = 'c';
  c.textContent = (KNOWN_CHARS[p.chr] ? KNOWN_CHARS[p.chr].slice(0, 8) : shortUuid(p.chr).slice(0, 8));
  c.title = p.chr;
  const n = document.createElement('span');
  n.className = 'n';
  n.textContent = { in: '←', read: 'R', out: '→' }[p.dir];
  const h = document.createElement('span');
  h.className = 'h';
  const bytes = p.hex ? p.hex.split(' ') : [];
  const prev = p.dir === 'out' ? null : lastByChar.get(p.chr);
  bytes.forEach((b, i) => {
    if (i) h.appendChild(document.createTextNode(' '));
    if (prev && prev[i] !== b) {
      const m = document.createElement('mark');
      m.textContent = b;
      h.appendChild(m);
    } else h.appendChild(document.createTextNode(b));
  });
  const raw = fromHex(p.hex);
  if (raw && raw.length) h.title = asciiPreview(raw);
  if (p.dir !== 'out') lastByChar.set(p.chr, bytes);
  row.append(t, c, n, h);
  return row;
}

function renderLog() {
  const log = $('#packetLog');
  lastByChar.clear();
  log.replaceChildren();
  const pkts = racket.capture.packets.slice(-MAX_ROWS);
  if (!pkts.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = "Aucun paquet. Connecte la raquette, puis fais quelques gestes : chaque notification s'affichera ici.";
    log.appendChild(e);
  }
  for (const p of pkts) log.appendChild(packetRow(p));
  $('#pktCount').textContent = racket.capture.packets.length;
}

racket.addEventListener('packet', ({ detail }) => {
  const log = $('#packetLog');
  log.querySelector('.empty')?.remove();
  const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
  log.appendChild(packetRow(detail));
  while (log.children.length > MAX_ROWS) log.firstChild.remove();
  if (stick) log.scrollTop = log.scrollHeight;
  $('#pktCount').textContent = racket.capture.packets.length;
});

$('#clearLog').addEventListener('click', () => {
  racket.capture.packets = [];
  renderLog();
});
$('#exportCapture').addEventListener('click', () => {
  download(`capture-raquette-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify(racket.capture, null, 1), 'application/json');
});
$('#importCapture').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const cap = JSON.parse(await file.text());
    if (!Array.isArray(cap.packets)) throw new Error('fichier de capture invalide');
    racket.capture = cap;
    renderLog();
    toast(`Capture chargée : ${cap.packets.length} paquets`);
  } catch (err) {
    toast(`Lecture impossible : ${err.message}`);
  }
});
$('#runDecoder').addEventListener('click', () => applyDecoder(racket.capture));

function refreshWritable() {
  const sel = $('#writeChar');
  const list = racket.connected ? racket.writableChars() : [];
  sel.replaceChildren();
  if (!list.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = 'Aucune caractéristique inscriptible';
    sel.appendChild(o);
  }
  for (const c of list) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.label;
    sel.appendChild(o);
  }
  $('#btnWrite').disabled = !list.length;
}
$('#btnWrite').addEventListener('click', async () => {
  const bytes = fromHex($('#writeHex').value);
  if (!bytes) { toast('Saisis des octets hexadécimaux, ex. « 01 a5 ff »'); return; }
  try {
    await racket.write($('#writeChar').value, bytes);
  } catch (e) {
    toast(`Envoi refusé : ${e.message}`);
  }
});

// Services supplémentaires
const uuidBox = $('#extraUuids');
uuidBox.value = (store.settings().extraUuids || []).join('\n');
$('#saveUuids').addEventListener('click', () => {
  const lines = uuidBox.value.split(/[\s,;]+/).filter(Boolean);
  const valid = lines.map(normalizeUuid).filter(Boolean);
  store.saveSettings({ extraUuids: valid });
  uuidBox.value = valid.join('\n');
  $('#uuidMsg').textContent = `${valid.length} UUID enregistré(s)` + (valid.length < lines.length ? ` — ${lines.length - valid.length} ignoré(s), format invalide` : '') + '. Reconnecte la raquette.';
});

// =====================================================================
// Démarrage
// =====================================================================
let startView = 'dashboard';
try { startView = sessionStorage.getItem('playtracker.view') || 'dashboard'; } catch { /* rien */ }
showView(startView);
renderLog();
window.addEventListener('scroll', hideTooltip, { passive: true });
let resizeTimer;
let lastWidth = innerWidth;
window.addEventListener('resize', () => {
  if (innerWidth === lastWidth) return; // la barre d'adresse mobile change seulement la hauteur
  lastWidth = innerWidth;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { if ($('#view-dashboard').hasAttribute('data-active')) renderDashboard(); }, 150);
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => { /* hors-ligne indisponible, pas bloquant */ });
}
