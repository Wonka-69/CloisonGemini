// Analyses tirées de l'horodatage de chaque coup (fichiers de la raquette).
// Fonctions pures : elles prennent des séances (modèle de store.js) et renvoient des chiffres.
//
// Une séance importée de la raquette contient session.swings :
//   [t (s depuis le début), coup (index dans STROKE_KEYS), effet (0 plat, 1 lifté, 2 slicé, -1 ?), km/h, bug d'horloge 0/1]
//
// Plusieurs résultats sont des ESTIMATIONS (échanges, 1re / 2e balle) : la raquette ne voit que
// tes propres coups, pas ceux de l'adversaire ni si la balle était bonne. Les seuils sont réglés
// sur des séances réelles et réunis ici pour être ajustés facilement.

export const STROKE_KEYS = ['forehand', 'backhand', 'serve', 'volley', 'smash'];
export const SPIN_KEYS = ['flat', 'topspin', 'slice'];

/** Écart max entre deux de tes coups dans un même échange (l'adversaire joue entre les deux). */
export const RALLY_GAP_S = 8;
/** Service suivi d'un autre service dans ce délai, sans coup entre les deux : la 1re balle était faute. */
export const SECOND_SERVE_GAP_S = 12;
/** Nombre minimal de coups par tiers de séance pour mesurer l'endurance. */
const MIN_PER_SEGMENT = 5;

export const SESSION_TYPES = [
  { key: 'match', label: 'Match' },
  { key: 'training', label: 'Entraînement' },
  { key: 'lesson', label: 'Cours' },
  { key: 'drill', label: 'Exercices / panier' },
  { key: 'free', label: 'Jeu libre' },
];
export const SURFACES = [
  { key: 'hard', label: 'Dur' },
  { key: 'clay', label: 'Terre battue' },
  { key: 'grass', label: 'Gazon' },
  { key: 'indoor', label: 'Intérieur / moquette' },
];

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);

/** Coups exploitables d'une séance, dans l'ordre chronologique, sans les bugs d'horloge. */
export function swingsOf(session) {
  if (!Array.isArray(session.swings)) return [];
  return session.swings
    .filter((w) => !w[4])
    .map(([t, k, sp, kmh]) => ({ t, stroke: STROKE_KEYS[k] || 'unknown', spin: SPIN_KEYS[sp] ?? null, kmh: kmh || null }))
    .sort((a, b) => a.t - b.t);
}

export const hasSwings = (session) => Array.isArray(session.swings) && session.swings.length > 0;

// ---------------------------------------------------------------------------
// Échanges (estimation)
// ---------------------------------------------------------------------------
/**
 * Découpe en échanges : un service commence toujours un nouvel échange ; sinon, un écart de plus
 * de RALLY_GAP_S secondes entre deux de tes coups aussi. Renvoie la liste des longueurs (en coups).
 */
export function rallyLengths(sw) {
  const out = [];
  let len = 0, prevT = null;
  for (const w of sw) {
    const newRally = prevT == null || w.stroke === 'serve' || w.t - prevT > RALLY_GAP_S;
    if (newRally && len) { out.push(len); len = 0; }
    len++;
    prevT = w.t;
  }
  if (len) out.push(len);
  return out;
}

export function rallyStats(lengths) {
  if (!lengths.length) return null;
  const buckets = { '1': 0, '2-3': 0, '4-6': 0, '7+': 0 };
  for (const l of lengths) buckets[l === 1 ? '1' : l <= 3 ? '2-3' : l <= 6 ? '4-6' : '7+']++;
  return {
    count: lengths.length,
    avg: round1(mean(lengths)),
    max: Math.max(...lengths),
    buckets,
  };
}

// ---------------------------------------------------------------------------
// Service (1re / 2e balle estimées)
// ---------------------------------------------------------------------------
export function serveStats(sw) {
  const serves = [];
  for (let i = 0; i < sw.length; i++) if (sw[i].stroke === 'serve') serves.push({ ...sw[i], i });
  if (!serves.length) return null;
  const speeds = serves.map((s) => s.kmh).filter(Boolean);
  // Appariement 1re / 2e balle.
  const first = [], second = [];
  let points = 0, faults = 0;
  for (let j = 0; j < serves.length; j++) {
    const s = serves[j];
    const next = serves[j + 1];
    points++;
    if (next && next.i === s.i + 1 && next.t - s.t <= SECOND_SERVE_GAP_S) {
      faults++;
      first.push(s);
      second.push(next);
      j++; // la 2e balle appartient au même point
    } else {
      first.push(s);
    }
  }
  const avgOf = (list) => round1(mean(list.map((s) => s.kmh).filter(Boolean)));
  return {
    count: serves.length,
    avg: round1(mean(speeds)),
    max: speeds.length ? Math.max(...speeds) : null,
    points,
    faults,
    firstInPct: points ? Math.round(((points - faults) / points) * 100) : null,
    firstAvg: avgOf(first),
    secondAvg: avgOf(second),
    secondCount: second.length,
  };
}

// ---------------------------------------------------------------------------
// Endurance : début / milieu / fin de séance
// ---------------------------------------------------------------------------
export function enduranceStats(sw) {
  if (sw.length < MIN_PER_SEGMENT * 3) return null;
  const t0 = sw[0].t, t1 = sw[sw.length - 1].t;
  const span = Math.max(1, t1 - t0);
  const segs = [0, 1, 2].map(() => []);
  for (const w of sw) segs[Math.min(2, Math.floor(((w.t - t0) / span) * 3))].push(w);
  const ground = (w) => (w.stroke === 'forehand' || w.stroke === 'backhand') && w.kmh;
  const segments = segs.map((seg, i) => {
    const g = seg.filter(ground).map((w) => w.kmh);
    const minutes = span / 3 / 60;
    return {
      label: ['Début', 'Milieu', 'Fin'][i],
      shots: seg.length,
      perMin: minutes > 0 ? round1(seg.length / minutes) : null,
      groundKmh: g.length >= MIN_PER_SEGMENT ? round1(mean(g)) : null,
    };
  });
  const a = segments[0].groundKmh, c = segments[2].groundKmh;
  return {
    segments,
    groundDropPct: a && c ? Math.round(((c - a) / a) * 100) : null,
  };
}

// ---------------------------------------------------------------------------
// Régularité de la vitesse, et vitesse selon l'effet
// ---------------------------------------------------------------------------
export function consistencyStats(sw) {
  const out = {};
  for (const k of STROKE_KEYS) {
    const v = sw.filter((w) => w.stroke === k && w.kmh).map((w) => w.kmh).sort((a, b) => a - b);
    if (v.length < 5) continue;
    const m = mean(v);
    const sd = Math.sqrt(mean(v.map((x) => (x - m) ** 2)));
    out[k] = {
      n: v.length,
      mean: round1(m),
      p10: round1(quantile(v, 0.1)),
      p50: round1(quantile(v, 0.5)),
      p90: round1(quantile(v, 0.9)),
      // Indice de régularité : 100 = toujours la même vitesse. Basé sur le coefficient de variation.
      score: Math.max(0, Math.min(100, Math.round(100 - (sd / m) * 200))),
    };
  }
  return out;
}

export function speedBySpin(sw) {
  const out = {};
  for (const k of STROKE_KEYS) {
    const row = {};
    for (const sp of SPIN_KEYS) {
      const v = sw.filter((w) => w.stroke === k && w.spin === sp && w.kmh).map((w) => w.kmh);
      if (v.length >= 3) row[sp] = { n: v.length, avg: round1(mean(v)) };
    }
    if (Object.keys(row).length) out[k] = row;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Analyse d'une séance et d'un ensemble de séances
// ---------------------------------------------------------------------------
export function analyzeSession(session) {
  const sw = swingsOf(session);
  if (!sw.length) return null;
  const span = sw[sw.length - 1].t - sw[0].t;
  return {
    swings: sw.length,
    perMin: span > 60 ? round1(sw.length / (span / 60)) : null,
    rallies: rallyStats(rallyLengths(sw)),
    serve: serveStats(sw),
    endurance: enduranceStats(sw),
    consistency: consistencyStats(sw),
    spinSpeed: speedBySpin(sw),
  };
}

/** Agrège plusieurs séances : les coups sont analysés ensemble, séance par séance pour le découpage. */
export function analyzeMany(sessions) {
  const withSw = sessions.filter(hasSwings);
  if (!withSw.length) return null;
  const allSw = [];
  const lengths = [];
  const serveSw = [];
  const drops = [];
  for (const s of withSw) {
    const sw = swingsOf(s);
    allSw.push(...sw);
    lengths.push(...rallyLengths(sw));
    serveSw.push(sw);
    const e = enduranceStats(sw);
    if (e?.groundDropPct != null) drops.push(e.groundDropPct);
  }
  // Service : on additionne les résultats séance par séance (les paires 1re/2e ne traversent pas deux séances).
  const per = serveSw.map(serveStats).filter(Boolean);
  let serve = null;
  if (per.length) {
    const sum = (k) => per.reduce((a, s) => a + (s[k] || 0), 0);
    const wavg = (k, w) => {
      const tot = per.reduce((a, s) => a + (s[k] != null ? s[w] : 0), 0);
      return tot ? round1(per.reduce((a, s) => a + (s[k] != null ? s[k] * s[w] : 0), 0) / tot) : null;
    };
    const points = sum('points'), faults = sum('faults');
    serve = {
      count: sum('count'),
      avg: wavg('avg', 'count'),
      max: Math.max(...per.map((s) => s.max || 0)) || null,
      points,
      faults,
      firstInPct: points ? Math.round(((points - faults) / points) * 100) : null,
      firstAvg: wavg('firstAvg', 'points'),
      secondAvg: wavg('secondAvg', 'secondCount'),
      secondCount: sum('secondCount'),
    };
  }
  return {
    sessions: withSw.length,
    swings: allSw.length,
    rallies: rallyStats(lengths),
    serve,
    groundDropPct: drops.length ? Math.round(mean(drops)) : null,
    enduranceSessions: drops.length,
    consistency: consistencyStats(allSw),
    spinSpeed: speedBySpin(allSw),
  };
}

// ---------------------------------------------------------------------------
// Records, volume par semaine, séries
// ---------------------------------------------------------------------------
const STROKE_LABEL = { forehand: 'coup droit', backhand: 'revers', serve: 'service', volley: 'volée', smash: 'smash' };

export function records(sessions) {
  const list = sessions.filter((s) => s.source !== 'demo' || sessions.every((x) => x.source === 'demo'));
  const best = (label, unit, pick) => {
    let top = null;
    for (const s of list) {
      const v = pick(s);
      if (v != null && v > 0 && (!top || v > top.value)) top = { value: v, session: s };
    }
    return top ? { label, unit, ...top } : null;
  };
  return [
    best('Service le plus rapide', 'km/h', (s) => s.maxSpeed?.serve),
    best('Coup droit le plus rapide', 'km/h', (s) => s.maxSpeed?.forehand),
    best('Revers le plus rapide', 'km/h', (s) => s.maxSpeed?.backhand),
    best('Le plus de coups en une séance', 'coups', (s) => STROKE_KEYS.reduce((a, k) => a + (s.strokes?.[k] || 0), 0)),
    best('Séance la plus longue', 'min', (s) => s.durationMin),
    best('Plus long échange (estimé)', 'coups', (s) => (hasSwings(s) ? Math.max(0, ...rallyLengths(swingsOf(s))) : null)),
  ].filter(Boolean);
}

/** Lundi 00:00 (heure locale) de la semaine d'une date. */
export function weekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** Volume des n dernières semaines (la plus ancienne d'abord). */
export function weekly(sessions, n = 12, now = new Date()) {
  const cur = weekStart(now);
  const weeks = Array.from({ length: n }, (_, i) => {
    const start = new Date(cur);
    start.setDate(start.getDate() - (n - 1 - i) * 7);
    return { start, sessions: 0, strokes: 0, minutes: 0 };
  });
  for (const s of sessions) {
    const ws = weekStart(s.date).getTime();
    const w = weeks.find((x) => x.start.getTime() === ws);
    if (!w) continue;
    w.sessions++;
    w.strokes += STROKE_KEYS.reduce((a, k) => a + (s.strokes?.[k] || 0), 0);
    w.minutes += s.durationMin || 0;
  }
  return weeks;
}

/** Nombre de semaines consécutives avec au moins une séance, jusqu'à cette semaine (ou la précédente). */
export function weekStreak(sessions, now = new Date()) {
  const set = new Set(sessions.map((s) => weekStart(s.date).getTime()));
  let d = weekStart(now);
  if (!set.has(d.getTime())) d.setDate(d.getDate() - 7); // la semaine en cours n'est pas finie
  let n = 0;
  while (set.has(d.getTime())) {
    n++;
    d.setDate(d.getDate() - 7);
  }
  return n;
}

// ---------------------------------------------------------------------------
// Points clés : observations simples pour savoir quoi travailler
// ---------------------------------------------------------------------------
export function insights(sessions, agg) {
  const out = [];
  const total = (k) => sessions.reduce((a, s) => a + (s.strokes?.[k] || 0), 0);
  const fh = total('forehand'), bh = total('backhand');
  const spinShare = (k, sp) => {
    let n = 0, all = 0;
    for (const s of sessions) {
      const x = s.spin?.[k];
      if (!x) continue;
      n += x[sp] || 0;
      all += (x.topspin || 0) + (x.flat || 0) + (x.slice || 0);
    }
    return all >= 20 ? Math.round((n / all) * 100) : null;
  };

  const bhSlice = spinShare('backhand', 'slice');
  if (bhSlice != null && bhSlice >= 60) {
    out.push({ kind: 'tip', title: 'Revers surtout slicé', text: `${bhSlice} % de tes revers sont slicés. Travailler un revers lifté te donnera plus d'options en fond de court.` });
  }
  const fhTop = spinShare('forehand', 'topspin');
  if (fhTop != null && fhTop < 35) {
    out.push({ kind: 'tip', title: 'Peu de lift en coup droit', text: `Seulement ${fhTop} % de coups droits liftés. Le lift aide à garder de la marge au-dessus du filet tout en frappant fort.` });
  }
  if (fh + bh >= 50 && bh > 0 && fh / bh >= 2.5) {
    out.push({ kind: 'info', title: 'Tu tournes autour du revers ?', text: `${(fh / bh).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} coups droits pour 1 revers. Si c'est voulu, très bien ; sinon, ton revers manque peut-être de confiance.` });
  }
  if (agg?.serve?.firstAvg && agg.serve.secondAvg && agg.serve.secondCount >= 5) {
    const gap = Math.round(agg.serve.firstAvg - agg.serve.secondAvg);
    if (gap >= 25) out.push({ kind: 'tip', title: 'Grosse différence entre 1re et 2e balle', text: `Ta 2e balle est environ ${gap} km/h plus lente que ta 1re (estimation). Une 2e balle plus liftée et plus rapide te mettra moins sous pression.` });
  }
  if (agg?.serve?.firstInPct != null && agg.serve.points >= 15 && agg.serve.firstInPct < 55) {
    out.push({ kind: 'tip', title: 'Pourcentage de 1res balles', text: `Environ ${agg.serve.firstInPct} % de 1res balles passent (estimation). Viser 60 % ou plus, quitte à servir un peu moins fort.` });
  }
  if (agg?.groundDropPct != null && agg.enduranceSessions >= 1 && agg.groundDropPct <= -8) {
    out.push({ kind: 'tip', title: 'Baisse en fin de séance', text: `Ta vitesse en fond de court baisse de ${-agg.groundDropPct} % entre le début et la fin des séances. Le physique ou la concentration lâchent : à travailler.` });
  }
  if (agg?.rallies && agg.rallies.count >= 20 && agg.rallies.avg < 2.5) {
    out.push({ kind: 'info', title: 'Échanges courts', text: `Tes échanges font en moyenne ${agg.rallies.avg.toLocaleString('fr-FR')} coups de ton côté (estimation). Des exercices de régularité (10 balles sans faute) aident à construire le point.` });
  }
  const cons = agg?.consistency || {};
  const weakest = Object.entries(cons).filter(([k]) => k === 'forehand' || k === 'backhand').sort((a, b) => a[1].score - b[1].score)[0];
  if (weakest && weakest[1].score < 45 && weakest[1].n >= 30) {
    out.push({ kind: 'info', title: `Vitesse irrégulière en ${STROKE_LABEL[weakest[0]]}`, text: `Tes ${STROKE_LABEL[weakest[0]]}s varient beaucoup (de ${Math.round(weakest[1].p10)} à ${Math.round(weakest[1].p90)} km/h). Chercher une frappe plus constante aide à la régularité.` });
  }
  if (!out.length && sessions.length) {
    out.push({ kind: 'info', title: 'Rien de particulier à signaler', text: 'Continue à importer tes séances et à préciser leur type (match, entraînement…) : les observations deviendront plus précises.' });
  }
  return out;
}
