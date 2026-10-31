// Sonde Bluetooth classique pour la raquette Babolat Play (macOS).
//
// 1. Liste les appareils Bluetooth jumelés.
// 2. Interroge la raquette (requête SDP) et affiche chacun de ses services :
//    nom, UUID de classe de service, canal RFCOMM. On saura ainsi s'il y a un port série (SPP),
//    un service Apple iAP2 (accessoire « Made for iPhone ») ou un service propriétaire.
// 3. Option --listen : ouvre un canal RFCOMM et affiche en hexadécimal tout ce que la raquette
//    envoie. Chaque ligne tapée (octets en hexa, ex. « 01 a5 ff ») lui est envoyée.
//    Tout est aussi enregistré dans un fichier capture-*.txt.
//
// Utilisation (Terminal, dans ce dossier) :
//   swift racket-probe.swift                       # liste + services de l'appareil dont le nom contient « babolat »
//   swift racket-probe.swift --name play           # autre filtre sur le nom
//   swift racket-probe.swift --listen 1            # écoute sur le canal RFCOMM 1
//
// Prérequis : jumeler la raquette dans Réglages Système › Bluetooth (LED violette clignotante),
// outils de ligne de commande Xcode installés, et autoriser le Terminal à utiliser le Bluetooth
// (macOS le demande au premier lancement).

import Foundation
import IOBluetooth

// ---------- arguments ----------
var nameFilter = "babolat"
var listenChannel: BluetoothRFCOMMChannelID? = nil
var args = CommandLine.arguments.dropFirst().makeIterator()
while let a = args.next() {
    switch a {
    case "--name": nameFilter = (args.next() ?? nameFilter).lowercased()
    case "--listen": listenChannel = BluetoothRFCOMMChannelID(args.next() ?? "") ?? 1
    default: print("Argument inconnu : \(a)")
    }
}

func hex(_ bytes: UnsafeRawBufferPointer) -> String {
    bytes.map { String(format: "%02x", $0) }.joined(separator: " ")
}

let knownServices: [String: String] = [
    "00001101-0000-1000-8000-00805f9b34fb": "Port série (SPP)",
    "00000000-deca-fade-deca-deafdecacaff": "Apple iAP2 (accessoire Made for iPhone)",
    "00001200-0000-1000-8000-00805f9b34fb": "PnP Information",
    "00001000-0000-1000-8000-00805f9b34fb": "Service Discovery Server",
    "00001124-0000-1000-8000-00805f9b34fb": "HID",
]

// ---------- appareils jumelés ----------
let paired = (IOBluetoothDevice.pairedDevices() as? [IOBluetoothDevice]) ?? []
print("Appareils jumelés :")
for d in paired {
    print("  • \(d.name ?? "(sans nom)")  [\(d.addressString ?? "?")]  classe 0x\(String(d.classOfDevice, radix: 16))")
}
guard let racket = paired.first(where: { ($0.name ?? "").lowercased().contains(nameFilter) }) else {
    print("\nAucun appareil jumelé dont le nom contient « \(nameFilter) ».")
    print("Jumelle la raquette (LED violette) dans Réglages Système › Bluetooth, ou utilise --name <filtre>.")
    exit(1)
}
print("\nRaquette : \(racket.name ?? "?")  [\(racket.addressString ?? "?")]")

// ---------- requête SDP ----------
final class SDPWaiter: NSObject {
    var done = false
    @objc func sdpQueryComplete(_ device: IOBluetoothDevice!, status: IOReturn) {
        if status != kIOReturnSuccess { print("Requête SDP terminée avec le code \(status)") }
        done = true
    }
}
let waiter = SDPWaiter()
print("Interrogation des services (la raquette doit être allumée, LED violette)…")
let sdpStart = racket.performSDPQuery(waiter)
if sdpStart == kIOReturnSuccess {
    let deadline = Date().addingTimeInterval(20)
    while !waiter.done && Date() < deadline {
        RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
} else {
    print("Impossible de lancer la requête SDP (code \(sdpStart)) : affichage du dernier résultat connu.")
}

var firstRfcomm: BluetoothRFCOMMChannelID? = nil
let services = (racket.services as? [IOBluetoothSDPServiceRecord]) ?? []
print("\n\(services.count) service(s) :")
for rec in services {
    let name = rec.getServiceName() ?? "(sans nom)"
    var channel: BluetoothRFCOMMChannelID = 0
    let hasRfcomm = rec.getRFCOMMChannelID(&channel) == kIOReturnSuccess
    if hasRfcomm && firstRfcomm == nil { firstRfcomm = channel }
    print("  ▸ \(name)\(hasRfcomm ? "  — canal RFCOMM \(channel)" : "")")
    // Attribut 0x0001 : liste des classes de service (UUID).
    if let classes = rec.getAttributeDataElement(1)?.getArrayValue() as? [IOBluetoothSDPDataElement] {
        for el in classes {
            if let uuid = el.getUUIDValue() {
                let full = uuid.getWithLength(16)
                let s = full.map { b -> String in
                    let bytes = b.bytes.assumingMemoryBound(to: UInt8.self)
                    let h = (0..<16).map { String(format: "%02x", bytes[$0]) }.joined()
                    return "\(h.prefix(8))-\(h.dropFirst(8).prefix(4))-\(h.dropFirst(12).prefix(4))-\(h.dropFirst(16).prefix(4))-\(h.dropFirst(20))"
                } ?? "\(uuid)"
                print("      UUID \(s)  \(knownServices[s] ?? "")")
            }
        }
    }
}
if services.isEmpty { print("  (aucun : vérifie que la raquette est allumée et en mode jumelage)") }

guard let ch = listenChannel else {
    print("\nPour écouter la raquette : swift racket-probe.swift --listen \(firstRfcomm.map(String.init) ?? "<canal>")")
    exit(0)
}

// ---------- écoute RFCOMM ----------
let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
let logURL = URL(fileURLWithPath: "capture-\(stamp).txt")
FileManager.default.createFile(atPath: logURL.path, contents: nil)
let logHandle = try! FileHandle(forWritingTo: logURL)
func record(_ line: String) {
    let t = ISO8601DateFormatter().string(from: Date())
    print(line)
    logHandle.write("\(t) \(line)\n".data(using: .utf8)!)
}

final class Listener: NSObject, IOBluetoothRFCOMMChannelDelegate {
    func rfcommChannelData(_ rfcommChannel: IOBluetoothRFCOMMChannel!, data dataPointer: UnsafeMutableRawPointer!, length dataLength: Int) {
        record("← \(hex(UnsafeRawBufferPointer(start: dataPointer, count: dataLength)))")
    }
    func rfcommChannelClosed(_ rfcommChannel: IOBluetoothRFCOMMChannel!) {
        record("Canal fermé par la raquette.")
        exit(0)
    }
}
let listener = Listener()
var channelRef: IOBluetoothRFCOMMChannel? = nil
let openStatus = racket.openRFCOMMChannelSync(&channelRef, withChannelID: ch, delegate: listener)
guard openStatus == kIOReturnSuccess, let channel = channelRef else {
    print("Ouverture du canal RFCOMM \(ch) impossible (code \(openStatus)).")
    exit(1)
}
record("Canal RFCOMM \(ch) ouvert (MTU \(channel.getMTU())). Tape des octets en hexa puis Entrée pour les envoyer ; Ctrl+C pour quitter.")
print("Capture enregistrée dans \(logURL.path)")

// Lecture du clavier sur un fil séparé, envoi sur le fil principal.
DispatchQueue.global().async {
    while let line = readLine() {
        let clean = line.lowercased().replacingOccurrences(of: "0x", with: "").filter { "0123456789abcdef".contains($0) }
        guard !clean.isEmpty, clean.count % 2 == 0 else { print("Format : octets en hexa, ex. 01 a5 ff"); continue }
        var bytes = [UInt8]()
        var i = clean.startIndex
        while i < clean.endIndex {
            let j = clean.index(i, offsetBy: 2)
            bytes.append(UInt8(clean[i..<j], radix: 16)!)
            i = j
        }
        DispatchQueue.main.async {
            var copy = bytes
            let st = channel.writeSync(&copy, length: UInt16(copy.count))
            record("→ \(bytes.map { String(format: "%02x", $0) }.joined(separator: " "))\(st == kIOReturnSuccess ? "" : "  (échec \(st))")")
        }
    }
}
RunLoop.main.run()
