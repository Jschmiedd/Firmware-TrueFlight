# TrueGlide Studio

Logiciel de réglage pour le firmware TrueGlide (base Betaflight 2026.6.2). Une seule page : ouvrir
`index.html` d'un double-clic (Chrome, Edge ou Firefox), rien à installer. La carte de l'onglet Navigation a besoin
d'Internet ; sans connexion, le tableau des points fonctionne seul.

## Ce qu'il fait

- **Carte et ESC** : choisir la carte parmi les 629 de Betaflight (processeur, gyroscope, sorties moteur, capteur de
  courant) et le firmware des ESC (Bluejay, AM32, BLHeli_32, KISS, BLHeli_S d'origine, BLHeli ancien, PWM). Studio en
  déduit le protocole moteur, la fréquence de boucle et les protections TrueGlide possibles.
- **Réglage du drone** : à partir de la taille d'hélice (1,2 à 15 pouces : du Tiny Whoop au 15"), des moteurs, de la batterie, de la masse et du
  style (freestyle, cinématique, longue portée, course, speeder), il propose un réglage de départ et les commandes CLI
  à coller dans le Configurator. Le réglage passe par les curseurs du réglage simplifié de Betaflight : on peut
  ensuite l'ajuster à la souris dans l'onglet PID.
- **Venir d'une ancienne version** : un `diff all` de Betaflight 4.4, 4.5 ou 2025.12 est converti pour TrueGlide
  (réglages renommés traduits, sens du D d'avant 2025.12 remis dans le bon ordre, réglages supprimés retirés avec
  leur raison, valeurs vérifiées contre les bornes du firmware). Coller le résultat après le flash, à la place de
  l'ancien diff.
- **Analyser ma configuration** : coller un `diff all` ; il signale les problèmes (DShot bidirectionnel, failsafe,
  protection TrueGlide…) et donne seulement les commandes qui changent.
- **Navigation GPS** : mission par points (mode AUTOPILOT de Betaflight 2026.6), retour GPS, barrière virtuelle.
  Il produit les commandes `waypoint` exactes du firmware (altitudes converties au-dessus du niveau de la mer).

## D'où viennent les chiffres

Les PID de départ ne sont pas inventés : ce sont les moyennes des préréglages publiés par des régleurs reconnus dans le
dépôt officiel `betaflight/firmware-presets` (firmware 2025.12) :

| Taille | P | I | D | FF | Préréglages |
|---|---|---|---|---|---|
| 1,2" (Tiny Whoop 65 mm) | 73,5 | 131,0 | 53,0 | 173,5 | UAV Tech Whoop (1S & 2S), AOS 65mm (masse de référence 25 g : estimation) |
| 3,5" | 63,8 | 109,9 | 44,6 | 173,1 | SupaflyFPV 3/4", UAV Tech Micro, AOS 3.5, AOS 4 |
| 5" | 73,1 | 122,9 | 47,5 | 218,3 | UAV Tech 5" 650-750 g, AOS 5 |
| 7" | 54,0 | 85,0 | 49,6 | 169,9 | AOS 7, AOS UL7, UAV Tech 6-7", SupaflyFPV 7" |
| 10" | 35,5 | 63,5 | 35,4 | 174,0 | AOS UL10, UAV Tech 10" |

- Entre deux tailles : interpolation. **Au-delà de 10" (jusqu'à 15")** : prolongement de la tendance 7" → 10", 15 %
  plus bas pour la prudence, et signalé « extrapolé » : il n'existe pas de préréglage public de référence pour ces
  tailles. Monter ensuite le curseur maître par pas de 5.
- Correction selon la puissance (± 20 % au plus), entre 1,2" et 10" seulement : la poussée est estimée par la même
  formule pour ton drone et pour la référence de même taille, seule la comparaison compte.
- Tiny Whoop (sous 2") : `pidsum_limit` 1000, compensation de la chute de tension, ralenti dynamique doux
  (`dyn_idle_p_gain` 40, AOS 65mm), rappel des moteurs à 12 aimants, filtre RPM présenté comme indispensable.
- Filtres : options « qualité de construction » des préréglages UAV Tech. Ralenti dynamique : préréglages de la même
  taille. Filtre RPM des grandes hélices : sous la fréquence du moteur au ralenti.

## Vérifications

- `node --test trueglide/studio/test/studio.test.js` : 24 tests (bornes de tous les réglages pour 2 à 15", 5 styles, 3 châssis ;
  format des commandes de mission ; analyse d'un diff).
- `python3 trueglide/studio/tools/valider_sitl.py` (après `make TARGET=SITL`) : colle les commandes générées pour 40
  drones et une mission dans le firmware compilé pour PC. Résultat du 11 octobre 2026 : toutes acceptées, PID calculés
  par le firmware identiques au chiffre près à ceux affichés par Studio, mission relue à l'identique. (Le SITL n'a pas
  de DShot : `dshot_bidir`, `dyn_idle_min_rpm` et `rpm_filter_min_hz` y sont vérifiés seulement contre les bornes du
  code source.)
- `tools/extract_cartes.py` régénère `js/cartes.js` (les 629 cartes) après `make configs`.
- `tools/extract_settings.py` régénère `js/settings_db.js` (les 795 réglages du firmware, bornes et choix) après une
  mise à jour du firmware.

## Limites

Un réglage de départ n'est pas un réglage fini : chaque drone doit être essayé prudemment (stationnaire court,
température des moteurs), puis ajusté. Les drones de plus de 10" et le mode speeder demandent encore plus de prudence.
