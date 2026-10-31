# Play Tracker : suivi pour raquette Babolat Play

Application web installable sur téléphone (PWA), sans App Store, pour remplacer l'appli
Babolat Play qui a été retirée. Elle lit les séances enregistrées par le capteur du manche
et garde l'historique **sur ton appareil uniquement** (aucun serveur, aucun compte).

## Ce qui fonctionne aujourd'hui

| Fonction | État |
|---|---|
| **Import des séances depuis la raquette par câble USB** (fichiers `LOG*.BIN`) | ✅ |
| Nombre de coups : coup droit, revers, service, volée, avec l'heure de chaque coup | ✅ |
| Vitesse moyenne et maximale par coup (balle au service, raquette sinon), effet lifté / plat / slicé | ✅ (valeurs déduites, voir plus bas) |
| Correction de la date quand l'horloge de la raquette s'est réinitialisée (batterie vide) | ✅ |
| Tableau de bord, évolution de la vitesse, détail de chaque séance par tranche de 5 minutes | ✅ |
| Archivage des fichiers bruts de la raquette et redécodage de tout l'historique | ✅ |
| Sauvegarde complète en un clic, restauration sans doublons, rappels de sauvegarde et d'installation | ✅ |
| Saisie manuelle, import JSON / CSV, export CSV, mode hors-ligne, thème clair et sombre | ✅ |
| Connexion Bluetooth : batterie, firmware, journal des paquets (labo) | 🧪 expérimental |
| Smash et zone d'impact sur le tamis | ❌ pas encore décodés dans les fichiers de la raquette |

### D'où vient le décodage

Le format des fichiers de la raquette a été rétro-conçu par le projet open source
[**babolat-play-dashboard**](https://github.com/sgupta382/babolat-play-dashboard)
(Saurabh Gupta, licence MIT). `js/babolat-log.js` en est une traduction en JavaScript, qui donne
exactement le même résultat que l'original sur ses fichiers de test.
Leur document [FILE_FORMAT.md](https://github.com/sgupta382/babolat-play-dashboard/blob/main/docs/FILE_FORMAT.md)
détaille la fiabilité de chaque champ :

- **vérifié** : dates et durées des séances, nombre de coups, heure de chaque coup, coup droit / revers ;
- **calibré sur des séances étiquetées** : volées (la raquette les classe en coup droit / revers ; les coups lents à plat ou slicés sont comptés comme volées) ;
- **déduit** : service, effet et vitesses (cohérents mais pas encore vérifiés au radar) ;
- **inconnu** : smash, zone d'impact.

Le projet d'origine propose un protocole de calibration (séance où l'on note chaque coup joué) :
partager ses fichiers avec eux aide à améliorer le décodage pour tout le monde.

## Installer l'appli sur ton téléphone

L'appli doit être en ligne en **HTTPS**. Le plus simple est GitHub Pages :

1. Sur GitHub : *Settings › Pages › Source : Deploy from a branch*, choisis la branche et le dossier racine `/`.
2. L'appli est alors en ligne à l'adresse `https://<ton-compte>.github.io/CloisonGemini/babolat-play/`.

Ensuite, selon ton appareil :

- **iPhone / iPad** : ouvre l'adresse dans Safari, puis *Partager › Sur l'écran d'accueil*. L'import USB fonctionne dans Safari.
  Seul le Bluetooth (expérimental) demande le navigateur **Bluefy – Web BLE Browser**, qui a son propre stockage :
  utilise *Exporter / Importer* pour passer les séances de l'un à l'autre.
- **Android** : ouvre l'adresse dans **Chrome**, puis menu ⋮ › *Installer l'application*.
- **Ordinateur** : n'importe quel navigateur récent (Chrome ou Edge pour le Bluetooth).

Pour tester en local : `python3 -m http.server 8000` dans ce dossier, puis `http://localhost:8000`
(localhost est accepté sans HTTPS).

## Utilisation

1. **Raquette › Importer depuis la raquette (câble USB)** : branche la raquette (elle apparaît comme une clé USB
   nommée `BABOLAT`), puis sélectionne tous les fichiers `LOG000.BIN`, `LOG001.BIN`…
   - **Ordinateur** : n'importe quel câble micro-USB qui transmet les données ; le bouton *Choisir le dossier BABOLAT* prend tout d'un coup.
   - **Téléphone** : il faut un adaptateur (USB-C OTG, ou adaptateur Lightning vers USB pour appareil photo sur les anciens iPhone).
     La clé doit apparaître dans l'appli *Fichiers* (iPhone) ou le gestionnaire de fichiers (Android). Si elle n'apparaît pas,
     copie les fichiers sur un ordinateur puis transfère-les.
   - Les fichiers sont seulement lus. Réimporter les mêmes fichiers ne crée pas de doublons ; une séance qui a grandi est mise à jour.
   - Si la batterie s'est vidée, l'horloge de la raquette repart au 01/09/2012 : l'appli te demande alors l'heure de fin
     de ta dernière séance et corrige les dates.
2. **Tableau de bord** : filtre par période (7, 30, 90 jours ou tout). Chaque graphique a une vue *Tableau*.
3. **Séances** : touche une séance pour voir son détail (vitesses, effets, coups par tranche de 5 minutes).
   Tu peux aussi ajouter une séance à la main, importer ou exporter en JSON / CSV.
4. **Démo** : sur un tableau de bord vide, *Charger la démo* affiche des données fictives (supprimables).

## Tes données : où elles sont et comment ne pas les perdre

- Tout est stocké **sur l'appareil**, dans la base locale du navigateur (IndexedDB) : séances, réglages et
  **copie brute de chaque fichier `LOG*.BIN`** importé. Rien n'est envoyé sur Internet.
- **Fichiers bruts** : ils permettent de tout redécoder plus tard (*Séances › Redécoder l'historique*), par exemple
  quand le smash ou la zone d'impact seront décodés, même si la raquette a effacé ses fichiers entre-temps.
- **Sur iPhone**, Safari peut effacer les données d'un site non ouvert depuis 7 jours. **Installe l'appli sur l'écran
  d'accueil** : elle est alors protégée. Attention, l'appli installée a sa propre mémoire, séparée de Safari :
  pour y transférer des séances, fais *Sauvegarder tout* dans Safari puis *Restaurer* dans l'appli installée.
- **Sauvegarde** (*Séances › Sauvegarder tout*) : un seul fichier JSON avec les séances, les fichiers bruts et le
  réglage d'horloge. Sur téléphone, la feuille de partage permet de l'enregistrer dans Fichiers, iCloud Drive ou
  Google Drive. L'appli te le rappelle si tu n'as pas sauvegardé depuis 14 jours et que tu as de nouvelles séances.
- **Restauration** : elle **ajoute** les séances manquantes sans rien effacer. Tu peux restaurer plusieurs fois le même fichier.
- Les données des versions précédentes de l'appli (localStorage) sont migrées automatiquement.

Colonnes CSV acceptées :
`date, durationMin, activeMin, longestRally, forehand, backhand, serve, volley, smash, speed_forehand, speed_backhand, speed_serve, speed_volley, speed_smash, max_serve, sweetSpotPct, notes`

## Bluetooth (expérimental)

L'import USB suffit pour récupérer les séances. Le Bluetooth permettrait en plus une synchro sans câble,
mais son protocole n'est pas connu (d'après le rapport d'homologation ITF de 2013, il est chiffré).
L'onglet *Labo capteur* sert à l'étudier :

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
js/babolat-log.js     décodage des fichiers LOG*.BIN de la raquette (USB) et correction d'horloge
js/protocol.js        Bluetooth : UUID connus, décodage standard, analyse de capture
js/store.js           modèle de séance, stockage, sauvegarde / restauration, import/export, démo
js/db.js              accès IndexedDB (séances, réglages, fichiers bruts)
js/charts.js          graphiques SVG sans dépendance
sw.js                 cache hors-ligne
manifest.webmanifest  installation en tant qu'appli
```
