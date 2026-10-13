![TrueGlide](trueglide/images/logo_trueglide_clair.png#gh-light-mode-only)
![TrueGlide](trueglide/images/logo_trueglide_sombre.png#gh-dark-mode-only)

# TrueGlide : firmware de contrôleur de vol

**Réglages Optimisés pour chaque Build.** Firmware de contrôleur de vol pour drones FPV, du Tiny Whoop au 15 pouces,
compatible Betaflight. Il se configure avec **[TrueGlide Configurator](https://github.com/Jschmiedd/TrueGlide-Configurator)**.

## TRUEGLIDE et ses deux dérivés

| Firmware | Pour qui | Fichier |
|---|---|---|
| **TRUEGLIDE** | course, freestyle, cinéma : le firmware de base | `trueglide_<version>_<MCU>_<CARTE>.hex` |
| **TRUENAV** (dérivé combiné) | TRUEGLIDE + navigation GPS complète : missions, maintien de position, retour au départ, MAVLink | `truenav_…` |
| **TRUENAV_LIGHT** (dérivé navigation) | TRUENAV sans les fonctions de course, pour la longue portée | `truenav_light_…` |

Un seul fichier à flasher, au choix ; on peut changer à tout moment.

## Ce que TrueGlide ajoute

- **Protection anti-surchauffe** : limite les gaz si un ESC chauffe trop ou si le courant dépasse la limite, sans couper.
- **Relance moteur** : un moteur calé ou désynchronisé est relancé ; jusqu'à 8 moteurs suivis ; alertes OSD.
- **Mode SPEEDER** : passage progressif du stationnaire au vol rapide, sur un interrupteur.
- **Caméra commandée** : alimentation d'une caméra par un interrupteur de la radio ; nacelle Caddx GM3.
- **Température des ESC sur la radio** (ELRS / CRSF), en option.
- **Navigation GPS** (TRUENAV) : missions, ALTHOLD, POSHOLD, GPS RESCUE, zone de vol.

**Tout est désactivé par défaut** : sans réglage, le drone vole exactement comme avec Betaflight 2026.6.2.

## Installer

Avec TrueGlide Configurator : onglet **Flasher le Firmware**, mise à jour en ligne ou fichier `.hex`. Avant de flasher,
sauvegarder la configuration (onglet CLI, `diff all`). Compiler soi-même : `make CONFIG=<CARTE>`
(`MODELE=TRUENAV` ou `MODELE=TRUENAV_LIGHT` pour les dérivés).

Documentation complète en français : **[trueglide/LISEZMOI.md](trueglide/LISEZMOI.md)**.

## Sécurité

Firmware fourni **sans aucune garantie**. Vérifiez chaque réglage, essayez d'abord hélices retirées, puis en vol dans
un lieu dégagé. Le pilote reste seul responsable de son drone et du respect de la réglementation de son pays
(en Suisse : OFAC ; en France : DGAC).

## Licence et origine

TrueGlide est un logiciel libre sous licence **GPL-3.0** (fichier [LICENSE](LICENSE)), modifié par TalkTrueFPV depuis
octobre 2026 à partir de [Betaflight](https://github.com/betaflight/betaflight) 2026.6.2, dont il garde le code, les
auteurs et les mentions de copyright. Betaflight et les autres marques citées appartiennent à leurs titulaires ;
TrueGlide n'est ni affilié au projet Betaflight ni approuvé par lui. Le logo TrueGlide / Talk True FPV n'est pas sous
GPL : il ne doit pas être réutilisé pour un autre produit.

Contact : TalkTrueFPV, talktruefpv@gmail.com.
