# TrueGlide

Firmware de contrôleur de vol basé sur **Betaflight 2026.6.2**, avec en plus :

| Ajout | Ce que ça fait | Par défaut |
|---|---|---|
| **Protection anti-surchauffe** (`power_guard_*`) | Limite les gaz si un ESC chauffe trop ou si le courant batterie dépasse une limite | Désactivée |
| **Mode SPEEDER** (`speeder_*`, mode 120) | Transition progressive du stationnaire (fuselage vertical) au vol rapide, en mode ANGLE | Inactif sans interrupteur |
| **Santé moteurs** (`motor_desync_recovery`, `dshot_telemetry_fallback`) | Relance un moteur désynchronisé ou calé ; vitesse juste pour le filtre RPM quand la télémétrie DShot se perd | Désactivée |
| **Analyse de journaux** (`trueglide/outils/analyse_blackbox.py`) | Rapport en français des défauts d'un fichier blackbox | — |
| **TrueGlide Studio** (`trueglide/studio/index.html`) | Réglage de départ selon le drone (Tiny Whoop 1,2" à 15"), analyse de configuration, missions GPS (modèles TRUENAV) | — |

Sans réglage TrueGlide, le firmware vole **exactement comme Betaflight 2026.6.2** : les ajouts ne font rien tant
qu'on ne les active pas.

## TRUEGLIDE et ses deux dérivés

Trois firmwares : **TRUEGLIDE** (le produit de base) et deux dérivés pour la navigation GPS, **TRUENAV** (combiné)
et **TRUENAV_LIGHT**. Dans `make` : `MODELE=TRUEGLIDE` (défaut), `TRUENAV` ou `TRUENAV_LIGHT`.

| Modèle | Pour qui | Contenu | Fichier |
|---|---|---|---|
| **TRUEGLIDE** | course, freestyle, cinéma | Betaflight 2026.6.2 + ajouts TrueGlide | `trueglide_2026.6.2_<MCU>_<CARTE>.hex` |
| **TRUENAV** | drones qui volent aussi en GPS | STANDARD + navigation complète : missions (mode AUTOPILOT), ALTHOLD, POSHOLD, GPS RESCUE, zone de vol (geofence), missions envoyées par MAVLink | `truenav_…` |
| **TRUENAV_LIGHT** | drones de navigation, longue portée | TRUENAV sans les fonctions de course (launch control, transpondeur de course, écran de pré-armement « spec », statistiques des manches) | `truenav_light_…` |

Betaflight ne construit son moteur de missions que pour le simulateur. Les modèles TRUENAV et TRUENAV_LIGHT le mettent sur
les vraies cartes, y compris les cartes à 512 Ko, où Betaflight ne met même pas le GPS. Mémoire mesurée (Ko) :

| Carte | STANDARD | TRUENAV | TRUENAV_LIGHT |
|---|---|---|---|
| MATEKF411 (512 Ko) | 381 | 467 | 464 |
| SPEEDYBEEF7V3 (F722, 512 Ko) | 397 | 492 | 490 |
| SPEEDYBEEF405MINI (1 Mo) | 546 | 572 | 566 |
| MATEKH743 (2 Mo) | — | 612 | 606 |

Le modèle TRUENAV_LIGHT ne gagne que 3 à 7 Ko : les fonctions de course pèsent peu. Le modèle TRUENAV tient déjà partout.
Sur une F722 à 512 Ko, il reste environ 20 Ko de libre.

Construire : `make CONFIG=<CARTE> MODELE=TRUENAV` (ou `TRUENAV_LIGHT`) ; sur GitHub, **Run workflow**, choix « modele ».
Dans les modèles TRUENAV, rien ne change en vol tant qu'aucun mode de navigation n'est placé sur un interrupteur.
Le GPS RESCUE garde le contrôleur habituel de Betaflight.

**Vérifié** : banc de missions de Betaflight en simulateur (`src/test/sitl/sitl_harness.py`), **19 scénarios sur 19
réussis** sur TrueGlide :
- mission, cap, départ à l'envers, virage serré ;
- décollage, atterrissage, orbite, huit ;
- perte radio (arrêt, poursuite, atterrissage) ;
- zone de vol (atterrissage, retour, retour malgré la perte radio) ;
- GPS RESCUE (retour, cap faux, perte du GPS, descente).

Les modèles se construisent sur F411, F722, F405, H743 et AT32F435. Le simulateur fait voler le GPS RESCUE en version
« mission » ; sur les cartes, TRUENAV garde le GPS RESCUE habituel de Betaflight. **Pas encore vérifié en vol réel.**

**Par rapport à INAV et ArduPilot** :
- **Comme eux** : missions GPS (points de passage, attente, orbite, atterrissage, décollage, changement d'altitude),
  maintien d'altitude et de position, retour à la maison, zone de vol, missions envoyées par MAVLink.
- **Mieux pour le vol** : le pilotage de Betaflight (filtre RPM, réglages simplifiés, réactivité), et les
  protections TrueGlide (moteurs, surchauffe).
- **Moins mûr** : le moteur de missions de Betaflight est récent (2026) et expérimental. INAV (toujours développé)
  et ArduPilot ont des années de vols réels.
- **Pas encore là** :
  - ailes volantes et avions en mission ;
  - suivi de terrain ;
  - logique programmable ;
  - fusion de capteurs avancée d'ArduPilot (EKF3) ;
  - (le planificateur, lui, existe : onglet **Plan de vol** de TrueGlide Configurator, ou Mission Planner par
    MAVLink avec le modèle TRUENAV).
- **Premiers essais** : en terrain dégagé, à basse vitesse, prêt à reprendre la main.

## Compatibilité

TrueGlide garde tout Betaflight 2026.6.2 : **629 cartes** (STM32 F405, F411, F722, F745, G474, H7, AT32F435, APM32,
RP2350…), tous les protocoles moteur (PWM, OneShot, MultiShot, DShot150/300/600, ProShot, DShot bidirectionnel) et le
passthrough 4-way pour régler les ESC avec ESC Configurator ou BLHeliSuite. Betaflight Configurator 2025.12 ou plus
récent (API MSP 1.48).

Ce que chaque ajout TrueGlide demande à l'ESC :

| Firmware des ESC | Protocole conseillé | Filtre RPM, ralenti dynamique | Limite de température | Moteur calé / désynchronisé |
|---|---|---|---|---|
| Bluejay (BLHeli_S flashé) | DShot300 ou 600 | oui | oui (télémétrie étendue, `dshot_edt`) | oui (10 ms) |
| AM32 | DShot300 ou 600 | oui | oui (étendue, ou fil série) | oui (10 ms) |
| BLHeli_32 | DShot300 ou 600 | oui | avec le fil de télémétrie série | oui (10 ms) |
| KISS | DShot | non | avec le fil série | avec le fil série (0,3 s) |
| BLHeli_S d'origine | DShot | non (flasher Bluejay) | non | non |
| BLHeli ancien, SimonK | OneShot125 | non | non | non |
| ESC PWM analogique | PWM | non | non | non |

La limite de courant marche avec n'importe quel ESC si la FC a un capteur de courant, ou avec le courant de la
télémétrie série (`current_meter = ESC`).

**DShot300 ou DShot600** : sur les processeurs **F405, F411, G474 et APM32F4**, quand le DShot bidirectionnel est
actif, **Betaflight remplace lui-même DShot600 par DShot300** et limite la boucle PID à 4 kHz : ces processeurs ne
sont pas assez rapides pour envoyer la commande et lire la réponse en DShot600 à 8 kHz. Ce n'est pas une panne.
Sur F7, H7 et AT32F435, DShot600 et 8 kHz conviennent. TrueGlide Studio applique cette règle selon la carte choisie.

## Nouvelles technologies : radio, vidéo, moteurs

TrueGlide garde tout ce que Betaflight 2026.6.2 sait piloter (réglages vérifiés dans le firmware) :

| Domaine | Pris en charge | Réglage |
|---|---|---|
| Radio série | ExpressLRS et Crossfire (CRSF), Ghost (GHST), FrSky SBUS et FPort, Spektrum SRXL2 et DSM, FlySky IBUS, Jeti EX Bus, Graupner SUMD, MAVLink | `serialrx_provider` |
| Radio intégrée à la carte | ExpressLRS SPI (cartes AIO), FrSky D/X, FlySky, Spektrum | `rx_spi_protocol` |
| Vidéo analogique | OSD MAX7456 ; commande du VTX par SmartAudio, Tramp ou MSP | `osd_displayport_device = MAX7456`, `vtx_*` |
| Vidéo numérique | DJI O3 / O4, Walksnail Avatar, HDZero : OSD par MSP DisplayPort | `osd_displayport_device = MSP`, `vcd_video_system = HD` |

Les nouveaux récepteurs et lunettes réutilisent presque toujours ces protocoles standard : une nouvelle génération
ExpressLRS reste du CRSF, un nouveau système HD affiche son OSD en MSP DisplayPort. Ils marchent donc sans changer le
firmware.

**Récupérer les nouveautés de Betaflight** : les ajouts TrueGlide sont petits et séparés (fichiers à eux, quelques
lignes dans 21 fichiers Betaflight). Essai du 11/10/2026 : fusion de la version de développement de Betaflight
(185 changements après 2026.6.2, dont ExpressLRS sur AT32, OSD DisplayPort réglable par carte, télémétrie CRSF et
MSP revues) dans TrueGlide. 6 conflits, tous des ajouts côte à côte (liste des modes, des modes debug), résolus en
gardant les deux. Ensuite, toutes les suites de tests de la version fusionnée passent (93, la version de
développement en ajoute), simulateur et SPEEDYBEEF405MINI compilés. TrueGlide suivra
donc chaque nouvelle version de Betaflight ; la fusion sera faite à sa sortie officielle, pas sur une version de
développement.

**Moteurs plats (« pancake », flux axial, stator sur circuit imprimé)** : pour le firmware, ce sont des moteurs sans
balais triphasés comme les autres, pilotés par les mêmes ESC. Ce qui change, c'est surtout le nombre d'aimants, souvent
plus élevé : la vitesse électrique que l'ESC doit suivre augmente d'autant. Studio la calcule (KV × tension × pôles / 2)
au-delà de 14 pôles. Les « moteurs planaires » industriels (plateau à navettes en lévitation magnétique) déplacent
une pièce sur un plan, sans hélice : ils ne servent pas à la propulsion d'un drone.

**Moteurs** : le nombre de pôles (aimants) est la donnée de base du filtre RPM et du ralenti dynamique. Studio le
demande, et l'analyse des journaux le mesure dans les vibrations du gyro et signale un `motor_poles` faux.

**Remote ID (identification à distance)** : un module Remote ID (Dronetag, BeeID…) se branche sur un port série.
Il diffuse l'identification lui-même ; il peut aussi servir de GPS à la carte (message `MSP2_SENSOR_GPS`, présent
dans Betaflight depuis 4.5, donc dans TrueGlide). Betaflight n'a aucun blocage de l'armement lié au Remote ID.
L'avis EASA n° 06/2026 (18/09/2026) propose d'abaisser le seuil d'enregistrement et de Remote ID de 250 g à
100 g, et (selon la presse spécialisée) un blocage du décollage sans numéro d'exploitant valide pour les drones
neufs. Ce n'est encore qu'une proposition, pas une loi. Si le texte est adopté, un contrôle avant armement
pourra être ajouté à TrueGlide. Il sera désactivé par défaut et suivra la norme publiée.

## Venir de Betaflight 4.4, 4.5 ou 2025.12

- **Configuration** : depuis 4.4, 56 réglages ont disparu ou changé de nom, et **le sens du D a été inversé en
  2025.12** (`d_roll` était le D maximum et `d_min_roll` le D de base ; maintenant `d_roll` est le D de base et
  `d_max_roll` le maximum). Ne pas recoller un ancien `diff all` tel quel : TrueGlide Studio (onglet « Analyser ma
  configuration ») le convertit automatiquement.
- **Journaux de vol** : `analyse_blackbox.py` lit les journaux de 4.4 à 2026.6. Betaflight 4.4 et 4.5 n'enregistrent la
  vitesse des moteurs qu'avec `set debug_mode = DSHOT_RPM_TELEMETRY` ; avec ce réglage, désynchronisations et
  télémétrie figée y sont aussi analysées.
- **Les nouveautés TrueGlide** (protections, mode SPEEDER) demandent de flasher TrueGlide : elles n'existent pas dans
  un firmware Betaflight plus ancien.

## Obtenir le fichier .hex

Sur GitHub, onglet **Actions** > **TrueGlide** : chaque envoi produit l'archive **trueglide-hex** (cartes
courantes). Pour une autre carte : **Run workflow**, indiquer son nom (par exemple `SPEEDYBEEF405V4`).

Ou sur un PC Linux : `make arm_sdk_install`, `make configs`, puis `make CONFIG=NOM_DE_LA_CARTE` ; le fichier est
`obj/trueglide_2026.6.2_<MCU>_<CARTE>.hex`.

## Mise à jour en ligne (depuis TrueGlide Configurator)

Le Configurator peut télécharger lui-même le firmware de la carte : tableau de bord, carte **Firmware**, **Chercher la
mise à jour**, puis **Mettre à jour** ; ou onglet **Flasher le Firmware**, cadre **Mise à jour en ligne**. Le fichier
est vérifié (somme SHA-256) avant d'être chargé, la configuration est sauvegardée automatiquement avant le flash et
peut être restaurée après. Rien n'est demandé au réseau tant que le pilote ne clique pas.

Publier une version (Johann, au moment de « publie ») :

1. Commiter, puis compiler les cartes voulues (`make CONFIG=… [MODELE=TRUENAV|TRUENAV_LIGHT]`). Attention :
   `make clean CONFIG=X` efface aussi les `.hex` des autres modèles de la carte X.
2. `python3 trueglide/outils/publier_firmware.py --sortie <dossier du site>` : écrit `firmware/index.json` et les
   `.hex.gz`. Seuls les `.hex` compilés depuis ce commit sont publiés ; les autres sont listés, à recompiler.
3. Pousser le dossier du site sur GitHub Pages (dépôt TrueGlide-Configurator, branche `gh-pages` : `https://jschmiedd.github.io/TrueGlide-Configurator/firmware/`). Environ 600 Ko par carte et
   par modèle : toutes les cartes en STANDARD et TRUENAV tiennent sous la limite de 1 Go de GitHub Pages ; publier
   sur une branche sans historique (`gh-pages` remplacée à chaque version) pour que le dépôt ne grossisse pas.

## Flasher (première installation)

1. Dans le Configurator, onglet CLI : `diff all`, **enregistrer le texte** (sauvegarde de l'ancienne configuration).
2. Onglet **Flasher** : choisir la carte, **Charger le firmware [local]**, sélectionner le `.hex` TrueGlide, cocher
   **Effacement complet**, **Flasher**.
3. Refaire la configuration de base (ports, récepteur, modes, OSD). Depuis une version 2025.12, ne pas recoller tout
   l'ancien diff : Studio (onglet « Analyser ») dit ce qui a changé.

## Premier vol en sécurité (« ne rien faire brûler »)

1. **Sans hélices**, batterie avec un *smoke stopper* si possible : onglet Moteurs, vérifier ordre et sens de rotation.
2. Activer la protection : par exemple `set power_guard_esc_temp = 100` (ESC avec télémétrie de température) et
   `set power_guard_current = …` (80 % du calibre total des ESC, capteur de courant nécessaire), puis `save`.
3. Alarmes OSD cohérentes : `osd_esc_temp_alarm`, et le mode debug `POWER_GUARD` pour la boîte noire.
4. Hélices : stationnaire de 30 s, atterrir, **toucher les moteurs**. Tièdes : on peut monter le curseur maître.
   Chauds : baisser le maître ou renforcer le filtrage avant d'aller plus loin.

Aucun logiciel ne peut garantir qu'un drone « vole du premier coup » : un moteur mal monté, une hélice à l'envers ou
un ESC mal réglé restent possibles. Ces étapes sont là pour les détecter sans casse.

## Protection anti-surchauffe / surintensité

| Réglage | Rôle | Défaut |
|---|---|---|
| `power_guard_esc_temp` | °C de l'ESC le plus chaud au-delà desquels les gaz sont limités (0 = arrêt) | 0 |
| `power_guard_current` | ampères batterie au-delà desquels les gaz sont limités (0 = arrêt) | 0 |
| `power_guard_min_throttle` | les gaz disponibles ne descendent jamais sous ce pourcentage | 50 |

Seuls les gaz (collectif) sont limités, jamais les corrections PID : le drone reste stable et pilotable. La limite
démarre aux gaz du moment, descend progressivement, et se relâche (25 %/s) quand on repasse sous la limite.

## Mode SPEEDER

Pour les speeders qui décollent fuselage vertical (90°) et volent vite fuselage presque horizontal.

| Réglage | Rôle | Défaut |
|---|---|---|
| `speeder_cruise_angle` | inclinaison vers l'avant en fin de transition (10 à 80°) | 60 |
| `speeder_transition_rate` | vitesse de la transition (°/s) | 30 |
| `speeder_fpv_mix` | roulis / lacet tournés avec la transition (comme `fpv_mix_degrees`, mais progressif) | OFF |

Mise en place : onglet Modes, assigner **SPEEDER** à un interrupteur ; voler en mode **ANGLE**. Interrupteur actif :
le nez descend progressivement jusqu'à l'angle de croisière, le pilote garde la main autour de cet angle.
Interrupteur coupé, failsafe : retour progressif au stationnaire. GPS RESCUE, ALTHOLD et POS HOLD annulent la
transition.

**Prudence** : la logique est vérifiée (tests unitaires, simulateur), pas encore le comportement en vol réel.
Commencer avec `speeder_cruise_angle = 20`, en altitude, puis monter par pas de 10°.

## Température des ESC sur la radio (`crsf_tlm_esc_temp`)

Optionnel, **désactivé par défaut**. Activé, la carte envoie toutes les 2 s une trame de température CRSF (type 0x0D,
une valeur par moteur en dixièmes de degré, source 0) : EdgeTX 2.10 ou plus récent l'affiche comme capteurs « Temp » et
permet une alerte vocale. Rien n'est envoyé si un ESC ne donne pas sa température (DShot étendu ou télémétrie série),
ni si les données série sont trop anciennes. Présent seulement si la carte a la télémétrie CRSF et une source de
température ESC. Vérifié en test unitaire ; à essayer en vol avec la radio.

## Quad X pusher (moteurs à l'envers)

Un quad X « pusher » a ses 4 moteurs montés à l'envers sous les bras, avec des hélices pusher. Rien de spécial dans le
firmware : **mixeur Quad X normal** (`mixer QUADX`), mêmes réglages qu'un quad X. Le piège est le sens de rotation :

- le schéma de l'onglet Moteurs et le réglage « Sens de rotation inversé » (`yaw_motors_reversed`) se lisent **vu de
  dessus** du drone ; en regardant un moteur par en dessous, on voit le sens inverse ;
- hélices retirées, vérifier l'ordre et le sens de chaque moteur **vu de dessus** ;
- l'hélice travaille comme sur un quad classique : **face marquée vers le haut** (contre la cloche du moteur inversé)
  et de la **même main** qu'à cette position sur le schéma. Une hélice de l'autre main souffle vers le haut ; une hélice
  de la bonne main face marquée vers le bas souffle vers le bas mais travaille à l'envers (moins de poussée, chauffe).

L'Assistant de réglage (et Studio) a le choix de châssis « Quad X pusher (moteurs à l'envers) » : mêmes calculs qu'un
quad X, avec ces conseils.

## Nacelle caméra Caddx GM3

Le pilote de la nacelle **Caddx GM3** (port série, 115 200 bauds) est activé dans les firmwares TrueGlide, sauf sur
les cartes F411 et dans le modèle TRUENAV_LIGHT (place en mémoire : environ 2,2 Ko). Il ne fait rien tant qu'aucun port
série n'a la fonction « Gimbal » (TrueGlide Configurator : onglet Ports, « Nacelle Caddx GM3 » ; CLI :
`serial <port> 262144 115200 57600 0 115200`). La nacelle suit les manches et le suivi de tête des lunettes ; réglages
`gimbal_*` (gains, décalages, limites, `gimbal_stabilisation` 0 à 2, `gimbal_sensitivity`).

Correction TrueGlide dans le pilote d'origine : quand un premier octet d'en-tête n'était pas suivi du second, le pilote
renvoyait `1` au lieu de cet octet (`&&` à la place de `&`).

Vérifié sur le simulateur (`trueglide/sitl_bench/test_gimbal_gm3.py`) : trames à la nacelle avec en-tête et CRC
corrects, renvoi correct d'un en-tête incomplet. **Pas encore essayé avec une vraie GM3.** Dans le simulateur seulement,
un port TCP sans client au bout finit par bloquer la boucle (le tampon ne se vide pas) : brancher un client sur le port.

## Hexa et X8 coaxial

Les mixeurs HEX6X et OCTOX8 de base fonctionnent tels quels. TrueGlide suit tous les moteurs : santé moteurs et
relance sur 8 moteurs, mode debug `MOTOR_HEALTH` (relances des moteurs 1 à 8), alertes OSD `M1` à `M8 RESTART`,
outils de journaux jusqu'à 8 moteurs. L'Assistant de réglage (et Studio) a un choix de châssis : Quad X, Hexa X,
X8 coaxial, Quad X pusher (moteurs à l'envers) ; pour le X8, la poussée est estimée avec 20 % de perte par moteur (moteurs du bas dans
le flux de ceux du haut), une estimation à vérifier au stationnaire.

## Santé moteurs (DShot bidirectionnel)

| Réglage | Rôle | Défaut |
|---|---|---|
| `motor_desync_recovery` | relance d'un moteur désynchronisé ou calé | OFF |
| `motor_desync_threshold` | seuil : % de la vitesse attendue en dessous duquel le moteur est jugé décroché (10 à 80) | 40 |
| `dshot_telemetry_fallback` | vitesse d'un moteur dont la télémétrie est perdue : suit les autres au lieu de rester figée | OFF |

Détection : moteur commandé à au moins 30 %, plus lent que `motor_desync_threshold` % de la vitesse attendue (autres
moteurs, au prorata des commandes) **et** que la moitié du plus lent des autres, pendant 10 ms. Il est alors coupé au
ralenti 50 ms, puis remis en 100 ms : l'ESC relance sa commutation. Un moteur réellement bloqué est relancé environ
6 fois par seconde au lieu de chauffer à pleine puissance. Mode debug `MOTOR_HEALTH` : nombre de relances par moteur
(moteurs 1 à 8).

Vitesse minimale : la comparaison n'est faite que si la vitesse attendue dépasse 1 500 tr/min, assez bas pour les
grandes hélices (10 à 15 pouces, 2 500 à 4 500 tr/min en stationnaire). Passage de 5 000 à 1 500 tr/min
vérifié sur tous les journaux disponibles (116 vols de 5 pouces) : relances identiques avant et après (34, sur
les mêmes vols). Les grandes hélices ne sont vérifiées qu'en tests unitaires : pas encore de journal de vol réel. Avec la télémétrie série (BLHeli_32, KISS,
AM32), la vitesse est convertie en tr/min comme en DShot (`motor_poles` doit être juste).

`dshot_telemetry_fallback` ne sert qu'au filtre RPM et au ralenti dynamique : l'OSD et la boîte noire continuent
d'afficher la valeur reçue de l'ESC, figée si la télémétrie est perdue.

Mise au point sur de vrais vols (journaux d'un quad de test, non publiés) : la logique compilée du firmware a été
rejouée sur 26 vols (`trueglide/outils/rejouer_desync.py`) ; elle intervient sur chaque calage, jamais sur les vols
sains. Elle ne répare pas une voie d'ESC défaillante : elle limite les dégâts.

Limites du rejeu : il utilise la boîte noire (1 à 2 kHz, pas la boucle PID complète), juge la télémétrie « fraîche »
quand la valeur change, et ne simule pas l'effet de la relance sur la suite du vol (le moteur continue comme dans le
journal). Il montre où la logique intervient, pas ce que le drone aurait fait ensuite.

### Alertes OSD

Deux alertes TrueGlide s'ajoutent à celles de Betaflight (onglet OSD du Configurator, liste des alertes, élément
« Avertissements » affiché) :

| Alerte OSD | Affiché | Quand |
|---|---|---|
| Gaz limités | `ESC HOT 65%` ou `AMP LIM 80%` | la protection limite les gaz (ESC trop chaud ou courant trop fort) ; le % est la limite réelle des gaz |
| Moteur relancé | `M2 RESTART` (clignote) | pendant 3 s après la relance d'un moteur calé ou désynchronisé |

Elles n'apparaissent que si la protection correspondante est activée. Sur une carte qui garde une ancienne
configuration, cocher les deux alertes dans l'onglet OSD (elles sont cochées d'office après une remise à zéro).

DShot300 ou DShot600 : avec le DShot bidirectionnel, DShot300 suffit pour une boucle PID à 4 kHz et rend la
télémétrie moins sensible aux parasites ; DShot600 est utile pour une boucle à 8 kHz.

## Analyser ses journaux de vol

```
pip install orangebox numpy
python3 trueglide/outils/analyse_blackbox.py mon_vol.bbl -o rapport.md
```

Le rapport **mesure aussi le nombre de pôles (aimants) des moteurs** dans les vibrations du gyro et le compare à
`motor_poles` : c'est la donnée de base du filtre RPM et du ralenti dynamique (fiche « 12N14P » = 14 aimants). Il
ne conclut que si la mesure est nette (gyro brut et vitesse des moteurs enregistrés, quelques secondes à gaz
stables). Mesure de 8 à 48 pôles ; au-delà de 28 environ, l'écart avec le voisin (±2) devient petit et le rapport
l'écrit « environ N (±2) ». Vérifié sur de vrais vols (14 pôles mesurés) et sur des moteurs simulés de 8 à 48 pôles.

Le rapport liste, vol par vol : télémétrie DShot figée par moteur, désynchronisations et calages (logique du
firmware), saturation, bruit gyro, oscillations lentes, avec un conseil sur le protocole DShot et une synthèse par
moteur. Les outils lisent tous les moteurs du journal (hexacoptère, octocoptère : jusqu'à 8).

Pour régler les PID à partir de mesures, Betaflight 2026.6 a aussi un onglet **Réglage automatique** (Autotune, excitation « chirp ») :
il reste disponible dans TrueGlide Configurator, à côté de l'Assistant de réglage.

## Vérifications faites

- Tests unitaires Betaflight + TrueGlide : 70 suites, en mode strict (`make EXTRA_FLAGS=-Werror test-all`).
- Construction pour 42 cartes courantes (F405, F411, F722, F745, H743, AT32F435) et pour le simulateur (SITL).
- Simulateur : réglages acceptés et sauvegardés, mode SPEEDER annoncé au Configurator, transition suivie
  (`trueglide/sitl_bench`).
- Studio : 22 tests (dont les 7 types d'ESC sur les 629 cartes) ; 40 drones et une mission collés dans le firmware, toutes les commandes acceptées et PID
  identiques (`trueglide/studio/tools/valider_sitl.py`).

## Licence

TrueGlide est un dérivé de Betaflight 2026.6.2, modifié par TalkTrueFPV depuis octobre 2026, sous **GPL v3**
(fichier `LICENSE`), fourni **sans aucune garantie**. Betaflight et les autres marques citées appartiennent à leurs
titulaires ; TrueGlide n'est ni affilié au projet Betaflight ni approuvé par lui. Pour un usage personnel, le dépôt
peut rester privé. Si le firmware est distribué (fichier .hex donné ou vendu, carte vendue avec), son code source
complet doit être fourni sous la même licence. Ne jamais y mélanger de code privé.

Le logo Talk True FPV (`trueglide/studio/logo_talktruefpv_*.png`) est la marque de Johann (TalkTrueFPV). Il n'est
pas sous GPL : il peut être affiché avec TrueGlide, pas réutilisé pour un autre produit sans son accord.

Sécurité : vérifier chaque réglage, essayer d'abord hélices retirées, puis en vol dans un lieu dégagé. Le pilote reste
seul responsable de son drone et du respect de la réglementation de son pays (en Suisse : OFAC ; en France : DGAC).

Contact : TalkTrueFPV, talktruefpv@gmail.com.
