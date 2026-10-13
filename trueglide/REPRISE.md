# Reprise du travail TrueGlide (à lire en début de conversation)

Une conversation par phase de test. Lire ce fichier, puis seulement les fichiers utiles à la phase.

## Produits et dépôts

- Firmware : `Jschmiedd/Firmware-TrueGlide` (public), base Betaflight 2026.6.2.
  Trois modèles : **TRUEGLIDE** (base), **TRUENAV** (combiné), **TRUENAV_LIGHT** (navigation).
- Logiciel : `Jschmiedd/TrueGlide-Configurator` (public), base Betaflight App 2026.6.2.
- En ligne : https://jschmiedd.github.io/TrueGlide-Configurator/ (vitrine), `/app/` (logiciel),
  `/firmware/` (manifeste de la mise à jour en ligne). Branche `gh-pages` du dépôt du logiciel.
- Produit privé réécrit : `TrueGlide-XPro`, traité dans ses propres conversations (ne pas mélanger).

## Règles

- Réponses en français. Noms des produits en majuscules et en gras.
- Rien ne change par défaut ; jamais de chiffre faux affiché ; tester en vrai avant d'annoncer.
- Commits : `git -c user.name=TrueGlide -c user.email=jschmiedd@users.noreply.github.com commit -m "... [skip ci]"`,
  sans identifiant de modèle d'IA ni ligne Co-Authored-By. PR seulement sur demande de Johann.
- « Betaflight » reste volontairement dans les en-têtes blackbox et les descripteurs USB (compatibilité des outils).

## Firmware

- Chaîne ARM : `make arm_sdk_install` (ou xpack arm-none-eabi-gcc 13.3.1 dans le PATH).
- Construire : `make -j4 EXTRA_FLAGS=-Werror MODELE=TRUEGLIDE|TRUENAV|TRUENAV_LIGHT CONFIG=<CARTE>`
  → `obj/<modele>_<version>_<MCU>_<CARTE>.hex`. Copier chaque .hex tout de suite : `make clean` efface les autres modèles.
- Révision dans le firmware seulement si l'arbre git est propre (sinon « norevision »).
- Tests : `make EXTRA_FLAGS=-Werror test-all` (70 suites) ; Studio : `node --test trueglide/studio/test/studio.test.js`.
- SITL : `make MODELE=TRUEGLIDE CONFIG=SITL`, lancer `obj/main/trueglide_SITL.elf` (TCP 5761) sans `eeprom.bin`.
- Publication de la mise à jour en ligne : `python3 trueglide/outils/publier_firmware.py --obj <dossier .hex> --sortie <gh-pages>`.

## Logiciel

- `npm ci`, puis `npx eslint src test/js scripts --ignore-pattern "src/dist/**"`, `npx vitest run test/js`, `npm run build` → `src/dist`.
- Ne jamais passer prettier sur `src/components/tabs/TrueGlideTuneTab.vue`.
- Publier : copier `src/dist` dans `app/` de la branche `gh-pages`, commit, push.
- Connexion au SITL depuis le navigateur : pont WebSocket 5800 → TCP 5761, port manuel `ws://localhost:5800`.

## Phases de test

1. **Banc** : SITL + logiciel (connexion, onglets TrueGlide, sauvegarde, mise à jour en ligne).
2. **Première carte** : SpeedyBee F405 Mini, flash **TRUEGLIDE**, contrôles à plat sans hélices (capteurs, moteurs, OSD, alertes).
3. **Premiers vols** **TRUEGLIDE** : journaux blackbox + `diff all` + description du drone → analyse.
4. **TRUENAV** / **TRUENAV_LIGHT** : GPS, maintien de position, retour au départ, missions.
5. **Toutes les cartes** : compilation des 629 cartes par GitHub Actions et publication dans la mise à jour en ligne.

Noter à la fin de chaque phase, ci-dessous, ce qui est validé et ce qui reste.

## Journal des phases

- (vide)
