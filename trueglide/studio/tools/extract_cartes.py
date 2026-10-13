#!/usr/bin/env python3
"""Génère js/cartes.js : pour chaque carte de src/config/configs (après « make configs ») : fabricant, processeur,
gyroscopes possibles, nombre de sorties moteur, DShot bidirectionnel activé par défaut, capteur de courant.
Usage, depuis la racine du dépôt : python3 trueglide/studio/tools/extract_cartes.py"""
import json, re
from pathlib import Path

RACINE = Path(__file__).resolve().parents[3]
cartes = {}
for cfg in sorted((RACINE / 'src' / 'config' / 'configs').glob('*/*/config.h')):
    t = cfg.read_text(errors='replace')
    d = dict(re.findall(r'^#define[ \t]+(\w+)[ \t]*(.*?)[ \t]*$', t, re.M))
    nom = d.get('BOARD_NAME', cfg.parent.name)
    gyros = sorted({re.sub(r'^USE_(ACCGYRO|GYRO_SPI|GYRO)_', '', k) for k in d if re.match(r'USE_(ACCGYRO|GYRO_SPI)_', k)})
    cartes[nom] = {
        'f': d.get('MANUFACTURER_ID', cfg.parent.parent.name),
        'mcu': d.get('FC_TARGET_MCU', '?'),
        'g': gyros,
        'm': len([k for k in d if re.match(r'MOTOR\d+_PIN$', k)]),
        'bidir': 'DEFAULT_DSHOT_TELEMETRY' in d and 'ON' in d['DEFAULT_DSHOT_TELEMETRY'],
        'courant': d.get('ADC_CURR_PIN', d.get('ADC_CURRENT_PIN', 'NONE')).split()[0] != 'NONE',
    }
sortie = RACINE / 'trueglide' / 'studio' / 'js' / 'cartes.js'
sortie.write_text('// Généré par tools/extract_cartes.py depuis src/config/configs : ne pas modifier à la main.\n'
                  '// TrueGlide - Copyright (C) 2026 TalkTrueFPV. Derived from Betaflight.\n// Free software under the GPL-3.0 license, WITHOUT ANY WARRANTY; see the LICENSE file.\n'
                  '(function (root) {\n  var CARTES = ' + json.dumps(cartes, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + ';\n'
                  '  if (typeof module !== "undefined") module.exports = CARTES; else root.TF_CARTES = CARTES;\n'
                  '})(this);\n')
print(len(cartes), 'cartes ->', sortie)
