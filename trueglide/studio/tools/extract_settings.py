#!/usr/bin/env python3
"""Génère js/settings_db.js : nom, bornes et valeurs permises de chaque réglage CLI du firmware.

Source : src/main/cli/settings.c (bornes, tables de choix) et, si fourni, la sortie de la commande CLI
`get` d'un SITL (valeurs par défaut). Usage, depuis la racine du dépôt :
    python3 trueglide/studio/tools/extract_settings.py [sortie_get_sitl.txt]
"""
import json, re, sys
from pathlib import Path

RACINE = Path(__file__).resolve().parents[3]
SRC = RACINE / 'src' / 'main'


def defines(fichiers):
    d = {}
    for f in fichiers:
        for k, v in re.findall(r'#define (\w+)\s+\(?(-?\d+)\)?\s*(?://.*)?$', f.read_text(errors='replace'), re.M):
            d.setdefault(k, int(v))
    return d


def tables(settings_c):
    """Tables de choix : lookupTableXxx[] = { "A", "B" } et nom TABLE_XXX associé."""
    brut = {}
    for nom, corps in re.findall(r'(?:static )?const char \* const (lookupTable\w+)\[\]\s*=\s*\{(.*?)\};', settings_c, re.S):
        brut[nom] = re.findall(r'"([^"]*)"', corps)
    lien = {}
    # TABLE_MOTOR_PWM_PROTOCOL <-> lookupTableMotorPwmProtocol (même nom sans « _ », casse ignorée)
    enum = re.search(r'typedef enum \{(.*?)LOOKUP_TABLE_COUNT', (SRC / 'cli' / 'settings.h').read_text(), re.S)
    norm = {t[len('lookupTable'):].lower(): v for t, v in brut.items()}
    for nom in re.findall(r'\b(TABLE_\w+)\b', enum.group(1)):
        cle = nom[len('TABLE_'):].replace('_', '').lower()
        if cle in norm:
            lien[nom] = norm[cle]
    return lien


def main():
    settings_c = (SRC / 'cli' / 'settings.c').read_text()
    noms = dict(re.findall(r'#define (PARAM_NAME_\w+)\s+"([^"]+)"', (SRC / 'fc' / 'parameter_names.h').read_text()))
    d = defines([p for p in SRC.rglob('*.h')] + [SRC / 'cli' / 'settings.c'])
    tabs = tables(settings_c)

    def val(t):
        t = re.sub(r'\b[A-Z_][A-Z0-9_]*\b', lambda m: str(d.get(m.group(0), m.group(0))), t.strip())
        try:
            return int(eval(t, {}, {}))
        except Exception:
            return None

    db = {}
    for m in re.finditer(r'\{\s*(PARAM_NAME_\w+|"[a-z0-9_]+")\s*,\s*([^,]+?)\s*,\s*\.config\.(minmaxUnsigned|minmax|lookup|u32Max|array|bitpos)\s*=\s*(\{[^}]*\}|[^,]+)', settings_c):
        n = noms.get(m.group(1), m.group(1)).strip('"')
        kind, corps = m.group(3), m.group(4)
        e = db.setdefault(n, {})
        if kind in ('minmax', 'minmaxUnsigned'):
            a = corps.strip('{} ').split(',')
            if len(a) >= 2:
                lo, hi = val(a[0]), val(a[1])
                if lo is not None and hi is not None:
                    e['min'], e['max'] = lo, hi
        elif kind == 'lookup':
            t = corps.strip('{} ').split(',')[0].strip()
            if t in tabs:
                e['values'] = tabs[t]
        elif kind == 'array':
            e['array'] = True
    if len(sys.argv) > 1:   # valeurs par défaut lues sur un SITL
        cur = None
        for l in Path(sys.argv[1]).read_text(errors='replace').splitlines():
            mm = re.match(r'^([a-z0-9_]+) = (.*)$', l)
            if mm:
                cur = mm.group(1) if mm.group(1) in db else None
                if cur:
                    db[cur]['default'] = mm.group(2).strip()
            elif cur and l.startswith('Allowed values:'):
                db[cur]['values'] = [v.strip() for v in l.split(':', 1)[1].split(',')]
    sortie = RACINE / 'trueglide' / 'studio' / 'js' / 'settings_db.js'
    sortie.write_text('// Généré par tools/extract_settings.py depuis src/main/cli/settings.c : ne pas modifier à la main.\n'
                      '// TrueGlide - Copyright (C) 2026 TalkTrueFPV. Derived from Betaflight.\n// Free software under the GPL-3.0 license, WITHOUT ANY WARRANTY; see the LICENSE file.\n'
                      '(function (root) {\n  var DB = ' + json.dumps(db, ensure_ascii=False, sort_keys=True) + ';\n'
                      '  if (typeof module !== "undefined") module.exports = DB; else root.TF_SETTINGS = DB;\n'
                      '})(this);\n')
    print(len(db), 'réglages ->', sortie)


if __name__ == '__main__':
    main()
