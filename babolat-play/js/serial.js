// Bluetooth « classique » (BR/EDR) via l'API Web Serial : profil port série (SPP / RFCOMM).
//
// Pourquoi : le dossier FCC de la raquette (2AAESPLAY2013) la classe « DSS » (saut de fréquence,
// donc Bluetooth classique et non Low Energy), et l'appli d'origine acceptait l'iPhone 4, qui
// n'a pas de Bluetooth Low Energy. Web Bluetooth ne voit que le Low Energy ; Web Serial, lui,
// peut ouvrir un port série Bluetooth classique (Chrome / Edge sur ordinateur).
//
// Mode d'emploi : jumeler d'abord la raquette dans les réglages Bluetooth de l'ordinateur
// (LED violette clignotante), puis ouvrir le port depuis le Labo.

export const SPP_UUID = '00001101-0000-1000-8000-00805f9b34fb';

export function serialSupport() {
  if (!window.isSecureContext) return { ok: false, reason: 'la page doit être servie en HTTPS.' };
  if (!('serial' in navigator)) {
    return { ok: false, reason: "ce navigateur n'a pas l'API Web Serial : utilise Chrome ou Edge sur ordinateur (Mac, Windows, Linux)." };
  }
  return { ok: true };
}

/**
 * log(dir, svc, chr, bytes) : fonction de journalisation partagée avec la connexion Bluetooth LE,
 * pour que tous les paquets arrivent dans la même capture.
 * Événements : 'status' { state: 'off' | 'busy' | 'on', label }
 */
export class SerialLink extends EventTarget {
  constructor(log) {
    super();
    this.log = log;
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.info = null;
  }

  get connected() {
    return !!this.port && !!this.writer;
  }

  _status(state, label) {
    this.dispatchEvent(new CustomEvent('status', { detail: { state, label } }));
  }

  /** Ouvre le port. extraServiceIds : UUID de services RFCOMM supplémentaires à autoriser. */
  async connect({ baudRate = 115200, extraServiceIds = [] } = {}) {
    let port;
    try {
      port = await navigator.serial.requestPort({
        allowedBluetoothServiceClassIds: [SPP_UUID, ...extraServiceIds],
      });
    } catch (e) {
      if (e.name === 'NotFoundError') return false; // liste fermée sans choix
      throw e;
    }
    this._status('busy', 'Ouverture du port série…');
    // Sur un port Bluetooth, la vitesse est ignorée mais reste obligatoire pour l'API.
    await port.open({ baudRate, bufferSize: 4096 });
    this.port = port;
    this.info = port.getInfo?.() || {};
    this.writer = port.writable.getWriter();
    port.addEventListener?.('disconnect', () => this._closed());
    this._status('on', 'Port série ouvert');
    this._readLoop();
    return true;
  }

  get label() {
    const i = this.info || {};
    return i.bluetoothServiceClassId ? `Port série Bluetooth (${i.bluetoothServiceClassId.slice(0, 8)})` : 'Port série';
  }

  async _readLoop() {
    const svc = this.info?.bluetoothServiceClassId || 'serial';
    while (this.port?.readable) {
      this.reader = this.port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value?.length) this.log('in', svc, 'rfcomm', value);
        }
      } catch {
        // erreur de lecture (déconnexion) : on sort
        break;
      } finally {
        this.reader.releaseLock();
        this.reader = null;
      }
    }
    this._closed();
  }

  async write(bytes) {
    if (!this.writer) throw new Error('port série fermé');
    await this.writer.write(bytes);
    this.log('out', this.info?.bluetoothServiceClassId || 'serial', 'rfcomm', bytes);
  }

  async disconnect() {
    try { await this.reader?.cancel(); } catch { /* déjà fermé */ }
    try { this.writer?.releaseLock(); } catch { /* rien */ }
    try { await this.port?.close(); } catch { /* rien */ }
    this._closed();
  }

  _closed() {
    if (!this.port && !this.writer) return;
    this.port = null;
    this.writer = null;
    this._status('off', 'Port série fermé');
  }
}
