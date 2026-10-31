// Connaissance du protocole : services Bluetooth standard (décodés pour de vrai)
// + emplacement du décodeur propriétaire Babolat (à compléter une fois le format identifié).

const BASE = '-0000-1000-8000-00805f9b34fb';
export const uuid16 = (n) => `0000${n.toString(16).padStart(4, '0')}${BASE}`;

export function shortUuid(u) {
  const s = String(u).toLowerCase();
  return s.endsWith(BASE) && s.startsWith('0000') ? '0x' + s.slice(4, 8) : s;
}

export const KNOWN_SERVICES = {
  [uuid16(0x180a)]: 'Informations appareil',
  [uuid16(0x180f)]: 'Batterie',
  [uuid16(0x1800)]: 'Accès générique',
  [uuid16(0x1801)]: 'Attributs génériques',
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e': 'UART Nordic',
  [uuid16(0xfff0)]: 'Service propriétaire (FFF0)',
  [uuid16(0xffe0)]: 'Service propriétaire (FFE0)',
};

export const KNOWN_CHARS = {
  [uuid16(0x2a19)]: 'Niveau de batterie',
  [uuid16(0x2a29)]: 'Fabricant',
  [uuid16(0x2a24)]: 'Modèle',
  [uuid16(0x2a25)]: 'Numéro de série',
  [uuid16(0x2a26)]: 'Version firmware',
  [uuid16(0x2a27)]: 'Version matériel',
  [uuid16(0x2a28)]: 'Version logiciel',
  [uuid16(0x2a23)]: 'Identifiant système',
  [uuid16(0x2a50)]: 'PnP ID',
  [uuid16(0x2a00)]: "Nom de l'appareil",
  '6e400002-b5a3-f393-e0a9-e50e24dcca9e': 'UART RX (écriture)',
  '6e400003-b5a3-f393-e0a9-e50e24dcca9e': 'UART TX (notifications)',
};

const TEXT_CHARS = new Set([0x2a29, 0x2a24, 0x2a25, 0x2a26, 0x2a27, 0x2a28, 0x2a00].map(uuid16));

/** Services demandés au navigateur. Web Bluetooth n'expose QUE les services listés ici. */
export function candidateServices(extra = []) {
  const list = new Set([
    uuid16(0x180a),
    uuid16(0x180f),
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // UART Nordic
    'f000ffc0-0451-4000-b000-000000000000', // OAD Texas Instruments
    'f000aa00-0451-4000-b000-000000000000',
  ]);
  // Plage des UUID 16 bits souvent utilisés par les fabricants pour leurs services privés.
  for (let n = 0xfe00; n <= 0xffff; n++) list.add(uuid16(n));
  for (const u of extra) {
    const norm = normalizeUuid(u);
    if (norm) list.add(norm);
  }
  return [...list];
}

export function normalizeUuid(input) {
  const s = String(input).trim().toLowerCase();
  if (!s) return null;
  if (/^(0x)?[0-9a-f]{4}$/.test(s)) return uuid16(parseInt(s.replace('0x', ''), 16));
  if (/^(0x)?[0-9a-f]{8}$/.test(s)) return `${s.replace('0x', '')}${BASE}`;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s)) return s;
  if (/^[0-9a-f]{32}$/.test(s)) return s.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  return null;
}

export const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
export function fromHex(str) {
  const clean = String(str).replace(/0x/gi, '').replace(/[^0-9a-f]/gi, '');
  if (!clean || clean.length % 2) return null;
  return Uint8Array.from(clean.match(/../g), (h) => parseInt(h, 16));
}

/** Décode les caractéristiques standard. Renvoie une chaîne lisible ou null. */
export function decodeStandard(charUuid, bytes) {
  const u = charUuid.toLowerCase();
  if (u === uuid16(0x2a19) && bytes.length >= 1) return `${bytes[0]} %`;
  if (TEXT_CHARS.has(u)) {
    const txt = new TextDecoder().decode(bytes).replace(/\0+$/, '');
    return /^[\x20-\x7e -ɏ]*$/.test(txt) ? txt : null;
  }
  return null;
}

export function asciiPreview(bytes) {
  return Array.from(bytes, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '·')).join('');
}

// ---------------------------------------------------------------------------
// Analyse d'une capture : pour chaque caractéristique, quelles positions d'octets
// sont constantes (en-têtes, identifiants) et lesquelles varient (compteurs, mesures).
// ---------------------------------------------------------------------------
export function analyzeCapture(capture) {
  const byChar = new Map();
  for (const p of capture.packets) {
    if (p.dir === 'out') continue;
    if (!byChar.has(p.chr)) byChar.set(p.chr, []);
    byChar.get(p.chr).push(fromHex(p.hex) || new Uint8Array());
  }
  const result = [];
  for (const [chr, pkts] of byChar) {
    const lengths = [...new Set(pkts.map((b) => b.length))].sort((a, b) => a - b);
    const maxLen = lengths[lengths.length - 1] || 0;
    const positions = [];
    for (let i = 0; i < maxLen; i++) {
      const vals = pkts.filter((b) => b.length > i).map((b) => b[i]);
      const uniq = new Set(vals);
      const min = Math.min(...vals), max = Math.max(...vals);
      let monotonic = vals.length > 2;
      for (let k = 1; k < vals.length && monotonic; k++) {
        const d = (vals[k] - vals[k - 1] + 256) % 256;
        if (d !== 1) monotonic = false;
      }
      positions.push({
        index: i,
        kind: uniq.size === 1 ? 'constant' : monotonic ? 'compteur' : 'variable',
        min, max, distinct: uniq.size,
      });
    }
    result.push({ chr, name: KNOWN_CHARS[chr] || shortUuid(chr), count: pkts.length, lengths, positions });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Décodeurs de séances. Chacun reçoit une capture (voir ble.js) et renvoie
// { sessions: [...], message }. Les sessions doivent respecter le modèle de store.js.
// ---------------------------------------------------------------------------
export const decoders = [
  {
    id: 'babolat-play-v1',
    name: 'Babolat Play (Pure Drive / Pure Aero / Pure Strike, 2013–2019)',
    /** Reconnaît une capture provenant d'une raquette Babolat Play. */
    detect(capture) {
      const name = (capture.device?.name || '').toLowerCase();
      const maker = (capture.info?.['Fabricant'] || '').toLowerCase();
      return /babolat|bbl|play/.test(name) || /babolat|movea/.test(maker);
    },
    /**
     * À COMPLÉTER : le format des paquets de séance n'est pas documenté publiquement.
     * Une fois qu'une capture contient le transfert d'une séance (voir README, section
     * « Décoder le protocole »), implémenter ici la conversion paquets -> séances.
     */
    decode(_capture) {
      return {
        sessions: [],
        message: "Raquette reconnue, mais le format des séances n'est pas encore décodé. " +
          'Exporte la capture : elle sert à écrire ce décodeur.',
      };
    },
  },
];

export function runDecoders(capture) {
  for (const d of decoders) {
    if (d.detect(capture)) return { decoder: d, ...d.decode(capture) };
  }
  return { decoder: null, sessions: [], message: 'Aucun décodeur ne reconnaît cet appareil.' };
}
