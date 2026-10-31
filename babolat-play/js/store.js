// Stockage local des séances et des réglages (reste sur l'appareil, rien n'est envoyé en ligne).

export const STROKES = [
  { key: 'forehand', label: 'Coup droit', color: 'var(--s1)' },
  { key: 'backhand', label: 'Revers', color: 'var(--s2)' },
  { key: 'serve', label: 'Service', color: 'var(--s3)' },
  { key: 'volley', label: 'Volée', color: 'var(--s4)' },
  { key: 'smash', label: 'Smash', color: 'var(--s5)' },
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
 *   strokes:  { forehand, backhand, serve, volley, smash },
 *   speed:    { forehand, ... }   // vitesse moyenne en km/h (balle pour le service, raquette sinon)
 *   maxSpeed: { forehand, ... }   // vitesse maximale en km/h
 *   spin:     { forehand: {topspin, flat, slice}, backhand: {...}, ... },
 *   swings:   [[t (s), coup (index STROKES), effet (0 plat, 1 lifté, 2 slicé, -1 ?), km/h, bug d'horloge 0/1], ...]
 *   impact:   [9 entiers]  // grille 3x3 du tamis (pas encore décodée depuis la raquette)
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
    speed: {},
    maxSpeed: {},
    swings: Array.isArray(s.swings) ? s.swings : null,
    spin: s.spin && typeof s.spin === 'object' ? s.spin : null,
    impact: Array.isArray(s.impact) && s.impact.length === 9 ? s.impact.map((v) => num(v) || 0) : null,
    sweetSpotPct: num(s.sweetSpotPct),
    notes: typeof s.notes === 'string' ? s.notes : '',
  };
  for (const { key } of STROKES) {
    out.strokes[key] = num(s.strokes?.[key]) || 0;
    const v = num(s.speed?.[key]);
    if (v != null) out.speed[key] = v;
    const m = num(s.maxSpeed?.[key]);
    if (m != null) out.maxSpeed[key] = m;
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
  /** Ajoute les séances nouvelles. Avec replace=true, une séance déjà connue est remplacée
   *  (réimport d'un fichier de la raquette qui a grandi, ou décodage amélioré). */
  addMany(sessions, { replace = false } = {}) {
    const list = this.sessions();
    const index = new Map(list.map((s, i) => [s.id, i]));
    let added = 0, updated = 0;
    for (const s of sessions) {
      if (index.has(s.id)) {
        if (!replace) continue;
        const old = list[index.get(s.id)];
        list[index.get(s.id)] = { ...s, notes: old.notes || s.notes };
        updated++;
        continue;
      }
      list.push(s);
      added++;
    }
    if (!this.saveAll(list)) throw new Error("stockage du téléphone plein ou bloqué");
    return replace ? { added, updated } : added;
  },
  remove(id) {
    this.saveAll(this.sessions().filter((s) => s.id !== id));
  },
  removeSource(source) {
    this.saveAll(this.sessions().filter((s) => s.source !== source));
  },
  settings() {
    return safeGet(KEY_SETTINGS, { extraUuids: [], range: 0, clock: null });
  },
  saveSettings(patch) {
    safeSet(KEY_SETTINGS, { ...this.settings(), ...patch });
  },
};

// ---------- import / export ----------

const CSV_COLUMNS = [
  'date', 'durationMin', 'activeMin', 'longestRally',
  'forehand', 'backhand', 'serve', 'volley', 'smash',
  'speed_forehand', 'speed_backhand', 'speed_serve', 'speed_volley', 'speed_smash',
  'max_serve', 'sweetSpotPct', 'notes',
];

export function toCsv(sessions) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = sessions.map((s) => [
    s.date, s.durationMin, s.activeMin, s.longestRally,
    s.strokes.forehand, s.strokes.backhand, s.strokes.serve, s.strokes.volley, s.strokes.smash,
    s.speed.forehand, s.speed.backhand, s.speed.serve, s.speed.volley, s.speed.smash,
    s.maxSpeed.serve, s.sweetSpotPct, s.notes,
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
      strokes: { forehand: r.forehand, backhand: r.backhand, serve: r.serve, volley: r.volley, smash: r.smash },
      speed: { forehand: r.speed_forehand, backhand: r.speed_backhand, serve: r.speed_serve, volley: r.speed_volley, smash: r.speed_smash },
      maxSpeed: { serve: r.max_serve },
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
      volley: ri(10, 50),
      smash: 0,
    };
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
      speed: {
        forehand: Math.round(ri(50, 60) + prog * 6),
        backhand: Math.round(ri(44, 52) + prog * 6),
        serve: Math.round(ri(98, 110) + prog * 8),
        volley: ri(20, 28),
      },
      maxSpeed: { forehand: ri(85, 98), backhand: ri(68, 80), serve: Math.round(ri(124, 136) + prog * 6), volley: ri(45, 60) },
      spin: { forehand: spinOf(strokes.forehand), backhand: spinOf(strokes.backhand), serve: spinOf(strokes.serve), volley: spinOf(strokes.volley) },
      notes: 'Séance de démonstration',
    }));
  }
  return out;
}
