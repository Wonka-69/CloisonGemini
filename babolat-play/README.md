# Play Tracker : suivi pour raquette Babolat Play

Application web installable sur téléphone (PWA), sans App Store, pour remplacer l'appli
Babolat Play qui a été retirée. Elle se connecte au capteur du manche en Bluetooth et
garde l'historique des séances **sur ton téléphone uniquement** (aucun serveur, aucun compte).

## Ce qui fonctionne aujourd'hui

| Fonction | État |
|---|---|
| Connexion Bluetooth à la raquette | ✅ |
| Batterie, fabricant, modèle, n° de série, version du firmware (services Bluetooth standard) | ✅ si la raquette les expose |
| Liste de tous les services et caractéristiques du capteur | ✅ |
| Journal des paquets envoyés par le capteur, octets modifiés surlignés, export de la capture | ✅ |
| Envoi de commandes brutes au capteur (expérimentation) | ✅ |
| Tableau de bord : coups par type, répartition, puissance, zone d'impact, effets, temps de jeu | ✅ |
| Saisie manuelle, import et export JSON / CSV, mode hors-ligne | ✅ |
| **Récupération automatique des séances stockées dans la raquette** | ⏳ protocole à décoder (voir plus bas) |

Babolat n'a jamais publié le protocole de son capteur. D'après le rapport d'homologation
ITF de 2013, la synchronisation était chiffrée et liée au compte Babolat. L'appli contient
donc un **labo** pour observer ce que la raquette envoie. Dès que le format des séances
est identifié, on l'ajoute dans `js/protocol.js` et le bouton « Synchroniser » remplit le
tableau de bord automatiquement.

## Installer l'appli sur ton téléphone

Le Bluetooth web exige une page en **HTTPS**. Le plus simple est GitHub Pages :

1. Sur GitHub : *Settings › Pages › Source : Deploy from a branch*, choisis la branche et le dossier racine `/`.
2. L'appli est alors en ligne à l'adresse `https://<ton-compte>.github.io/CloisonGemini/babolat-play/`.

Ensuite, selon ton téléphone :

- **iPhone / iPad** : Safari ne donne **pas** accès au Bluetooth. Installe le navigateur gratuit
  **Bluefy – Web BLE Browser** (App Store) et ouvre l'adresse dedans. Pour consulter
  ton historique, Safari suffit (*Partager › Sur l'écran d'accueil*). Attention : Safari et
  Bluefy n'ont pas le même stockage. Utilise *Exporter / Importer* pour passer les séances de l'un à l'autre.
- **Android** : ouvre l'adresse dans **Chrome**, puis menu ⋮ › *Installer l'application*.
- **Ordinateur** : Chrome ou Edge (Windows, macOS, Linux, ChromeOS).

Pour tester en local : `python3 -m http.server 8000` dans ce dossier, puis `http://localhost:8000`
(localhost est accepté sans HTTPS).

## Utilisation

1. **Raquette** : allume le capteur (bouton sous le manche), puis appuie sur *Rechercher la raquette* et choisis l'appareil.
2. **Séances** : ajoute une séance à la main, ou importe un fichier JSON / CSV.
3. **Tableau de bord** : filtre par période (7, 30, 90 jours ou tout). Chaque graphique a une vue *Tableau*.
4. **Démo** : sur un tableau de bord vide, *Charger la démo* affiche des données fictives (supprimables).

Colonnes CSV acceptées :
`date, durationMin, activeMin, longestRally, forehand, backhand, serve, smash, power_forehand, power_backhand, power_serve, power_smash, sweetSpotPct, notes`

## Décoder le protocole de la raquette (pour la synchro automatique)

Méthode la plus rapide d'abord :

1. **Repérer les services** : installe *nRF Connect* (iOS/Android), allume la raquette et connecte-toi.
   Note les UUID des services « Unknown Service ». S'ils sont longs (128 bits), colle-les dans
   *Labo capteur › Services supplémentaires*, puis reconnecte dans Play Tracker
   (les UUID courts `FE00` à `FFFF` sont déjà inclus).
2. **Observer** : dans *Labo capteur*, fais des gestes avec la raquette (coup droit, revers, service)
   et regarde quelles caractéristiques envoient des paquets et quels octets changent.
   *Décoder* affiche une analyse : octets fixes (en-têtes), compteurs, octets variables (mesures).
3. **L'ancienne appli Android** (le plus efficace) : l'APK *Babolat Play* existe encore sur des
   sites d'archives d'APK. En la décompilant avec **jadx**, on retrouve les UUID, les commandes
   de synchronisation, le format des paquets et l'éventuelle clé de chiffrement.
   Si elle fonctionne encore sur un vieil Android, active *Options pour les développeurs ›
   Journal HCI Bluetooth*, lance une synchro, puis ouvre le journal dans Wireshark pour voir l'échange exact.
4. **Implémenter** : compléter `decode()` dans `js/protocol.js` (décodeur `babolat-play-v1`),
   qui reçoit la capture et renvoie des séances au format décrit dans `js/store.js`.

Analyser un appareil qui t'appartient pour le rendre interopérable est autorisé dans l'UE
(directive 2009/24/CE, article 6).

## Structure

```
index.html            interface (4 onglets)
css/style.css         thème clair/sombre
js/app.js             logique de l'interface
js/ble.js             connexion Web Bluetooth, découverte GATT, journal des paquets
js/protocol.js        UUID connus, décodage standard, analyse de capture, décodeurs de séances
js/store.js           modèle de séance, stockage local, import/export, démo
js/charts.js          graphiques SVG sans dépendance
sw.js                 cache hors-ligne
manifest.webmanifest  installation en tant qu'appli
```
