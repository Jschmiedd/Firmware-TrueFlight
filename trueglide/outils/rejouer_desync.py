#!/usr/bin/env python3
"""Rejoue de vrais journaux blackbox dans la logique « santé moteurs » du firmware (code C compilé tel quel).

Compile src/main/flight/motor_health.c avec MOTOR_HEALTH_PURE, puis, pour chaque vol armé, appelle
motorHealthDesyncStep() à chaque échantillon : commande (motor[]), vitesse (eRPM[]) et fraîcheur de la télémétrie
(la valeur a changé dans les 4 derniers échantillons). Affiche chaque relance déclenchée.

Usage : python3 trueglide/outils/rejouer_desync.py journal.bbl [autre.bbl ...] [--seuil 40]
Dépendance : orangebox (pip install orangebox), gcc.
"""
import argparse, ctypes, os, subprocess, sys, tempfile
import numpy as np
from orangebox import Parser

RACINE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
N = 8


class Entree(ctypes.Structure):
    _fields_ = [('count', ctypes.c_int), ('command', ctypes.c_float * N), ('rpm', ctypes.c_float * N), ('fresh', ctypes.c_bool * N)]


class Etat(ctypes.Structure):
    _fields_ = [('slowTimeS', ctypes.c_float * N), ('recoverLeftS', ctypes.c_float * N), ('desyncCount', ctypes.c_uint16 * N)]


def bibliotheque():
    sortie = os.path.join(tempfile.gettempdir(), 'motor_health_pur.so')
    src = os.path.join(RACINE, 'src', 'main', 'flight', 'motor_health.c')
    subprocess.check_call(['gcc', '-O2', '-shared', '-fPIC', '-DMOTOR_HEALTH_PURE', '-I', os.path.join(RACINE, 'src', 'main', 'flight'),
                           src, '-o', sortie])
    lib = ctypes.CDLL(sortie)
    lib.motorHealthDesyncStep.argtypes = [ctypes.POINTER(Etat), ctypes.POINTER(Entree), ctypes.c_float, ctypes.c_float, ctypes.c_float, ctypes.POINTER(ctypes.c_float * N)]
    return lib


DEBUG_DSHOT_RPM_TELEMETRY = 45   # même index dans Betaflight 4.4, 4.5, 2025.12 et 2026.6 (src/main/build/debug.h)


def nb_moteurs(noms):
    """Nombre de moteurs du journal (motor[0] à motor[7] : quadri, hexa, octo)."""
    n = 0
    while n < N and f'motor[{n}]' in noms:
        n += 1
    return n


def colonnes_erpm(noms, entetes):
    """Champs de vitesse moteur (eRPM / 100) : eRPM[i] depuis 2025.12, sinon debug[i] si le journal a été
    enregistré avec debug_mode = DSHOT_RPM_TELEMETRY (seul moyen sur Betaflight 4.4 et 4.5). None si la vitesse
    d'un des moteurs manque (jamais de moteur comparé à une vitesse absente)."""
    n = nb_moteurs(noms)
    if n < 3:
        return None
    if all(f'eRPM[{i}]' in noms for i in range(n)):
        return [f'eRPM[{i}]' for i in range(n)]
    if entetes.get('debug_mode') == DEBUG_DSHOT_RPM_TELEMETRY and all(f'debug[{i}]' in noms for i in range(n)):
        return [f'debug[{i}]' for i in range(n)]
    return None


def lire(chemin, idx):
    try:
        p = Parser.load(chemin); p.set_log_index(idx)
    except (IndexError, KeyError, ValueError):
        return None   # en-tête de vol abîmé
    noms = p.field_names
    champs = colonnes_erpm(noms, p.headers)
    if champs is None:
        return None
    n = len(noms)

    def num(v):
        try: return float(v)
        except (TypeError, ValueError): return np.nan
    lignes = []
    try:
        for fr in p.frames():
            if len(fr.data) == n:
                lignes.append([num(v) for v in fr.data])
    except (TypeError, ValueError, IndexError):
        pass   # journal tronqué (batterie débranchée en vol) : on garde ce qui a été lu
    A = np.array(lignes)
    if len(A) < 100:
        return None
    A = A[~np.isnan(A[:, 1])]
    c = {k: i for i, k in enumerate(noms)}
    lo, hi = p.headers.get('motorOutput', [48, 2047])[:2]
    t = (A[:, c['time']] - A[0, c['time']]) * 1e-6
    cmd = np.clip((A[:, [c[f'motor[{i}]'] for i in range(len(champs))]] - lo) / (hi - lo), 0, 1)
    rpm = A[:, [c[k] for k in champs]] * 100 * 2 / float(p.headers.get('motor_poles', 14))
    arme = (np.nan_to_num(A[:, c['flightModeFlags']]).astype(int) & 1) == 1
    return t, cmd, rpm, arme


def rejouer(lib, t, cmd, rpm, arme, seuil, detection=0.010):
    m = cmd.shape[1]
    etat = Etat(); e = Entree(); e.count = m; echelle = (ctypes.c_float * N)()
    derniere = rpm[0].copy(); depuis = np.zeros(m)
    relances = []
    for k in range(1, len(t)):
        dt = max(1e-4, t[k] - t[k - 1])
        for i in range(m):
            depuis[i] = 0 if rpm[k, i] != derniere[i] else depuis[i] + 1
            derniere[i] = rpm[k, i]
            e.command[i] = cmd[k, i]; e.rpm[i] = rpm[k, i]; e.fresh[i] = depuis[i] < 4
        if not arme[k]:
            etat = Etat(); continue
        avant = list(etat.desyncCount)
        lib.motorHealthDesyncStep(ctypes.byref(etat), ctypes.byref(e), seuil, detection, dt, ctypes.byref(echelle))
        for i in range(m):
            if etat.desyncCount[i] > avant[i]:
                relances.append((t[k], i, cmd[k].copy(), rpm[k].copy()))
    return relances


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('journaux', nargs='+'); ap.add_argument('--seuil', type=float, default=40)
    a = ap.parse_args()
    lib = bibliotheque()
    total = 0
    for chemin in a.journaux:
        nom = os.path.basename(chemin)
        for idx in range(1, Parser.load(chemin).reader.log_count + 1):
            d = lire(chemin, idx)
            if d is None:
                continue
            rel = rejouer(lib, *d, a.seuil)
            total += len(rel)
            etat = f'{len(rel)} relance(s)' if rel else 'aucune relance'
            print(f'{nom} vol {idx:2d} ({d[0][-1]:5.1f} s) : {etat}')
            for tk, i, c, r in rel:
                print(f'    t = {tk:6.3f} s  moteur {i + 1}  commandes {np.round(c * 100).astype(int)} %  tr/min {np.round(r).astype(int)}')
    print('Total :', total, 'relance(s)')


if __name__ == '__main__':
    main()
