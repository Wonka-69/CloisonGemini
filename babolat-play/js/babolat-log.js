// Décodage des fichiers LOG*.BIN que la raquette Babolat Play expose quand elle est
// branchée en USB (elle apparaît comme une clé USB nommée « BABOLAT »).
//
// Format rétro-conçu par le projet babolat-play-dashboard, dont ce module est une
// traduction en JavaScript (parser.py et clock.py) :
//   https://github.com/sgupta382/babolat-play-dashboard  (docs/FILE_FORMAT.md)
//
// MIT License — Copyright (c) 2026 Saurabh Gupta
// Permission is hereby granted, free of charge, to any person obtaining a copy of this
// software and associated documentation files (the "Software"), to deal in the Software
// without restriction, including without limitation the rights to use, copy, modify,
// merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to the following
// conditions: The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
//
// Structure : un en-tête de 50 octets, puis des enregistrements de 13 octets.
//   - octet 0 = 0  : début de séance (heure, date, durée)
//   - octet 0 = 10 : marqueur interne (ignoré)
//   - sinon        : un coup détecté
// Fiabilité (d'après le projet d'origine) : vérifié pour les dates, durées, nombre de coups,
// horodatage et coup droit / revers ; déduit pour service, effet et vitesse ;
// non décodé : smash et zone d'impact.

export const HEADER_LEN = 50;
export const REC_LEN = 13;
const MAX_GAP_S = 1800; // un saut plus grand entre deux coups est un bug d'horloge, pas une pause
const MPH_TO_KMH = 1.609344;
const MARKER = 10;
const CLOCK_RESET_BEFORE = new Date(2013, 0, 1); // batterie vide : l'horloge repart au 01/09/2012
export const VOLLEY_MAX_MPH = 20;

// Tables de correspondance déduites : le seul endroit à modifier si le format est mieux compris.
export const STROKE_CODES = { 2: 'serve', 3: 'forehand', 4: 'backhand', 8: 'volley', 9: 'volley' };
export const SPIN_CODES = { 0: 'flat', 1: 'topspin', 2: 'slice' };

export class FormatError extends Error {}

function strokeOf(r) {
  const stroke = STROKE_CODES[r[0]] || 'unknown';
  if ((stroke === 'forehand' || stroke === 'backhand') && r[4] < VOLLEY_MAX_MPH && SPIN_CODES[r[2]] !== 'topspin') {
    return 'volley';
  }
  return stroke;
}

function speedKmh(stroke, r) {
  if (stroke === 'serve') return r[5] ? r[5] : null; // vitesse de balle, déjà en km/h
  return r[4] ? Math.round(r[4] * MPH_TO_KMH * 10) / 10 : null; // vitesse de raquette, en mph
}

const u16 = (r, i) => r[i] | (r[i + 1] << 8);
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function startTime(r) {
  const [h, mi, s, d, mo, y] = [r[1], r[2], r[3], r[4], r[5], r[6]];
  const date = new Date(2000 + y, mo - 1, d, h, mi, s);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59 || date.getDate() !== d) {
    throw new FormatError('date de début de séance invalide');
  }
  return date;
}

/** Empreinte stable d'une séance (même résultat à chaque import du même fichier). */
async function sessionId(header, rec) {
  const data = new Uint8Array(header.length + rec.length);
  data.set(header);
  data.set(rec, header.length);
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-1', data);
    return hex(new Uint8Array(digest)).slice(0, 16);
  }
  // Repli sans crypto.subtle (page hors HTTPS) : FNV-1a 2×32 bits.
  let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
  for (const x of data) {
    a = Math.imul(a ^ x, 0x01000193) >>> 0;
    b = Math.imul(b ^ x, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/**
 * Décode un fichier LOG*.BIN.
 * Renvoie [{ id, startedAt: Date, durationS, clockReset, source, swings: [{t, stroke, spin, zone, speedKmh, glitch, raw}] }]
 */
export async function parseLog(buffer, source = '') {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (data.length < HEADER_LEN || (data.length - HEADER_LEN) % REC_LEN) {
    throw new FormatError(`${data.length} octets : ce n'est pas un en-tête de ${HEADER_LEN} octets suivi d'enregistrements de ${REC_LEN} octets`);
  }
  const header = data.subarray(0, HEADER_LEN);
  const sessions = [];
  let prevT = 0;
  for (let off = HEADER_LEN; off < data.length; off += REC_LEN) {
    const r = data.subarray(off, off + REC_LEN);
    if (r[0] === 0) {
      const startedAt = startTime(r);
      sessions.push({
        id: await sessionId(header, r),
        startedAt,
        durationS: u16(r, 7),
        clockReset: startedAt < CLOCK_RESET_BEFORE,
        source,
        swings: [],
      });
      prevT = 0;
      continue;
    }
    if (!sessions.length || r[0] === MARKER) continue;
    const t = u16(r, 11);
    const stroke = strokeOf(r);
    sessions[sessions.length - 1].swings.push({
      t,
      stroke,
      spin: SPIN_CODES[r[2]] || 'unknown',
      zone: r[1],
      speedKmh: speedKmh(stroke, r),
      glitch: t - prevT > MAX_GAP_S,
      raw: hex(r),
    });
    prevT = t;
  }
  return sessions;
}

// ---------------------------------------------------------------------------
// Horloge réinitialisée : un seul décalage (heure réelle − heure raquette), mesuré
// sur une séance dont on connaît l'heure de fin, corrige toutes les séances depuis
// la réinitialisation. { offsetS, anchor (ms, heure raquette), ids }
// ---------------------------------------------------------------------------
export function calibrate(sessions, lastEnded) {
  const reset = sessions.filter((s) => s.clockReset);
  if (!reset.length) throw new Error('aucune séance avec une horloge réinitialisée');
  const anchor = Math.max(...reset.map((s) => s.startedAt.getTime() + s.durationS * 1000));
  return { offsetS: Math.round((lastEnded.getTime() - anchor) / 1000), anchor, ids: reset.map((s) => s.id) };
}

/** La séance avec sa vraie date, ou null si elle ne peut pas être datée (nouvelle réinitialisation). */
export function correctClock(clock, s) {
  if (!s.clockReset) return s;
  if (!clock) return null;
  if (!clock.ids.includes(s.id) && s.startedAt.getTime() <= clock.anchor) return null;
  return { ...s, startedAt: new Date(s.startedAt.getTime() + clock.offsetS * 1000) };
}

// ---------------------------------------------------------------------------
// Conversion vers le modèle de séance de l'appli (voir store.js).
// ---------------------------------------------------------------------------
const STROKE_KEYS = ['forehand', 'backhand', 'serve', 'volley', 'smash'];

export function toAppSession(s) {
  const strokes = Object.fromEntries(STROKE_KEYS.map((k) => [k, 0]));
  const sums = {}, counts = {}, max = {};
  const spin = {};
  for (const w of s.swings) {
    if (!(w.stroke in strokes)) continue;
    strokes[w.stroke]++;
    if (w.speedKmh) {
      sums[w.stroke] = (sums[w.stroke] || 0) + w.speedKmh;
      counts[w.stroke] = (counts[w.stroke] || 0) + 1;
      max[w.stroke] = Math.max(max[w.stroke] || 0, w.speedKmh);
    }
    if (w.spin !== 'unknown') {
      spin[w.stroke] ??= { topspin: 0, flat: 0, slice: 0 };
      spin[w.stroke][w.spin]++;
    }
  }
  const speed = Object.fromEntries(Object.keys(sums).map((k) => [k, Math.round((sums[k] / counts[k]) * 10) / 10]));
  // Temps actif : somme des intervalles entre coups de moins de 30 s.
  let active = 0;
  const ts = s.swings.filter((w) => !w.glitch).map((w) => w.t);
  for (let i = 1; i < ts.length; i++) {
    const d = ts[i] - ts[i - 1];
    if (d > 0 && d < 30) active += d;
  }
  return {
    id: `bbl-${s.id}`,
    date: s.startedAt.toISOString(),
    source: 'racket',
    durationMin: Math.round(s.durationS / 60),
    activeMin: Math.round(active / 60),
    strokes,
    speed,
    maxSpeed: max,
    spin,
    swings: s.swings.map((w) => [w.t, STROKE_KEYS.indexOf(w.stroke), ['flat', 'topspin', 'slice'].indexOf(w.spin), w.speedKmh ?? 0, w.glitch ? 1 : 0]),
    notes: s.source ? `Importée de ${s.source}` : '',
  };
}
