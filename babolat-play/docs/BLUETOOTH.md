# Synchronisation Bluetooth de la raquette Babolat Play : état de l'enquête

Objectif : récupérer les séances sans câble, comme le faisait l'appli Babolat Play.
Ce document distingue ce qui est **établi**, ce qui est **probable** et ce qui reste **à vérifier**.

## 1. Quel Bluetooth ? Très probablement le Bluetooth « classique »

| Indice | Source | Ce qu'il indique |
|---|---|---|
| Dossier de certification radio FCC **2AAESPLAY2013** (Babolat VS, modèle PLAY2013, 2013) : classe d'équipement **DSS**, 2402–2480 MHz | [fccid.io](https://fccid.io/2AAESPLAY2013), [fcc.report](https://fcc.report/FCC-ID/2AAESPLAY2013) | « DSS » = émetteur à saut de fréquence = **Bluetooth classique (BR/EDR)**. Un appareil Bluetooth Low Energy est classé « DTS ». Aucun dossier DTS trouvé pour la raquette. |
| Le manuel demande un téléphone compatible **Bluetooth 2.1** | manuel Babolat PLAY (manualslib) | Bluetooth 2.1 = classique ; le Low Energy n'existe qu'à partir de 4.0. |
| Appareils compatibles : **iPhone 4**, 4S, 5 sous iOS 6+ | manuel Babolat PLAY | L'iPhone 4 n'a **pas** de Bluetooth Low Energy : la synchro iPhone passait forcément par le classique. |
| Jumelage dans les **réglages Bluetooth du téléphone** (LED violette), puis synchro dans l'appli | [support Babolat (iOS)](https://babolat.zendesk.com/hc/en-us/articles/360000357605-iOS-How-to-synchronise-a-session-with-a-PLAY-Racket-) | Comportement typique d'un accessoire Bluetooth classique. |
| Le manuel reprend la mention Apple **« Made for iPhone »** | manuel Babolat PLAY | Sur iPhone, un accessoire classique qui échange des données doit être certifié MFi (protocole Apple iAP). |
| Une page du manuel parle de « Bluetooth Smart » | manuel Babolat PLAY | En contradiction avec les points ci-dessus ; probablement un abus de langage marketing. **À vérifier** (étape A). |
| Le capteur Babolat **POP** (2015, FCC 2AAES-POP2015) est en Bluetooth 4.0 LE | fcc.report | Autre produit : ne pas confondre. |

**Conclusion provisoire :** la raquette expose très probablement
- un **port série Bluetooth (SPP / RFCOMM)**, utilisé par l'appli Android ;
- un service **Apple iAP2** (accessoire MFi), utilisé par l'appli iPhone.

## 2. Ce que ça change selon l'appareil

| Appareil | Bluetooth classique accessible ? | Comment |
|---|---|---|
| **Mac / PC** | ✅ | Chrome ou Edge : API Web Serial (port série Bluetooth), déjà intégrée au **Labo capteur**. Ou l'outil `tools/mac/racket-probe.swift`. |
| **Android** | ✅ probable | Une appli native peut ouvrir le port série. (Chrome Android et Web Serial : à vérifier.) |
| **iPhone** | ⚠️ seulement via iAP2 | iOS interdit le port série Bluetooth aux applis. Seule voie : le framework *External Accessory* avec la « chaîne de protocole » MFi de Babolat déclarée dans l'appli. En principe possible pour une appli installée depuis Xcode (usage personnel) ; une publication sur l'App Store exigerait l'accord de Babolat. **À vérifier** (étape D). |
| **Navigateur sur iPhone** | ❌ | Ni Web Bluetooth (sauf Bluefy, Low Energy uniquement) ni Web Serial. |

Le rapport d'homologation ITF (2013) indique aussi que le transfert était **chiffré et lié au compte Babolat**.
Les fichiers lus en USB, eux, sont en clair : le chiffrement ne concerne peut-être que la liaison Bluetooth ou l'envoi au serveur. **À vérifier** (étape C).

## 3. Plan

**A. Confirmer les services de la raquette (sur le Mac, 10 minutes)**
1. Allumer la raquette (ON → LED bleue), maintenir le bouton Bluetooth (→ LED violette clignotante).
2. Réglages Système › Bluetooth : jumeler la raquette.
3. Au choix :
   - Terminal, dans `babolat-play/tools/mac/` : `swift racket-probe.swift`. La liste des services avec leurs UUID et canaux RFCOMM s'affiche.
   - Ou Chrome : ouvrir l'appli › **Labo capteur › Bluetooth classique › Ouvrir le port série**.

Résultat attendu : un service « Port série (SPP) » et/ou « Apple iAP2 ».

**B. Écouter la raquette**
`swift racket-probe.swift --listen <canal>` ou le Labo dans Chrome : noter ce que la raquette envoie spontanément, exporter la capture.

**C. Retrouver les commandes de synchronisation dans l'ancienne appli Android**
Télécharger l'APK `com.babolat.play.android` (versions 1.x et 2.1.7) sur le Mac, le décompiler (jadx), puis chercher :
- l'ouverture du port série (`createRfcommSocketToServiceRecord`, UUID `00001101-…`) ;
- les octets envoyés pour lister ou télécharger les séances ;
- le format de la réponse : est-ce le même que les fichiers `LOG*.BIN` (en-tête de 50 octets, enregistrements de 13 octets) ?
- un éventuel chiffrement (`Cipher`, `AES`, `SecretKeySpec`) et l'origine de la clé (fixe dans l'appli, ou envoyée par le serveur Babolat, aujourd'hui fermé).

Le code de Babolat reste sur le Mac : seules nos propres notes et notre propre implémentation iront dans ce dépôt.

**D. Implémenter**
- Web (Mac/PC, Chrome) : synchro par Web Serial dans l'appli existante, réutilisant le décodeur `js/babolat-log.js`.
- iPhone : petite appli native (Swift, External Accessory) compilée avec Xcode sur le Mac et ton compte développeur.
  Première étape : une appli de test qui affiche `EAAccessoryManager.shared().connectedAccessories` et leurs `protocolStrings`.
  Si la raquette n'y apparaît pas, ou si iOS refuse la session sans certification, la synchro directe sur iPhone ne sera pas possible :
  on synchronisera depuis le Mac, puis on transférera la sauvegarde.

## 4. Risques

- **Clé côté serveur** : si la synchro exigeait une clé délivrée par les serveurs Babolat (fermés en 2021), le Bluetooth pourrait rester inutilisable. L'USB continue de fonctionner dans tous les cas.
- **Restrictions iPhone** : voir l'étape D.
- Rien n'est écrit dans la raquette tant qu'on ne lui envoie pas de commande. Les essais de commandes se feront avec prudence, de préférence après avoir importé et sauvegardé les séances par USB.
