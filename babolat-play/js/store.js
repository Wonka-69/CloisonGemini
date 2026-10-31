// Stockage local des séances et des réglages (reste sur l'appareil, rien n'est envoyé en ligne).

export const STROKES = [
  { key: 'forehand', label: 'Coup droit', color: 'var(--s1)' },
  { key: 'backhand', label: 'Revers', color: 'var(--s2)' },
  { key: 'serve', label: 'Service', color: 'var(--s3)' },
  { key: 'smash', label: 'Smash', color: 'var(--s4)' },
];

export const SPINS = [
  { key: 'topspin', label: 'Lifté', color: 'var(--s1)' },
  { key: 'flat', label: 'Plat', color: 'var(--s2)' },
  { key: 'slice', label: 'Slicé', color: 'var(--s3)' },
];

const KEY_SESSIONS = 'playtracker.sessions.v1';
const KEY_SETTINGS = 'playtracker.settings.v1';

function safeGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function safeSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/**
 * Modèle d'une séance. Tous les champs sauf id/date/strokes sont optionnels :
 * on ne sait pas encore tout ce que le capteur expose.
 *
 * {
 *   id, date (ISO), source: 'manual' | 'import' | 'racket' | 'demo',
 *   durationMin, activeMin, longestRally,
 *   strokes: { forehand, backhand, serve, smash },
 *   power:   { forehand, backhand, serve, smash }   // indice 0-100
 *   spin:    { forehand: {topspin, flat, slice}, backhand: {...}, serve: {...} },
 *   impact:  [9 entiers]  // grille 3x3 du tamis, ligne par ligne depuis le haut
 *   sweetSpotPct, notes
 * }
 */
export function normalizeSession(s) {
  const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
  const out = {
    id: s.id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random())),
    date: new Date(s.date || Date.now()).toISOString(),
    source: s.source || 'manual',
    durationMin: num(s.durationMin),
    activeMin: num(s.activeMin),
    longestRally: num(s.longestRally),
    strokes: {},
    power: {},
    spin: s.spin && typeof s.spin === 'object' ? s.spin : null,
    impact: Array.isArray(s.impact) && s.impact.length === 9 ? s.impact.map((v) => num(v) || 0) : null,
    sweetSpotPct: num(s.sweetSpotPct),
    notes: typeof s.notes === 'string' ? s.notes : '',
  };
  for (const { key } of STROKES) {
    out.strokes[key] = num(s.strokes?.[key]) || 0;
    const p = num(s.power?.[key]);
    if (p != null) out.power[key] = p;
  }
  if (out.sweetSpotPct == null && out.impact) {
    const total = out.impact.reduce((a, b) => a + b, 0);
    if (total) out.sweetSpotPct = Math.round((out.impact[4] / total) * 100);
  }
  return out;
}

export function totalStrokes(s) {
  return STROKES.reduce((a, { key }) => a + (s.strokes[key] || 0), 0);
}

export const store = {
  sessions() {
    return safeGet(KEY_SESSIONS, []).sort((a, b) => a.date.localeCompare(b.date));
  },
  saveAll(list) {
    return safeSet(KEY_SESSIONS, list);
  },
  upsert(session) {
    const list = this.sessions();
    const i = list.findIndex((x) => x.id === session.id);
    if (i >= 0) list[i] = session;
    else list.push(session);
    this.saveAll(list);
  },
  addMany(sessions) {
    const list = this.sessions();
    const ids = new Set(list.map((s) => s.id));
    let added = 0;
    for (const s of sessions) {
      if (ids.has(s.id)) continue;
      list.push(s);
      added++;
    }
    this.saveAll(list);
    return added;
  },
  remove(id) {
    this.saveAll(this.sessions().filter((s) => s.id !== id));
  },
  removeSource(source) {
    this.saveAll(this.sessions().filter((s) => s.source !== source));
  },
  settings() {
    return safeGet(KEY_SETTINGS, { extraUuids: [], range: 0 });
  },
  saveSettings(patch) {
    safeSet(KEY_SETTINGS, { ...this.settings(), ...patch });
  },
};

// ---------- import / export ----------

const CSV_COLUMNS = [
  'date', 'durationMin', 'activeMin', 'longestRally',
  'forehand', 'backhand', 'serve', 'smash',
  'power_forehand', 'power_backhand', 'power_serve', 'power_smash',
  'sweetSpotPct', 'notes',
];

export function toCsv(sessions) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = sessions.map((s) => [
    s.date, s.durationMin, s.activeMin, s.longestRally,
    s.strokes.forehand, s.strokes.backhand, s.strokes.serve, s.strokes.smash,
    s.power.forehand, s.power.backhand, s.power.serve, s.power.smash,
    s.sweetSpotPct, s.notes,
  ].map(esc).join(','));
  return [CSV_COLUMNS.join(','), ...rows].join('\n');
}

function parseCsvLine(line, sep) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function fromCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const sep = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const head = parseCsvLine(lines[0], sep).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line, sep);
    const r = Object.fromEntries(head.map((h, i) => [h, (cells[i] ?? '').trim().replace(',', '.')]));
    return normalizeSession({
      date: r.date,
      source: 'import',
      durationMin: r.durationMin,
      activeMin: r.activeMin,
      longestRally: r.longestRally,
      strokes: { forehand: r.forehand, backhand: r.backhand, serve: r.serve, smash: r.smash },
      power: { forehand: r.power_forehand, backhand: r.power_backhand, serve: r.power_serve, smash: r.power_smash },
      sweetSpotPct: r.sweetSpotPct,
      notes: r.notes,
    });
  });
}

export function fromJson(text) {
  const data = JSON.parse(text);
  const list = Array.isArray(data) ? data : Array.isArray(data.sessions) ? data.sessions : [];
  return list.map((s) => normalizeSession({ source: 'import', ...s }));
}

// ---------- données de démonstration ----------

export function demoSessions(n = 14) {
  // Générateur pseudo-aléatoire déterministe pour une démo stable.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const ri = (a, b) => Math.round(a + rnd() * (b - a));
  const out = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now - i * ri(3, 5) * 86400000);
    d.setHours(ri(9, 19), ri(0, 1) * 30, 0, 0);
    const prog = (n - i) / n; // légère progression au fil du temps
    const strokes = {
      forehand: ri(140, 260),
      backhand: ri(90, 190),
      serve: ri(25, 70),
      smash: ri(0, 14),
    };
    const impact = [ri(4, 12), ri(10, 22), ri(3, 10), ri(14, 30), 0, ri(12, 28), ri(4, 12), ri(12, 26), ri(3, 9)];
    const total = Object.values(strokes).reduce((a, b) => a + b, 0);
    impact[4] = Math.max(0, total - impact.reduce((a, b) => a + b, 0));
    const spinOf = (t) => {
      const top = ri(35, 60), slice = ri(8, 25);
      return { topspin: Math.round(t * top / 100), slice: Math.round(t * slice / 100), flat: t - Math.round(t * top / 100) - Math.round(t * slice / 100) };
    };
    out.push(normalizeSession({
      id: `demo-${i}`,
      source: 'demo',
      date: d.toISOString(),
      durationMin: ri(60, 105),
      activeMin: ri(18, 34),
      longestRally: ri(9, 26),
      strokes,
      power: {
        forehand: Math.round(ri(55, 68) + prog * 8),
        backhand: Math.round(ri(45, 60) + prog * 8),
        serve: Math.round(ri(62, 78) + prog * 6),
        smash: ri(60, 80),
      },
      spin: { forehand: spinOf(strokes.forehand), backhand: spinOf(strokes.backhand), serve: spinOf(strokes.serve) },
      impact,
      notes: 'Séance de démonstration',
    }));
  }
  return out;
}
