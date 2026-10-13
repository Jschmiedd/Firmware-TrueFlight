#!/usr/bin/env python3
"""Colle dans le firmware (SITL) les commandes produites par TrueGlide Studio et vérifie :
- qu'aucune n'est refusée (« ERROR ») ;
- que les PID calculés par le firmware après « simplified_tuning apply » sont ceux affichés par Studio ;
- que la mission relue par « waypoint » est identique à celle générée.
Le SITL n'a pas de DShot : les réglages DShot / RPM / ralenti dynamique sont signalés « absents du SITL ».
Prérequis : make TARGET=SITL. Usage : python3 trueglide/studio/tools/valider_sitl.py"""
import json, re, subprocess, sys
from pathlib import Path

ICI = Path(__file__).resolve().parent
sys.path.insert(0, str(ICI.parents[1] / 'sitl_bench'))
from msp_tool import Sitl  # noqa: E402

donnees = json.loads(subprocess.check_output(['node', str(ICI / 'cas_validation.js')]))
sitl = Sitl(fresh=True)
echecs = 0
try:
    connus = set(re.findall(r'^([a-z0-9_]+) = ', sitl.cli('get'), re.M))
    for cas in donnees['cas']:
        lignes = [l for l in cas['cli'] if not l.startswith('set ') or l.split()[1] in connus]
        absents = sorted(l.split()[1] for l in cas['cli'] if l.startswith('set ') and l.split()[1] not in connus)
        sortie = sitl.cli(*(lignes + ['get p_roll', 'get i_roll', 'get d_roll', 'get f_roll', 'get d_max_roll',
                                      'get p_pitch', 'get i_pitch', 'get d_pitch', 'get f_pitch', 'get p_yaw', 'get f_yaw']))
        erreurs = [l for l in sortie.splitlines() if 'ERROR' in l]
        lu = {k: int(v) for k, v in re.findall(r'^([pidf]_(?:roll|pitch|yaw)|d_max_roll) = (\d+)', sortie, re.M)}
        attendu = {'p_roll': cas['pids']['roll']['P'], 'i_roll': cas['pids']['roll']['I'], 'd_roll': cas['pids']['roll']['D'],
                   'f_roll': cas['pids']['roll']['F'], 'd_max_roll': cas['pids']['roll']['Dmax'],
                   'p_pitch': cas['pids']['pitch']['P'], 'i_pitch': cas['pids']['pitch']['I'], 'd_pitch': cas['pids']['pitch']['D'],
                   'f_pitch': cas['pids']['pitch']['F'], 'p_yaw': cas['pids']['yaw']['P'], 'f_yaw': cas['pids']['yaw']['F']}
        diff = {k: (attendu[k], lu.get(k)) for k in attendu if lu.get(k) != attendu[k]}
        ok = not erreurs and not diff
        echecs += not ok
        print(('OK    ' if ok else 'ÉCHEC ') + cas['nom'] + f" : {len(lignes)} commandes acceptées, PID firmware = Studio"
              + (f" ; absents du SITL : {', '.join(absents)}" if absents else ''))
        for e in erreurs: print('      ', e)
        for k, (a, b) in diff.items(): print(f'       {k} : Studio {a}, firmware {b}')
    sortie = sitl.cli(*(donnees['nav'] + donnees['mission'] + ['waypoint']))
    erreurs = [l for l in sortie.splitlines() if 'ERROR' in l]
    relu = [l.strip() for l in sortie.splitlines() if l.strip().startswith('waypoint insert')]
    # la commande « waypoint » réaffiche chaque point au même format ; on compare la dernière liste affichée
    attendu = donnees['mission'][1:]
    relu = relu[-len(attendu):]
    ok = not erreurs and relu == attendu
    echecs += not ok
    print(('OK    ' if ok else 'ÉCHEC ') + f'mission : {len(attendu)} points relus à l\'identique, {len(donnees["nav"])} réglages de navigation acceptés')
    if not ok:
        for e in erreurs: print('      ', e)
        for a, b in zip(attendu, relu): print('       généré :', a, '\n       relu   :', b)
finally:
    sitl.close()
sys.exit(1 if echecs else 0)
