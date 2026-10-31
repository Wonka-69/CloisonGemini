// Connexion Bluetooth Low Energy à la raquette via Web Bluetooth.
import {
  candidateServices, decodeStandard, KNOWN_CHARS, KNOWN_SERVICES, shortUuid, toHex,
} from './protocol.js';

export function bluetoothSupport() {
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!window.isSecureContext) {
    return { ok: false, reason: 'la page doit être servie en HTTPS (ou depuis localhost).' };
  }
  if (!('bluetooth' in navigator)) {
    if (isIOS) {
      return {
        ok: false,
        reason: "les navigateurs iPhone n'ont pas accès au Bluetooth. L'import USB ci-dessus fonctionne sans. " +
          "Pour essayer le Bluetooth, ouvre cette page dans le navigateur gratuit « Bluefy – Web BLE Browser ».",
      };
    }
    return { ok: false, reason: 'ce navigateur ne gère pas Web Bluetooth (il faut Chrome ou Edge). L\'import USB ci-dessus fonctionne sans.' };
  }
  return { ok: true };
}

/**
 * Événements émis :
 *  - 'status'  { state: 'off' | 'busy' | 'on', label }
 *  - 'packet'  { t, dir: 'in' | 'read' | 'out', svc, chr, hex }
 *  - 'tree'    { services }   arborescence GATT découverte
 *  - 'info'    { info }       valeurs standard décodées (batterie, modèle...)
 */
export class RacketConnection extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.server = null;
    this.chars = new Map(); // id "svc|chr" -> BluetoothRemoteGATTCharacteristic
    this.capture = RacketConnection.emptyCapture();
    this._onNotify = this._onNotify.bind(this);
    this._onDisconnect = this._onDisconnect.bind(this);
  }

  static emptyCapture() {
    return { format: 'playtracker-capture/1', startedAt: new Date().toISOString(), device: null, info: {}, services: [], packets: [] };
  }

  get connected() {
    return !!this.server?.connected;
  }

  _emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  _status(state, label) {
    this._emit('status', { state, label });
  }

  /** Journalisation partagée (utilisée aussi par le port série Bluetooth classique). */
  log(dir, svc, chr, bytes) {
    this._log(dir, svc, chr, bytes);
  }

  _log(dir, svc, chr, bytes) {
    const pkt = { t: Date.now(), dir, svc, chr, hex: toHex(bytes) };
    this.capture.packets.push(pkt);
    this._emit('packet', pkt);
  }

  async connect(extraUuids = []) {
    this._status('busy', 'Recherche…');
    let device;
    try {
      device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: candidateServices(extraUuids),
      });
    } catch (e) {
      this._status('off', 'Raquette déconnectée');
      if (e.name === 'NotFoundError') return false; // l'utilisateur a fermé la liste
      throw e;
    }
    this.device = device;
    device.addEventListener('gattserverdisconnected', this._onDisconnect);
    this._status('busy', `Connexion à ${device.name || 'appareil'}…`);
    this.server = await device.gatt.connect();
    this.capture = RacketConnection.emptyCapture();
    this.capture.device = { name: device.name || null, id: device.id };
    await this.discover();
    this._status('on', device.name || 'Raquette connectée');
    return true;
  }

  async discover() {
    this.chars.clear();
    const tree = [];
    const info = {};
    let services = [];
    try {
      services = await this.server.getPrimaryServices();
    } catch (e) {
      // NotFoundError : aucun service autorisé n'existe sur l'appareil.
      if (e.name !== 'NotFoundError') throw e;
    }
    for (const svc of services) {
      const node = { uuid: svc.uuid, name: KNOWN_SERVICES[svc.uuid] || null, chars: [] };
      let chars = [];
      try { chars = await svc.getCharacteristics(); } catch { /* service vide ou bloqué */ }
      for (const c of chars) {
        const id = `${svc.uuid}|${c.uuid}`;
        this.chars.set(id, c);
        const p = c.properties;
        const props = ['read', 'write', 'writeWithoutResponse', 'notify', 'indicate'].filter((k) => p[k]);
        const cn = { id, uuid: c.uuid, name: KNOWN_CHARS[c.uuid] || null, props, value: null, decoded: null };
        if (p.read) {
          try {
            const dv = await c.readValue();
            const bytes = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
            cn.value = toHex(bytes);
            cn.decoded = decodeStandard(c.uuid, bytes);
            if (cn.decoded && cn.name) info[cn.name] = cn.decoded;
            this._log('read', svc.uuid, c.uuid, bytes);
          } catch (e) {
            cn.value = `lecture refusée (${e.name})`;
          }
        }
        if (p.notify || p.indicate) {
          try {
            c.addEventListener('characteristicvaluechanged', this._onNotify);
            await c.startNotifications();
            cn.subscribed = true;
          } catch {
            cn.subscribed = false;
          }
        }
        node.chars.push(cn);
      }
      tree.push(node);
    }
    this.capture.services = tree.map((s) => ({ uuid: s.uuid, chars: s.chars.map((c) => ({ uuid: c.uuid, props: c.props })) }));
    this.capture.info = info;
    this._emit('tree', { services: tree });
    this._emit('info', { info });
    return tree;
  }

  _onNotify(ev) {
    const c = ev.target;
    const dv = c.value;
    this._log('in', c.service.uuid, c.uuid, new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength));
  }

  _onDisconnect() {
    this._status('off', 'Raquette déconnectée');
  }

  writableChars() {
    return [...this.chars.entries()]
      .filter(([, c]) => c.properties.write || c.properties.writeWithoutResponse)
      .map(([id, c]) => ({ id, label: `${KNOWN_CHARS[c.uuid] || shortUuid(c.uuid)} (service ${shortUuid(c.service.uuid)})` }));
  }

  async write(id, bytes) {
    const c = this.chars.get(id);
    if (!c) throw new Error('Caractéristique inconnue');
    if (c.properties.write && c.writeValueWithResponse) await c.writeValueWithResponse(bytes);
    else if (c.writeValueWithoutResponse) await c.writeValueWithoutResponse(bytes);
    else await c.writeValue(bytes);
    this._log('out', c.service.uuid, c.uuid, bytes);
  }

  disconnect() {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this._status('off', 'Raquette déconnectée');
  }
}
