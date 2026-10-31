import {
  store, normalizeSession, totalStrokes, STROKES, SPINS, toCsv, fromCsv, demoSessions, buildBackup, restoreBackup,
} from './store.js';
import { stackedBars, hBars, stacked100, impactMap, legend, hideTooltip, lineChart, rangeBars } from './charts.js';
import * as AN from './analysis.js';
import { parseLog, calibrate, correctClock, toAppSession } from './babolat-log.js';
import { RacketConnection, bluetoothSupport } from './ble.js';
import { SerialLink, serialSupport } from './serial.js';
import {
  shortUuid, fromHex, KNOWN_CHARS, runDecoders, analyzeCapture, asciiPreview, normalizeUuid,
} from './protocol.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const fmtInt = (n) => Math.round(n).toLocaleString('fr-FR');
const fmtKmh = (n) => (n == null ? '–' : `${Math.round(n).toLocaleString('fr-FR')} km/h`);
const fmtDate = (iso, opts = { day: 'numeric', month: 'short' }) => new Date(iso).toLocaleDateString('fr-FR', opts);
const fmtDateTime = (iso) => new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const SOURCE_LABEL = { manual: 'manuelle', import: 'importée', racket: 'raquette', demo: 'démo' };
const TYPE_LABEL = Object.fromEntries(AN.SESSION_TYPES.map((t) => [t.key, t.label]));
const SURFACE_LABEL = Object.fromEntries(AN.SURFACES.map((t) => [t.key, t.label]));
const STROKE_LABEL = { forehand: 'Coup droit', backhand: 'Revers', serve: 'Service', volley: 'Volée', smash: 'Smash' };
const STROKE_COLOR = { forehand: 'var(--s1)', backhand: 'var(--s2)', serve: 'var(--s3)', volley: 'var(--s4)', smash: 'var(--s5)' };

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

// Chargement des données (IndexedDB) avant tout affichage.
await store.init({ onError: (e) => toast(`Enregistrement impossible : ${e.message}`, 6000) });

// =====================================================================
// Navigation
// =====================================================================
function showView(name) {
  for (const b of $$('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.view === name));
  for (const v of $$('.view')) v.toggleAttribute('data-active', v.id === `view-${name}`);
  hideTooltip();
  if (name === 'dashboard') renderDashboard();
  if (name === 'progress') renderProgress();
  if (name === 'sessions') { renderSessions(); renderStorageInfo(); }
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

let typeFilter = store.settings().typeFilter || '';
let surfaceFilter = store.settings().surfaceFilter || '';
function filtered() {
  let list = store.sessions();
  if (range) {
    const from = Date.now() - range * 86400000;
    list = list.filter((s) => new Date(s.date).getTime() >= from);
  }
  if (typeFilter) list = list.filter((s) => (typeFilter === 'none' ? !s.type : s.type === typeFilter));
  if (surfaceFilter) list = list.filter((s) => s.surface === surfaceFilter);
  return list;
}

/** Petite statistique dans une carte. */
function mini(label, value, unit = '', sub = '') {
  const d = document.createElement('div');
  d.className = 'mini';
  const l = document.createElement('div'); l.className = 'label'; l.textContent = label;
  const v = document.createElement('div'); v.className = 'value'; v.textContent = value;
  if (unit) { const u = document.createElement('small'); u.textContent = unit; v.appendChild(u); }
  d.append(l, v);
  if (sub) { const s2 = document.createElement('div'); s2.className = 'sub'; s2.textContent = sub; d.appendChild(s2); }
  return d;
}
const fmt1 = (v) => (v == null ? '–' : v.toLocaleString('fr-FR', { maximumFractionDigits: 1 }));
const kmhOrDash = (v) => (v == null ? '–' : fmtInt(v));

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
  renderBanners();
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
  const serveMax = Math.max(0, ...list.map((s) => s.maxSpeed.serve || 0)) || null;
  const serveAvg = avg(list.map((s) => s.speed.serve));
  const fhAvg = avg(list.map((s) => s.speed.forehand));
  const bhAvg = avg(list.map((s) => s.speed.backhand));
  const tiles = $('#tiles');
  tiles.replaceChildren(
    tile('Séances', fmtInt(list.length), '', range ? `sur ${range} jours` : 'au total'),
    tile('Coups', fmtInt(strokes), '', list.length ? `${fmtInt(strokes / list.length)} par séance` : ''),
    tile('Temps de jeu', minutes >= 120 ? (minutes / 60).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : fmtInt(minutes), minutes >= 120 ? 'h' : 'min', active ? `dont ${fmtInt(active)} min actives` : ''),
    tile('Service le plus rapide', serveMax == null ? '–' : fmtInt(serveMax), serveMax == null ? '' : 'km/h', serveAvg == null ? '' : `moyenne ${fmtKmh(serveAvg)}`),
    tile('Coup droit moyen', fhAvg == null ? '–' : fmtInt(fhAvg), fhAvg == null ? '' : 'km/h', bhAvg == null ? '' : `revers ${fmtKmh(bhAvg)}`),
  );

  // ---- coups par séance ----
  const recent = list.slice(-20);
  const cats = recent.map((s) => ({ label: fmtDate(s.date), title: fmtDateTime(s.date) }));
  const vals = recent.map((s) => s.strokes);
  // Types de coups jamais enregistrés sur la période (ex. smash, non détecté par la raquette) : masqués.
  const usedStrokes = STROKES.filter((st) => list.some((x) => x.strokes[st.key]));
  legend($('#legendPerSession'), usedStrokes);
  if (recent.length) stackedBars($('#chartPerSession'), { categories: cats, series: usedStrokes, values: vals });
  else $('#chartPerSession').textContent = 'Aucune séance sur cette période.';
  tables.perSession = {
    title: 'Coups par séance',
    head: ['Date', ...STROKES.map((s) => s.label), 'Total'],
    rows: recent.map((s) => [fmtDateTime(s.date), ...STROKES.map(({ key }) => s.strokes[key]), totalStrokes(s)]),
  };

  // ---- répartition ----
  const byType = usedStrokes.map((s) => ({ ...s, value: list.reduce((a, x) => a + (x.strokes[s.key] || 0), 0) }));
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
  // La zone d'impact n'est pas encore décodée depuis les fichiers de la raquette : carte masquée sans données.
  $('#impactCard').hidden = !withImpact.length;
  if (withImpact.length) impactMap($('#chartImpact'), cells);
  const zones = ['Haut gauche', 'Haut centre', 'Haut droite', 'Gauche', 'Centre', 'Droite', 'Bas gauche', 'Bas centre', 'Bas droite'];
  const ctot = cells.reduce((a, b) => a + b, 0);
  tables.impact = {
    title: "Zone d'impact",
    head: ['Zone', 'Coups', 'Part'],
    rows: zones.map((z, i) => [z, cells[i], `${ctot ? Math.round((cells[i] / ctot) * 100) : 0} %`]),
  };

  // ---- vitesse ----
  const sp = STROKES.map((st) => ({
    ...st,
    value: avg(list.map((x) => x.speed[st.key])),
    max: Math.max(0, ...list.map((x) => x.maxSpeed[st.key] || 0)) || null,
  }));
  const spRows = sp.filter((p) => p.value != null);
  if (spRows.length) {
    hBars($('#chartSpeed'), spRows.map((p) => ({
      label: p.label, value: p.value, color: p.color, tipLabel: p.max ? `moyenne · max ${fmtKmh(p.max)}` : 'moyenne',
      display: fmtKmh(p.value),
    })));
  } else $('#chartSpeed').textContent = 'Pas encore de données de vitesse.';
  tables.speed = {
    title: 'Vitesse par coup (km/h)',
    head: ['Coup', 'Moyenne', 'Maximum'],
    rows: sp.map((p) => [p.label, p.value == null ? '–' : fmtInt(p.value), p.max == null ? '–' : fmtInt(p.max)]),
  };

  // ---- évolution de la vitesse ----
  const trendSeries = STROKES.filter((st) => ['forehand', 'backhand', 'serve'].includes(st.key));
  const withSpeed = list.filter((x) => trendSeries.some((st) => x.speed[st.key] != null)).slice(-30);
  legend($('#legendTrend'), trendSeries);
  if (withSpeed.length) {
    lineChart($('#chartTrend'), {
      categories: withSpeed.map((x) => ({ label: fmtDate(x.date), title: fmtDateTime(x.date) })),
      series: trendSeries,
      values: withSpeed.map((x) => Object.fromEntries(trendSeries.map((st) => [st.key, x.speed[st.key] ?? null]))),
      unit: ' km/h',
    });
  } else $('#chartTrend').textContent = 'Pas encore de données de vitesse.';
  tables.trend = {
    title: 'Vitesse moyenne par séance (km/h)',
    head: ['Date', ...trendSeries.map((st) => st.label)],
    rows: withSpeed.map((x) => [fmtDateTime(x.date), ...trendSeries.map((st) => (x.speed[st.key] == null ? '–' : fmtInt(x.speed[st.key])))]),
  };

  // ---- effets ----
  const spinRows = STROKES.map((s) => {
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

  renderAnalysis(list);
}

// ---------------------------------------------------------------------
// Analyses fines (horodatage des coups) sur la période filtrée
// ---------------------------------------------------------------------
/** Moyenne pondérée par le nombre de coups de la vitesse d'un type de coup. */
function weightedSpeed(list, key) {
  let n = 0, sum = 0;
  for (const s of list) if (s.speed[key] != null && s.strokes[key]) { n += s.strokes[key]; sum += s.speed[key] * s.strokes[key]; }
  return n ? sum / n : null;
}
function spinPct(list, key, spin) {
  let n = 0, all = 0;
  for (const s of list) {
    const x = s.spin?.[key];
    if (!x) continue;
    n += x[spin] || 0;
    all += (x.topspin || 0) + (x.flat || 0) + (x.slice || 0);
  }
  return all ? Math.round((n / all) * 100) : null;
}

function renderAnalysis(list) {
  const agg = AN.analyzeMany(list);
  const matches = list.filter((s) => s.type === 'match');
  const aggMatch = matches.some(AN.hasSwings) ? AN.analyzeMany(matches) : null;

  // ---- tuile matchs ----
  const decided = matches.filter((s) => s.result);
  if (decided.length) {
    const w = decided.filter((s) => s.result === 'win').length;
    $('#tiles').appendChild(tile('Matchs', `${w} V · ${decided.length - w} D`, '', `${Math.round((w / decided.length) * 100)} % de victoires`));
  }

  // ---- points clés (1re / 2e balle estimées seulement sur les matchs) ----
  const ins = AN.insights(list, agg ? { ...agg, serve: aggMatch?.serve || null } : null);
  $('#insightsCard').hidden = !ins.length;
  $('#insights').replaceChildren(...ins.map((i) => {
    const li = document.createElement('li');
    li.className = i.kind;
    const b = document.createElement('b'); b.textContent = i.title;
    const p = document.createElement('p'); p.textContent = i.text;
    li.append(b, p);
    return li;
  }));

  for (const id of ['#serveCard', '#rallyCard', '#enduranceCard', '#consistencyCard', '#spinSpeedCard']) $(id).hidden = !agg;
  if (!agg) { $('#compareCard').hidden = true; return; }

  // ---- service ----
  const sv = agg.serve;
  const ms = aggMatch?.serve;
  $('#serveStats').replaceChildren(
    mini('Services', sv ? fmtInt(sv.count) : '–'),
    mini('Moyenne', kmhOrDash(sv?.avg), sv?.avg ? 'km/h' : ''),
    mini('Le plus rapide', kmhOrDash(sv?.max), sv?.max ? 'km/h' : ''),
    ...(ms ? [
      mini('1re balle', kmhOrDash(ms.firstAvg), ms.firstAvg ? 'km/h' : '', 'moyenne en match'),
      mini('2e balle', kmhOrDash(ms.secondAvg), ms.secondAvg ? 'km/h' : '', 'moyenne en match'),
      mini('1res balles', ms.firstInPct == null ? '–' : `${ms.firstInPct}`, ms.firstInPct == null ? '' : '%', 'estimées bonnes'),
    ] : []),
  );
  if (ms?.firstAvg && ms.secondAvg) {
    hBars($('#chartServe'), [
      { label: '1re balle', value: ms.firstAvg, color: 'var(--s3)', display: fmtKmh(ms.firstAvg), tipLabel: 'moyenne en match' },
      { label: '2e balle', value: ms.secondAvg, color: 'var(--s3)', display: fmtKmh(ms.secondAvg), tipLabel: 'moyenne en match' },
    ]);
  } else $('#chartServe').replaceChildren();
  $('#serveNote').textContent = ms
    ? `1re / 2e balle et pourcentage estimés sur ${matches.length} match(s) : deux services à moins de 12 s d'intervalle, sans coup entre les deux, sont comptés comme une 1re balle faute suivie d'une 2e balle.`
    : 'Indique « Match » comme type de séance (onglet Séances) pour estimer tes 1res et 2es balles et ton pourcentage de 1res balles.';
  tables.serve = {
    title: 'Service',
    head: ['Mesure', 'Toutes séances', 'Matchs (estimé)'],
    rows: [
      ['Services', sv ? sv.count : '–', ms ? ms.count : '–'],
      ['Vitesse moyenne (km/h)', kmhOrDash(sv?.avg), kmhOrDash(ms?.avg)],
      ['Vitesse max (km/h)', kmhOrDash(sv?.max), kmhOrDash(ms?.max)],
      ['Points servis', '–', ms ? ms.points : '–'],
      ['1re balle moyenne (km/h)', '–', kmhOrDash(ms?.firstAvg)],
      ['2e balle moyenne (km/h)', '–', kmhOrDash(ms?.secondAvg)],
      ['1res balles bonnes', '–', ms?.firstInPct == null ? '–' : `${ms.firstInPct} %`],
    ],
  };

  // ---- échanges ----
  const rl = agg.rallies;
  $('#rallyStats').replaceChildren(
    mini('Échanges', fmtInt(rl.count)),
    mini('Longueur moyenne', fmt1(rl.avg), 'coups'),
    mini('Le plus long', fmtInt(rl.max), 'coups'),
  );
  const bucketLabels = { '1': '1 coup', '2-3': '2 à 3', '4-6': '4 à 6', '7+': '7 et plus' };
  hBars($('#chartRallies'), Object.entries(rl.buckets).map(([k, v]) => ({
    label: bucketLabels[k], value: v, color: 'var(--s1)', tipLabel: 'échanges',
    display: `${fmtInt(v)} · ${Math.round((v / rl.count) * 100)} %`,
  })));
  tables.rallies = {
    title: 'Échanges (estimés)',
    head: ['Longueur (tes coups)', 'Échanges', 'Part'],
    rows: Object.entries(rl.buckets).map(([k, v]) => [bucketLabels[k], v, `${Math.round((v / rl.count) * 100)} %`]),
  };

  // ---- endurance : moyenne des tiers de chaque séance ----
  const segs = [[], [], []], rate = [[], [], []];
  for (const s of list) {
    const e = AN.analyzeSession(s)?.endurance;
    if (!e) continue;
    e.segments.forEach((g, i) => { if (g.groundKmh != null) segs[i].push(g.groundKmh); if (g.perMin != null) rate[i].push(g.perMin); });
  }
  const segAvg = segs.map(avg), rateAvg = rate.map(avg);
  $('#enduranceCard').hidden = segAvg.every((v) => v == null);
  if (segAvg[0] != null && segAvg[2] != null) {
    const drop = Math.round(((segAvg[2] - segAvg[0]) / segAvg[0]) * 100);
    $('#enduranceStats').replaceChildren(
      mini('Vitesse début → fin', `${drop > 0 ? '+' : ''}${drop}`, '%', drop <= -8 ? 'baisse marquée' : drop < 0 ? 'légère baisse' : 'tu tiens le rythme'),
      mini('Rythme au début', fmt1(rateAvg[0]), 'coups/min'),
      mini('Rythme à la fin', fmt1(rateAvg[2]), 'coups/min'),
    );
    hBars($('#chartEndurance'), ['Début', 'Milieu', 'Fin'].map((label, i) => ({
      label, value: segAvg[i] ?? 0, color: 'var(--s1)', display: fmtKmh(segAvg[i]), tipLabel: 'coup droit et revers',
    })));
  }
  tables.endurance = {
    title: 'Endurance',
    head: ['Partie de séance', 'Vitesse CD + revers (km/h)', 'Coups par minute'],
    rows: ['Début', 'Milieu', 'Fin'].map((l, i) => [l, kmhOrDash(segAvg[i]), fmt1(rateAvg[i])]),
  };

  // ---- régularité ----
  const cons = ['forehand', 'backhand', 'serve'].filter((k) => agg.consistency[k]).map((k) => ({
    key: k, label: STROKE_LABEL[k], color: STROKE_COLOR[k], ...agg.consistency[k],
  }));
  $('#consistencyCard').hidden = !cons.length;
  if (cons.length) rangeBars($('#chartConsistency'), cons.map((c) => ({ ...c, note: `${c.score}/100`, tip: `indice de régularité ${c.score}/100` })));
  tables.consistency = {
    title: 'Régularité de la vitesse (km/h)',
    head: ['Coup', 'Coups', '10 % les plus lents sous', 'Médiane', '10 % les plus rapides au-dessus', 'Indice /100'],
    rows: cons.map((c) => [c.label, c.n, fmtInt(c.p10), fmtInt(c.p50), fmtInt(c.p90), c.score]),
  };

  // ---- match vs hors match ----
  const others = list.filter((s) => s.type && s.type !== 'match');
  $('#compareCard').hidden = !(matches.length && others.length);
  if (matches.length && others.length) {
    const group = (g) => {
      const a = AN.analyzeMany(g);
      const perMin = avg(g.map((s) => AN.analyzeSession(s)?.perMin).filter((v) => v != null));
      return {
        sessions: g.length,
        strokes: avg(g.map(totalStrokes)),
        perMin,
        fh: weightedSpeed(g, 'forehand'),
        bh: weightedSpeed(g, 'backhand'),
        serve: weightedSpeed(g, 'serve'),
        fhTop: spinPct(g, 'forehand', 'topspin'),
        bhSlice: spinPct(g, 'backhand', 'slice'),
        rally: a?.rallies?.avg ?? null,
        feeling: avg(g.map((s) => s.feeling).filter((v) => v != null)),
      };
    };
    const A = group(matches), B = group(others);
    const rows = [
      ['Séances', A.sessions, B.sessions, null],
      ['Coups par séance', A.strokes, B.strokes, 0],
      ['Coups par minute', A.perMin, B.perMin, 1],
      ['Vitesse coup droit (km/h)', A.fh, B.fh, 0],
      ['Vitesse revers (km/h)', A.bh, B.bh, 0],
      ['Vitesse service (km/h)', A.serve, B.serve, 0],
      ['Coups droits liftés (%)', A.fhTop, B.fhTop, 0],
      ['Revers slicés (%)', A.bhSlice, B.bhSlice, 0],
      ['Échange moyen (coups, estimé)', A.rally, B.rally, 1],
      ['Ressenti moyen (/5)', A.feeling, B.feeling, 1],
    ];
    const table = document.createElement('table');
    const hr = table.createTHead().insertRow();
    for (const h of ['', 'Matchs', 'Hors match', 'Écart']) { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th); }
    const tb = table.createTBody();
    for (const [label, a, b, digits] of rows) {
      const r = tb.insertRow();
      const f = (v) => (v == null ? '–' : digits == null ? fmtInt(v) : v.toLocaleString('fr-FR', { maximumFractionDigits: digits }));
      r.insertCell().textContent = label;
      r.insertCell().textContent = f(a);
      r.insertCell().textContent = f(b);
      const d = a != null && b != null && digits != null ? a - b : null;
      r.insertCell().textContent = d == null ? '' : `${d > 0 ? '+' : ''}${d.toLocaleString('fr-FR', { maximumFractionDigits: digits })}`;
    }
    $('#compareTable').replaceChildren(table);
  }

  // ---- vitesse selon l'effet ----
  const ss = agg.spinSpeed;
  const keys = Object.keys(ss);
  $('#spinSpeedCard').hidden = !keys.length;
  if (keys.length) {
    const table = document.createElement('table');
    const hr = table.createTHead().insertRow();
    for (const h of ['km/h moyen', 'Lifté', 'Plat', 'Slicé']) { const th = document.createElement('th'); th.textContent = h; hr.appendChild(th); }
    const tb = table.createTBody();
    for (const k of keys) {
      const r = tb.insertRow();
      r.insertCell().textContent = STROKE_LABEL[k];
      for (const sp of ['topspin', 'flat', 'slice']) {
        const c = ss[k][sp];
        const cell = r.insertCell();
        cell.textContent = c ? fmtInt(c.avg) : '–';
        if (c) cell.title = `${c.n} coups`;
      }
    }
    $('#spinSpeedTable').replaceChildren(table);
  }
}

$('#typeFilter').value = typeFilter;
$('#surfaceFilter').value = surfaceFilter;
$('#typeFilter').addEventListener('change', (e) => { typeFilter = e.target.value; store.saveSettings({ typeFilter }); renderDashboard(); });
$('#surfaceFilter').addEventListener('change', (e) => { surfaceFilter = e.target.value; store.saveSettings({ surfaceFilter }); renderDashboard(); });

// =====================================================================
// Progrès : objectifs, records, volume, matchs
// =====================================================================
function renderProgress() {
  const all = store.sessions();
  const real = all.filter((s) => s.source !== 'demo');
  const list = real.length ? real : all; // la démo n'est utilisée que s'il n'y a rien d'autre
  const st = store.settings();
  const goals = { sessionsPerWeek: 2, serveKmh: null, ...(st.goals || {}) };
  const weeks = AN.weekly(list, 12);
  const thisWeek = weeks[weeks.length - 1];
  const streak = AN.weekStreak(list);
  const avgPerWeek = weeks.reduce((a, w) => a + w.sessions, 0) / weeks.length;

  $('#progressTiles').replaceChildren(
    tile('Série en cours', fmtInt(streak), streak > 1 ? 'semaines' : 'semaine', "semaines d'affilée avec au moins une séance"),
    tile('Cette semaine', fmtInt(thisWeek.sessions), thisWeek.sessions > 1 ? 'séances' : 'séance', `objectif : ${goals.sessionsPerWeek}`),
    tile('Moyenne', fmt1(avgPerWeek), 'séances / sem.', 'sur 12 semaines'),
    tile('Temps de jeu', fmtInt(weeks.reduce((a, w) => a + w.minutes, 0) / 60), 'h', 'sur 12 semaines'),
  );

  // ---- objectifs ----
  const goalRow = (label, value, target, unit) => {
    const div = document.createElement('div');
    div.className = 'goal';
    const h = document.createElement('div'); h.className = 'goal-h';
    const a = document.createElement('span'); a.textContent = label;
    const b = document.createElement('b'); b.textContent = `${value == null ? '–' : fmtInt(value)} / ${fmtInt(target)} ${unit}`;
    h.append(a, b);
    const bar = document.createElement('div');
    const pct = value == null ? 0 : Math.min(100, (value / target) * 100);
    bar.className = `bar${pct >= 100 ? ' done' : ''}`;
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    const fill = document.createElement('span'); fill.style.width = `${pct}%`;
    bar.appendChild(fill);
    div.append(h, bar);
    return div;
  };
  const rows = [goalRow('Séances cette semaine', thisWeek.sessions, goals.sessionsPerWeek, '')];
  if (goals.serveKmh) {
    const recent = list.filter((s) => Date.now() - new Date(s.date).getTime() < 30 * 86400000);
    const best = Math.max(0, ...recent.map((s) => s.maxSpeed?.serve || 0)) || null;
    rows.push(goalRow('Service le plus rapide (30 derniers jours)', best, goals.serveKmh, 'km/h'));
  }
  $('#goals').replaceChildren(...rows);
  $('#goalSessions').value = goals.sessionsPerWeek;
  $('#goalServe').value = goals.serveKmh ?? '';

  // ---- records ----
  const recs = AN.records(list);
  $('#records').replaceChildren(...(recs.length ? recs.map((r) => {
    const li = document.createElement('li');
    li.tabIndex = 0;
    const left = document.createElement('div');
    const name = document.createElement('div'); name.textContent = r.label;
    const date = document.createElement('div'); date.className = 'rd'; date.textContent = fmtDate(r.session.date, { day: 'numeric', month: 'long', year: 'numeric' });
    left.append(name, date);
    const v = document.createElement('span'); v.className = 'rv'; v.textContent = `${fmtInt(r.value)} ${r.unit}`;
    li.append(left, v);
    li.addEventListener('click', () => openDetail(r.session));
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDetail(r.session); });
    return li;
  }) : [Object.assign(document.createElement('li'), { textContent: 'Pas encore de record : importe tes séances.' })]));

  // ---- volume par semaine ----
  const wk = weeks.map((w) => ({
    label: w.start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
    title: `Semaine du ${w.start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })} · ${w.sessions} séance(s), ${fmtInt(w.minutes)} min`,
  }));
  stackedBars($('#chartWeekly'), { categories: wk, series: [{ key: 'strokes', label: 'Coups', color: 'var(--s1)' }], values: weeks.map((w) => ({ strokes: w.strokes })) });
  tables.weekly = {
    title: 'Volume par semaine',
    head: ['Semaine du', 'Séances', 'Minutes', 'Coups'],
    rows: weeks.map((w) => [w.start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }), w.sessions, w.minutes, w.strokes]),
  };

  // ---- matchs ----
  const matches = list.filter((s) => s.type === 'match').reverse();
  $('#matchesCard').hidden = !matches.length;
  if (matches.length) {
    const decided = matches.filter((s) => s.result);
    const w = decided.filter((s) => s.result === 'win').length;
    const surf = {};
    for (const s of decided) {
      if (!s.surface) continue;
      surf[s.surface] ??= { w: 0, n: 0 };
      surf[s.surface].n++;
      if (s.result === 'win') surf[s.surface].w++;
    }
    $('#matchStats').replaceChildren(
      mini('Matchs', fmtInt(matches.length)),
      mini('Victoires', fmtInt(w), '', decided.length ? `${Math.round((w / decided.length) * 100)} %` : ''),
      mini('Défaites', fmtInt(decided.length - w)),
      ...Object.entries(surf).map(([k, v]) => mini(SURFACE_LABEL[k], `${v.w}/${v.n}`, '', 'victoires')),
    );
    $('#matchList').replaceChildren(...matches.slice(0, 15).map((s) => {
      const li = document.createElement('li');
      li.tabIndex = 0;
      const left = document.createElement('div');
      const who = document.createElement('div'); who.textContent = s.opponent ? `contre ${s.opponent}` : 'Match';
      const md = document.createElement('div'); md.className = 'md';
      md.textContent = [fmtDate(s.date, { day: 'numeric', month: 'short', year: 'numeric' }), SURFACE_LABEL[s.surface]].filter(Boolean).join(' · ');
      left.append(who, md);
      const res = document.createElement('span');
      res.className = s.result === 'win' ? 'res-win' : 'res-loss';
      res.textContent = [s.result === 'win' ? 'Victoire' : s.result === 'loss' ? 'Défaite' : '', s.score].filter(Boolean).join(' ') || '—';
      li.append(left, res);
      li.addEventListener('click', () => openDetail(s));
      li.addEventListener('keydown', (e) => { if (e.key === 'Enter') openDetail(s); });
      return li;
    }));
  }
}
$('#goalSessions').addEventListener('change', (e) => {
  const v = Math.max(1, Math.min(14, Number(e.target.value) || 2));
  store.saveSettings({ goals: { ...(store.settings().goals || {}), sessionsPerWeek: v } });
  renderProgress();
});
$('#goalServe').addEventListener('change', (e) => {
  const v = Number(e.target.value);
  store.saveSettings({ goals: { ...(store.settings().goals || {}), serveKmh: v >= 50 ? v : null } });
  renderProgress();
});

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
    const tb = document.createElement('span');
    tb.className = s.type ? 'badge' : 'badge todo';
    tb.textContent = s.type ? TYPE_LABEL[s.type] : 'type à préciser';
    when.appendChild(tb);
    if (s.type === 'match' && s.result) {
      const rb = document.createElement('span');
      rb.className = `badge ${s.result === 'win' ? 'res-win' : 'res-loss'}`;
      rb.textContent = s.result === 'win' ? 'Victoire' : 'Défaite';
      when.appendChild(rb);
    }
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
      STROKES.filter(({ key }) => s.strokes[key]).map(({ key, label }) => `${label.toLowerCase()} ${s.strokes[key]}`).join(' · '),
      s.maxSpeed.serve ? `service max ${fmtKmh(s.maxSpeed.serve)}` : null,
    ].filter(Boolean);
    meta.textContent = parts.join(' — ') + (s.notes ? ` — ${s.notes}` : '');
    card.append(when, actions, meta);
    card.tabIndex = 0;
    card.addEventListener('click', (e) => { if (!e.target.closest('button')) openDetail(s); });
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target === card) openDetail(s); });
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
    for (const k of ['durationMin', 'activeMin', 'longestRally']) f[k].value = s[k] ?? '';
    for (const { key } of STROKES) {
      f[`s_${key}`].value = s.strokes[key] ?? 0;
      f[`v_${key}`].value = s.speed[key] ?? '';
    }
    f.notes.value = s.notes || '';
    f.type.value = s.type || '';
    f.surface.value = s.surface || '';
    f.feeling.value = s.feeling ?? '';
    f.result.value = s.result || '';
    f.opponent.value = s.opponent || '';
    f.score.value = s.score || '';
  }
  toggleMatchFields();
  $('#sessionDialog').showModal();
}
$('#newSession').addEventListener('click', () => openSessionForm());
function toggleMatchFields() {
  const isMatch = $('#sessionForm').type.value === 'match';
  for (const el of $$('#sessionForm .match-only')) el.hidden = !isMatch;
}
$('#sessionForm').type.addEventListener('change', toggleMatchFields);
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
    notes: f.notes.value,
    type: f.type.value,
    surface: f.surface.value,
    feeling: f.feeling.value,
    result: f.type.value === 'match' ? f.result.value : null,
    opponent: f.type.value === 'match' ? f.opponent.value : '',
    score: f.type.value === 'match' ? f.score.value : '',
    strokes: Object.fromEntries(STROKES.map(({ key }) => [key, f[`s_${key}`].value])),
    speed: Object.fromEntries(STROKES.map(({ key }) => [key, f[`v_${key}`].value])),
  };
  store.upsert(normalizeSession(data));
  editing = null;
  renderSessions();
  renderStorageInfo();
  toast('Séance enregistrée');
});

$('#importFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    let n;
    if (/\.csv$/i.test(file.name) || file.type === 'text/csv') n = store.addMany(fromCsv(text));
    else n = (await restoreBackup(JSON.parse(text))).added;
    toast(`${n} séance(s) importée(s)`);
    renderSessions();
  } catch (err) {
    toast(`Import impossible : ${err.message}`);
  }
});
const stamp = () => new Date().toISOString().slice(0, 10);
$('#exportCsv').addEventListener('click', () => download(`seances-${stamp()}.csv`, toCsv(store.sessions()), 'text/csv'));

// =====================================================================
// Détail d'une séance
// =====================================================================
const SPIN_KEYS = ['flat', 'topspin', 'slice'];
function openDetail(s) {
  $('#detailTitle').textContent = fmtDateTime(s.date);
  $('#detailMeta').textContent = [
    s.durationMin != null ? `${s.durationMin} min` : null,
    s.activeMin ? `${s.activeMin} min de jeu actif` : null,
    `${fmtInt(totalStrokes(s))} coups`,
    SOURCE_LABEL[s.source] ? `séance ${SOURCE_LABEL[s.source]}` : null,
  ].filter(Boolean).join(' · ');

  const head = ['Coup', 'Nombre', 'Vitesse moy.', 'Vitesse max', 'Lifté', 'Plat', 'Slicé'];
  const table = document.createElement('table');
  const tr = table.createTHead().insertRow();
  for (const h of head) { const th = document.createElement('th'); th.textContent = h; tr.appendChild(th); }
  const tb = table.createTBody();
  for (const st of STROKES) {
    if (!s.strokes[st.key]) continue;
    const sp = s.spin?.[st.key];
    const tot = sp ? sp.topspin + sp.flat + sp.slice : 0;
    const pct = (v) => (tot ? `${Math.round((v / tot) * 100)} %` : '–');
    const r = tb.insertRow();
    [st.label, fmtInt(s.strokes[st.key]), fmtKmh(s.speed[st.key]), fmtKmh(s.maxSpeed[st.key]),
      pct(sp?.topspin), pct(sp?.flat), pct(sp?.slice)].forEach((v) => { r.insertCell().textContent = v; });
  }
  $('#detailTable').replaceChildren(table);

  // Contexte
  const ctx = $('#detailContext');
  ctx.replaceChildren();
  const addBadge = (text, cls = 'badge') => { const b = document.createElement('span'); b.className = cls; b.textContent = text; ctx.appendChild(b); };
  addBadge(s.type ? TYPE_LABEL[s.type] : 'type à préciser', s.type ? 'badge' : 'badge todo');
  if (s.surface) addBadge(SURFACE_LABEL[s.surface]);
  if (s.feeling) addBadge(`ressenti ${s.feeling}/5`);
  if (s.type === 'match') {
    const txt = [s.result === 'win' ? 'Victoire' : s.result === 'loss' ? 'Défaite' : null, s.score, s.opponent ? `contre ${s.opponent}` : null].filter(Boolean).join(' · ');
    if (txt) ctx.appendChild(document.createTextNode(txt));
  }
  if (s.notes && s.source !== 'demo') {
    const n = document.createElement('div'); n.className = 'muted small'; n.textContent = s.notes; ctx.appendChild(n);
  }

  // Analyses de la séance + comparaison avec ta moyenne
  const box = $('#detailAnalysis');
  box.replaceChildren();
  const an = AN.analyzeSession(s);
  if (an) {
    const minis = document.createElement('div');
    minis.className = 'minis';
    const others = store.sessions().filter((x) => x.id !== s.id && (s.source === 'demo' || x.source !== 'demo'));
    const delta = (key) => {
      const ref = weightedSpeed(others, key);
      if (ref == null || s.speed[key] == null) return '';
      const d = Math.round(s.speed[key] - ref);
      return `${d > 0 ? '+' : ''}${d} km/h vs ta moyenne`;
    };
    if (an.rallies) minis.append(mini('Échanges', fmtInt(an.rallies.count), '', `moy. ${fmt1(an.rallies.avg)} · max ${an.rallies.max} coups`));
    if (an.perMin) minis.append(mini('Rythme', fmt1(an.perMin), 'coups/min'));
    for (const k of ['forehand', 'backhand', 'serve']) if (s.speed[k] != null) minis.append(mini(STROKE_LABEL[k], fmtInt(s.speed[k]), 'km/h', delta(k)));
    if (s.type === 'match' && an.serve?.points) {
      minis.append(mini('1res balles', an.serve.firstInPct == null ? '–' : `${an.serve.firstInPct}`, '%', 'estimation'));
      if (an.serve.secondAvg) minis.append(mini('2e balle', fmtInt(an.serve.secondAvg), 'km/h', `1re : ${fmtInt(an.serve.firstAvg)} km/h`));
    }
    if (an.endurance?.groundDropPct != null) {
      const d = an.endurance.groundDropPct;
      minis.append(mini('Vitesse début → fin', `${d > 0 ? '+' : ''}${d}`, '%', 'coup droit et revers'));
    }
    const h = document.createElement('h3'); h.className = 'mt'; h.textContent = 'Analyse de la séance';
    box.append(h, minis);
  }
  $('#detailEdit').onclick = () => { $('#detailDialog').close(); openSessionForm(s); };

  // Chronologie par tranches de 5 minutes, à partir des coups horodatés.
  const swings = (s.swings || []).filter((w) => !w[4]);
  $('#detailTimelineBox').hidden = !swings.length;
  $('#detailDialog').showModal();
  if (swings.length) {
    const binS = 300;
    const nBins = Math.max(1, Math.ceil((Math.max(...swings.map((w) => w[0])) + 1) / binS));
    const values = Array.from({ length: nBins }, () => Object.fromEntries(STROKES.map((st) => [st.key, 0])));
    for (const [t, k] of swings) if (STROKES[k]) values[Math.floor(t / binS)][STROKES[k].key]++;
    const used = STROKES.filter((st) => values.some((v) => v[st.key]));
    legend($('#detailLegend'), used);
    stackedBars($('#detailTimeline'), {
      categories: values.map((_, i) => ({ label: `${i * 5}'`, title: `De ${i * 5} à ${(i + 1) * 5} min` })),
      series: used,
      values,
    });
  }
}

// =====================================================================
// Import USB des fichiers LOG*.BIN
// =====================================================================
const MIN_SWINGS = 10; // en dessous, ce sont des allumages sans vraie séance
let pendingReset = null; // séances à l'horloge réinitialisée, en attente de réglage

async function importLogFiles(fileList) {
  const files = [...fileList].filter((f) => /^log.*\.bin$/i.test(f.name));
  const box = $('#usbResult');
  box.hidden = false;
  if (!files.length) {
    box.textContent = 'Aucun fichier LOG…BIN dans la sélection. Choisis les fichiers LOG000.BIN, LOG001.BIN… de la clé BABOLAT.';
    return;
  }
  box.textContent = 'Lecture en cours…';
  const parsed = [];
  const errors = [];
  let archived = 0;
  for (const f of files) {
    try {
      const bytes = await f.arrayBuffer();
      // Copie brute archivée AVANT décodage : on pourra toujours redécoder plus tard.
      try {
        if (await store.archiveRaw(f.name, bytes)) archived++;
      } catch (e) {
        errors.push(`${f.name} : archivage impossible (${e.message})`);
      }
      parsed.push(...await parseLog(bytes, f.name));
    } catch (e) {
      errors.push(`${f.name} : ${e.message}`);
    }
  }
  const r = ingestParsed(parsed);
  box.textContent = [
    `${files.length} fichier(s) lu(s) : ${r.added} nouvelle(s) séance(s), ${r.updated} mise(s) à jour.`,
    archived ? `${archived} fichier(s) brut(s) archivé(s).` : '',
    r.short ? `${r.short} allumage(s) de moins de ${MIN_SWINGS} coups ignoré(s).` : '',
    r.undated ? `${r.undated} séance(s) en attente : l'horloge de la raquette doit être réglée.` : '',
    r.added ? 'Pense à préciser le type de tes nouvelles séances (match, entraînement…) dans l\'onglet Séances : les statistiques seront plus précises.' : '',
    [...errors, ...r.errors].length ? `Erreurs : ${[...errors, ...r.errors].join(' ; ')}` : '',
  ].filter(Boolean).join(' ');
  if (r.added || r.updated) {
    toast(`${r.added} nouvelle(s) séance(s) importée(s)`);
    requestPersistence();
  }
  renderStorageInfo();
}

/** Séances décodées -> séances de l'appli (dédoublonnage, filtre, correction d'horloge). */
function ingestParsed(parsed) {
  // Un même début de séance peut apparaître dans un fichier qui a grandi : on garde la version la plus complète.
  const byId = new Map();
  for (const p of parsed) if (!byId.has(p.id) || p.swings.length > byId.get(p.id).swings.length) byId.set(p.id, p);
  const real = [...byId.values()].filter((p) => p.swings.length >= MIN_SWINGS);
  const clock = store.settings().clock;
  const ready = [];
  const undated = [];
  for (const p of real) {
    const c = correctClock(clock, p);
    if (c) ready.push(c); else undated.push(p);
  }
  const errors = [];
  let res = { added: 0, updated: 0 };
  try {
    res = store.addMany(ready.map((p) => normalizeSession(toAppSession(p))), { replace: true });
  } catch (e) {
    errors.push(e.message);
  }
  if (undated.length) askClock(undated);
  return { ...res, short: byId.size - real.length, undated: undated.length, errors };
}

function askClock(undated) {
  pendingReset = undated;
  $('#clockCount').textContent = `${undated.length} séance(s) ne peuvent pas être datées pour l'instant.`;
  const f = $('#clockForm');
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  f.lastEnded.value = d.toISOString().slice(0, 16);
  $('#clockDialog').showModal();
}

$('#clockDialog').addEventListener('close', () => {
  if ($('#clockDialog').returnValue !== 'save' || !pendingReset) return;
  const lastEnded = new Date($('#clockForm').lastEnded.value);
  if (Number.isNaN(lastEnded.getTime())) return;
  const clock = calibrate(pendingReset, lastEnded);
  store.saveSettings({ clock });
  const fixed = pendingReset.map((p) => correctClock(clock, p)).filter(Boolean);
  const res = store.addMany(fixed.map((p) => normalizeSession(toAppSession(p))), { replace: true });
  pendingReset = null;
  $('#usbResult').hidden = false;
  $('#usbResult').textContent += ` Horloge réglée : ${res.added} séance(s) ajoutée(s).`;
  toast(`${res.added} séance(s) datée(s) et importée(s)`);
});

for (const id of ['#logFiles', '#logDir']) {
  $(id).addEventListener('change', async (e) => {
    const files = e.target.files;
    try {
      await importLogFiles(files);
    } finally {
      e.target.value = '';
    }
  });
}
// La sélection de dossier n'existe pas sur iPhone / Android : bouton masqué.
if (/iPhone|iPad|iPod|Android/.test(navigator.userAgent) || !('webkitdirectory' in document.createElement('input'))) {
  $('#logDirBtn').hidden = true;
}

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

// ---- Bluetooth classique (port série) ----
const SERIAL_TARGET = '__serial__';
const serial = new SerialLink((dir, svc, chr, bytes) => racket.log(dir, svc, chr, bytes));
const serialOk = serialSupport();
if (!serialOk.ok) {
  $('#serialUnsupported').hidden = false;
  $('#serialUnsupported').textContent = `Indisponible ici : ${serialOk.reason}`;
  $('#btnSerial').disabled = true;
}
serial.addEventListener('status', ({ detail }) => {
  $('#connBadge').dataset.state = detail.state;
  $('#connLabel').textContent = detail.state === 'on' ? 'Raquette (port série)' : detail.label;
  $('#btnSerial').disabled = detail.state !== 'off' || !serialOk.ok;
  $('#btnSerialClose').disabled = detail.state !== 'on';
  refreshWritable();
});
$('#btnSerial').addEventListener('click', async () => {
  try {
    if (await serial.connect()) {
      racket.capture.device ??= { name: 'Raquette (Bluetooth classique)', id: 'serial' };
      toast('Port série ouvert : fais quelques gestes ou envoie une commande');
    }
  } catch (e) {
    toast(`Ouverture impossible : ${e.message}`, 6000);
    serial.disconnect();
  }
});
$('#btnSerialClose').addEventListener('click', () => serial.disconnect());

function refreshWritable() {
  const sel = $('#writeChar');
  const list = racket.connected ? racket.writableChars() : [];
  if (serial.connected) list.unshift({ id: SERIAL_TARGET, label: `${serial.label} — Bluetooth classique` });
  sel.replaceChildren();
  if (!list.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = 'Aucune destination ouverte';
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
    const target = $('#writeChar').value;
    if (target === SERIAL_TARGET) await serial.write(bytes);
    else await racket.write(target, bytes);
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
// Sauvegarde, stockage, installation
// =====================================================================
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMobile = isIOS || /Android/.test(navigator.userAgent);
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const realSessions = () => store.sessions().filter((s) => s.source !== 'demo');
const DAY = 86400000;

async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* non pris en charge */ }
  renderStorageInfo();
}

function ago(iso) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
  return d <= 0 ? "aujourd'hui" : d === 1 ? 'hier' : `il y a ${d} jours`;
}

async function renderStorageInfo() {
  const dl = $('#storageInfo');
  if (!dl) return;
  const rows = [];
  const n = realSessions().length;
  rows.push(['Séances', `${fmtInt(n)}${store.sessions().length > n ? ' (+ démo)' : ''}`]);
  let rawN = 0;
  try { rawN = await store.rawCount(); } catch { /* rien */ }
  rows.push(['Fichiers bruts archivés', store.backend === 'indexeddb' ? fmtInt(rawN) : 'indisponible ici']);
  rows.push(['Stockage', store.backend === 'indexeddb' ? 'base locale (IndexedDB)' : store.backend === 'localstorage' ? 'limité (navigation privée ?)' : 'indisponible']);
  let persisted = null;
  try { persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null; } catch { /* rien */ }
  rows.push(['Protection contre l\'effacement', persisted ? ['ok', 'activée'] : isInstalled() ? 'appli installée' : ['warn', isIOS ? "non : installe l'appli sur l'écran d'accueil" : 'non garantie']]);
  try {
    const est = await navigator.storage?.estimate?.();
    if (est?.usage != null) rows.push(['Espace utilisé', `${(est.usage / 1024 / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`]);
  } catch { /* rien */ }
  const last = store.settings().lastBackup;
  rows.push(['Dernière sauvegarde', last ? `${ago(last)} (${fmtDate(last, { day: 'numeric', month: 'long', year: 'numeric' })})` : ['warn', 'jamais']]);
  dl.replaceChildren();
  for (const [k, v] of rows) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd');
    if (Array.isArray(v)) { dd.className = v[0] === 'ok' ? 'ok' : 'warn-text'; dd.textContent = v[1]; } else dd.textContent = v;
    dl.append(dt, dd);
  }
}

async function backupNow() {
  let data;
  try {
    data = JSON.stringify(await buildBackup());
  } catch (e) {
    toast(`Sauvegarde impossible : ${e.message}`);
    return;
  }
  const name = `play-tracker-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  let done = false;
  // Sur téléphone : feuille de partage (Enregistrer dans Fichiers, iCloud Drive, Google Drive…).
  if (isMobile && navigator.canShare) {
    const file = new File([data], name, { type: 'application/json' });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Sauvegarde Play Tracker' });
        done = true;
      } catch (e) {
        if (e.name === 'AbortError') return; // annulé par l'utilisateur
      }
    }
  }
  if (!done) {
    download(name, data, 'application/json');
    done = true;
  }
  const count = realSessions().length;
  store.saveSettings({ lastBackup: new Date().toISOString(), lastBackupCount: count, backupSnoozedUntil: null });
  toast(`Sauvegarde créée : ${count} séance(s)`);
  renderStorageInfo();
  renderBanners();
}
$('#backupNow').addEventListener('click', backupNow);
$('#backupNowBanner').addEventListener('click', backupNow);

$('#restoreFile').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const r = await restoreBackup(JSON.parse(await file.text()));
    toast(`${r.added} séance(s) restaurée(s)${r.rawAdded ? `, ${r.rawAdded} fichier(s) brut(s)` : ''}`);
    requestPersistence();
    renderSessions();
  } catch (err) {
    toast(`Restauration impossible : ${err.message}`, 5000);
  }
});

$('#redecode').addEventListener('click', async () => {
  const files = await store.rawFiles();
  if (!files.length) {
    toast("Aucun fichier brut archivé : importe d'abord les fichiers de la raquette.");
    return;
  }
  const parsed = [];
  const errors = [];
  for (const f of files) {
    try { parsed.push(...await parseLog(f.bytes, f.name)); } catch (err) { errors.push(`${f.name} : ${err.message}`); }
  }
  const r = ingestParsed(parsed);
  toast(`${files.length} fichier(s) redécodé(s) : ${r.updated} séance(s) mise(s) à jour, ${r.added} nouvelle(s)` +
    (errors.length ? ` (${errors.length} erreur(s))` : ''), 5000);
  renderSessions();
});

// ---- bandeaux du tableau de bord ----
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  renderBanners();
});
window.addEventListener('appinstalled', () => { deferredInstall = null; renderBanners(); });

function renderBanners() {
  const st = store.settings();
  const now = Date.now();
  // Installation : sur iPhone, Safari peut effacer les données d'un site non installé après 7 jours sans visite.
  const showInstall = !isInstalled() && isMobile && !(st.installSnoozedUntil && now < st.installSnoozedUntil);
  $('#installBanner').hidden = !showInstall;
  if (showInstall) {
    $('#installText').textContent = isIOS
      ? "Touche Partager puis « Sur l'écran d'accueil ». Sinon, Safari peut effacer tes données après 7 jours sans ouvrir la page. " +
        "L'appli installée a sa propre mémoire : si tu as déjà des séances ici, fais « Sauvegarder tout » puis « Restaurer » dans l'appli installée."
      : "Une fois installée, l'appli s'ouvre comme les autres et tes données sont mieux protégées contre l'effacement automatique.";
    $('#installBtn').hidden = !deferredInstall;
  }
  // Sauvegarde : jamais faite, ou plus de 14 jours avec de nouvelles séances depuis.
  const n = realSessions().length;
  const stale = !st.lastBackup || (now - new Date(st.lastBackup).getTime() > 14 * DAY && n !== st.lastBackupCount);
  const showBackup = n > 0 && stale && !(st.backupSnoozedUntil && now < st.backupSnoozedUntil);
  $('#backupBanner').hidden = !showBackup;
  if (showBackup) {
    $('#backupText').textContent = st.lastBackup
      ? `Dernière sauvegarde ${ago(st.lastBackup)}. Depuis, tu as de nouvelles séances.`
      : `Tes ${n} séance(s) ne sont enregistrées que sur cet appareil. Une sauvegarde les protège si tu le perds ou le changes.`;
  }
}
$('#installBtn').addEventListener('click', async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice.catch(() => null);
  deferredInstall = null;
  renderBanners();
});
$('#installLater').addEventListener('click', () => { store.saveSettings({ installSnoozedUntil: Date.now() + 14 * DAY }); renderBanners(); });
$('#backupLater').addEventListener('click', () => { store.saveSettings({ backupSnoozedUntil: Date.now() + 7 * DAY }); renderBanners(); });

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
