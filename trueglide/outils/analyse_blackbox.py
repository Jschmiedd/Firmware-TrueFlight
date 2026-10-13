#!/usr/bin/env python3
"""Analyse de journaux blackbox Betaflight / TrueGlide : rapport en français (Markdown).

Pour chaque vol : configuration (firmware, carte, protocole DShot, boucle PID), puis défauts constatés :
- télémétrie DShot figée (le contrôleur ne reçoit plus de trame valide d'un ESC : vitesse bloquée) ;
- moteur désynchronisé ou calé (commandé fort mais beaucoup plus lent que les autres), détecté avec la logique
  du firmware TrueGlide (src/main/flight/motor_health.c, compilée telle quelle) ;
- saturation des moteurs, bruit gyro, oscillation lente ;
- nombre de pôles (aimants) des moteurs mesuré, comparé à `motor_poles` : une erreur fausse le filtre RPM et le
  ralenti dynamique.

Usage : python3 trueglide/outils/analyse_blackbox.py journal.bbl [autres.bbl] [-o rapport.md]
Dépendances : orangebox (pip install orangebox), numpy, gcc (pour la détection de désynchronisation).
"""
import argparse, os, sys
import numpy as np
from orangebox import Parser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rejouer_desync as rj  # noqa: E402

PROTOCOLES = ['PWM', 'ONESHOT125', 'ONESHOT42', 'MULTISHOT', 'BRUSHED', 'DSHOT150', 'DSHOT300', 'DSHOT600', 'PROSHOT1000']


def charger(chemin, idx):
    try:
        p = Parser.load(chemin); p.set_log_index(idx)
    except (IndexError, KeyError, ValueError):
        return None   # en-tête de vol abîmé (coupure pendant l'écriture) : vol ignoré
    noms = p.field_names; n = len(noms)

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
    if len(A) < 100:
        return None
    return p.headers, {k: i for i, k in enumerate(noms)}, A


def telemetrie_figee(e, cmd, actif):
    """% du temps moteur actif où l'eRPM reste identique >= 8 échantillons alors que la commande bouge de > 5 %."""
    res = []
    for i in range(e.shape[1]):
        fig = np.zeros(len(e), bool); k = 0
        while k < len(e):
            j = k
            while j + 1 < len(e) and e[j + 1, i] == e[k, i]:
                j += 1
            if j - k + 1 >= 8 and e[k, i] > 0 and np.ptp(cmd[k:j + 1, i]) > 0.05:
                fig[k:j + 1] = True
            k = j + 1
        res.append(100 * (fig & actif[:, i]).sum() / max(1, actif[:, i].sum()))
    return res


POLES_CANDIDATS = list(range(8, 50, 2))   # jusqu'à 48 : moteurs plats à flux axial, gros moteurs


def mesurer_poles(H, c, A):
    """Nombre de pôles mesuré : le balourd de chaque moteur fait vibrer le cadre à sa vitesse mécanique
    (eRPM / (pôles / 2) / 60 Hz). Sur des fenêtres de vol à vitesse stable, on cherche le nombre de pôles pour
    lequel le gyro brut montre le plus d'énergie à cette fréquence. Indépendant du réglage motor_poles (la
    télémétrie donne une vitesse électrique). Retourne {pôles: score moyen}, nombre de fenêtres ; ou None."""
    champs = rj.colonnes_erpm(list(c), H)
    if not champs or 'gyroUnfilt[0]' not in c:
        return None
    t = (A[:, c['time']] - A[0, c['time']]) * 1e-6
    dt = np.median(np.diff(t))
    e = A[:, [c[k] for k in champs]] * 100                      # eRPM
    g = A[:, [c[f'gyroUnfilt[{k}]'] for k in range(3)]]
    arme = (np.nan_to_num(A[:, c['flightModeFlags']]).astype(int) & 1) == 1
    N, pas = 512, 256                                         # ~0,5 s : résolution suffisante pour 48 pôles
    f = np.fft.rfftfreq(N, dt); fen = np.hanning(N)
    total = dict.fromkeys(POLES_CANDIDATS, 0.0); n = 0
    for s in range(0, len(A) - N, pas):
        sl = slice(s, s + N)
        if not arme[sl].all():
            continue
        em = e[sl].mean(axis=0)
        if em.min() < 2000 or (e[sl].std(axis=0) / em).max() > 0.05:   # vitesse trop basse ou qui varie
            continue
        sp = sum(np.abs(np.fft.rfft((g[sl, k] - g[sl, k].mean()) * fen)) ** 2 for k in range(3))
        ref = np.median(sp[(f > 30) & (f < f[-1] * 0.9)])
        if not ref > 0:
            continue
        for p in POLES_CANDIDATS:
            # fondamentale seulement : les harmoniques confondraient p et 2p
            v = [np.interp(fr, f, sp) / ref for fr in em / (p / 2) / 60 if fr < f[-1] * 0.95]
            if v:
                total[p] += np.log(np.mean(v))
        n += 1
    if n == 0:
        return None
    return {p: total[p] / n for p in POLES_CANDIDATS}, n


def conclure_poles(mesures):
    """Regroupe les mesures de plusieurs vols. Conclut seulement si assez de fenêtres et un net vainqueur.
    Retourne (pôles, exact) : exact = False quand le voisin à ±2 pôles reste proche (moteurs à beaucoup d'aimants)."""
    n = sum(m[1] for m in mesures)
    if n < 20:
        return None
    s = {p: sum(m[0][p] * m[1] for m in mesures) / n for p in POLES_CANDIDATS}
    ordre = sorted(s, key=s.get, reverse=True)
    marge = s[ordre[0]] - s[ordre[1]]
    if s[ordre[0]] < 3.0 or marge < 1.0:
        return None
    return ordre[0], marge >= 2.0


def analyser_vol(lib, chemin, idx):
    d = charger(chemin, idx)
    if d is None:
        return None
    H, c, A = d
    t = (A[:, c['time']] - A[0, c['time']]) * 1e-6
    dt = np.median(np.diff(t))
    lo, hi = H.get('motorOutput', [48, 2047])[:2]
    mot = A[:, [c[f'motor[{i}]'] for i in range(rj.nb_moteurs(c))]]
    cmd = np.clip((mot - lo) / (hi - lo), 0, 1)
    arme = (np.nan_to_num(A[:, c['flightModeFlags']]).astype(int) & 1) == 1
    r = {'idx': idx, 'duree': t[-1], 'H': H, 'defauts': [], 'mesures': {}}
    r['mesures']['saturation'] = 100 * (mot[arme] >= hi - 1).any(axis=1).mean() if arme.any() else 0
    if r['mesures']['saturation'] > 5:
        r['defauts'].append(f"moteurs saturés (100 %) pendant {r['mesures']['saturation']:.0f} % du vol : le PID demande plus que "
                            "le drone ne peut donner (moteur défaillant, hélice abîmée, crash ou réglage trop fort)")
    champs = rj.colonnes_erpm(list(c), H)
    if champs:
        e = A[:, [c[k] for k in champs]]
        fig = telemetrie_figee(e, cmd, arme[:, None] & (cmd > 0.08))
        r['mesures']['figee'] = fig
        for i, f in enumerate(fig):
            if f >= 1.0:
                r['defauts'].append(f'télémétrie DShot du moteur {i + 1} figée {f:.1f} % du temps (trames perdues : '
                                    'vérifier soudure du fil signal, câble ESC-FC, alimentation de l\'ESC)')
        if lib is not None:
            dd = rj.lire(chemin, idx)
            rel = rj.rejouer(lib, *dd, 40.0)
            r['relances'] = rel
            par = {}
            for tk, i, cc, rr in rel:
                par.setdefault(i, []).append((tk, cc, rr))
            for i, lst in sorted(par.items()):
                tk, cc, rr = lst[0]
                r['defauts'].append(f'moteur {i + 1} désynchronisé ou calé {len(lst)} fois (premier à {tk:.2f} s : commandé '
                                    f'{cc[i] * 100:.0f} %, {rr[i]:.0f} tr/min contre {np.delete(rr, i).min():.0f} à '
                                    f'{np.delete(rr, i).max():.0f} pour les autres)')
    mp = mesurer_poles(H, c, A)
    if mp:
        r['poles'] = mp
    vol = arme & (cmd.mean(axis=1) > 0.15)
    if vol.sum() * dt > 1.0:
        g = 'gyroUnfilt[0]' if 'gyroUnfilt[0]' in c else 'gyroADC[0]'
        gf = A[vol][:, [c['gyroADC[0]'], c['gyroADC[1]']]]
        gu = A[vol][:, [c[g], c[g.replace('[0]', '[1]')]]]
        r['mesures']['bruit_brut'] = float(np.std(np.diff(gu, axis=0)) / np.sqrt(2))
        r['mesures']['bruit_filtre'] = float(np.std(np.diff(gf, axis=0)) / np.sqrt(2))
        x = gf[:, 0] - gf[:, 0].mean(); n = 1 << int(np.log2(len(x)))
        sp = np.abs(np.fft.rfft(x[:n] * np.hanning(n))); f = np.fft.rfftfreq(n, dt)
        m = (f > 8) & (f < 100)
        pic = f[m][np.argmax(sp[m])]
        part = sp[m].max() ** 2 / max(1e-9, (sp[f > 8] ** 2).sum())
        r['mesures']['oscillation_hz'] = float(pic)
        if part > 0.05 and r['mesures']['bruit_filtre'] > 3:
            r['defauts'].append(f'oscillation lente vers {pic:.0f} Hz dans le gyro filtré (propwash ou P/D mal dosés)')
        r['mesures']['bruit_moteurs'] = float(np.std(np.diff(cmd[vol], axis=0)) * 100)
        if r['mesures']['bruit_moteurs'] > 2:
            r['defauts'].append(f"commande moteur bruitée ({r['mesures']['bruit_moteurs']:.1f} % par pas) : moteurs qui chauffent, "
                                'filtrage du D à renforcer')
    return r


def conseils_dshot(H):
    proto = PROTOCOLES[H['motor_pwm_protocol']] if isinstance(H.get('motor_pwm_protocol'), int) and H['motor_pwm_protocol'] < len(PROTOCOLES) else '?'
    boucle = 1e6 / (H.get('looptime', 125) * H.get('pid_process_denom', 1))
    lignes = []
    if H.get('dshot_bidir') and H.get('debug_mode') != rj.DEBUG_DSHOT_RPM_TELEMETRY and 'Betaflight 4.' in str(H.get('Firmware revision', '')):
        lignes.append('- Betaflight 4.4 / 4.5 n\'enregistre pas la vitesse des moteurs : pour la voir, mettre `set debug_mode = '
                      'DSHOT_RPM_TELEMETRY` avant de voler (désynchronisations et télémétrie figée seront alors analysées).')
    lignes += [f'- Protocole moteur : **{proto}**, boucle PID **{boucle / 1000:.0f} kHz**, DShot bidirectionnel : '
              f"**{'oui' if H.get('dshot_bidir') else 'non'}**."]
    if proto == 'DSHOT300' and boucle > 4100:
        lignes.append('- DShot300 avec une boucle PID au-dessus de 4 kHz : passer en DShot600 ou baisser la boucle à 4 kHz.')
    elif proto == 'DSHOT300':
        lignes.append('- DShot300 à 4 kHz est le bon choix avec le DShot bidirectionnel : DShot600 n\'apporte rien à 4 kHz et '
                      'rend la télémétrie plus sensible aux parasites (trame retour deux fois plus rapide).')
    elif proto == 'DSHOT600' and H.get('dshot_bidir'):
        lignes.append('- DShot600 bidirectionnel : si la télémétrie se fige ou si les moteurs saccadent, essayer DShot300 avec '
                      'une boucle PID à 4 kHz (pid_process_denom = 2).')
    return lignes


def rapport(chemins, lib):
    out = ['# Analyse des journaux de vol', '']
    for chemin in chemins:
        n = Parser.load(chemin).reader.log_count
        vols = [v for v in (analyser_vol(lib, chemin, i) for i in range(1, n + 1)) if v]
        if not vols:
            continue
        H = vols[0]['H']
        out += [f'## {os.path.basename(chemin)}', '',
                f"- Firmware : {H.get('Firmware revision', '?')} ; carte : {H.get('Board information', '?')} ; "
                f"nom : {H.get('Craft name', '?')}"]
        out += conseils_dshot(H)
        conc = conclure_poles([v['poles'] for v in vols if 'poles' in v])
        regle = H.get('motor_poles', 14)
        if conc is None:
            out += [f'- Pôles des moteurs : réglé à **{regle}** ; mesure impossible ou pas assez nette (il faut le gyro brut, '
                    'la vitesse des moteurs et quelques secondes de vol à gaz stables).']
        elif conc[0] == regle or (not conc[1] and abs(conc[0] - regle) <= 2):
            mesure = f'**{conc[0]}**' if conc[1] else f'environ **{conc[0]}** (±2)'
            out += [f'- Pôles des moteurs : réglé à **{regle}**, mesuré {mesure} dans les vibrations du gyro : '
                    + ('correct.' if conc[0] == regle else 'compter les aimants pour confirmer.')]
        else:
            out += [f'- **Pôles des moteurs : réglé à {regle}, mesuré {conc[0] if conc[1] else f"environ {conc[0]} (±2)"}** dans les vibrations du gyro. Le filtre RPM '
                    f'et le ralenti dynamique visent une mauvaise fréquence (facteur {regle / conc[0]:.2f}). Compter les aimants '
                    f'de la cloche puis `set motor_poles = <nombre d\'aimants>`.']
        out += [f"- Ralenti dynamique : {H.get('dyn_idle_min_rpm', 0) * 100} tr/min" + (' (désactivé)' if not H.get('dyn_idle_min_rpm') else ''),
                '', '| Vol | Durée (s) | Défauts constatés |', '|---|---|---|']
        for v in vols:
            out.append(f"| {v['idx']} | {v['duree']:.1f} | " + ('<br>'.join(v['defauts']) if v['defauts'] else 'aucun') + ' |')
        out.append('')
        # synthèse par moteur
        compte = {}
        for v in vols:
            for _, i, _, _ in v.get('relances', []):
                compte[i] = compte.get(i, 0) + 1
        if compte:
            pire = max(compte, key=compte.get)
            out += [f'**Synthèse** : {sum(compte.values())} désynchronisation(s) ou blocage(s), dont {compte[pire]} sur le '
                    f'moteur {pire + 1}.']
            if compte[pire] >= 0.7 * sum(compte.values()):
                out += [f'Un seul moteur concentre les défauts : panne matérielle probable du moteur {pire + 1} ou de sa voie '
                        'ESC (soudure d\'une phase, roulement, bobinage, MOSFET). Test : échanger ce moteur avec un autre ; '
                        'si le défaut suit le moteur, changer le moteur, sinon c\'est la voie ESC.']
            out.append('')
    return '\n'.join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('journaux', nargs='+'); ap.add_argument('-o', '--sortie')
    a = ap.parse_args()
    try:
        lib = rj.bibliotheque()
    except Exception as ex:   # pas de gcc : analyse sans détection de désynchronisation
        print('Détection de désynchronisation indisponible :', ex, file=sys.stderr)
        lib = None
    texte = rapport(a.journaux, lib)
    if a.sortie:
        open(a.sortie, 'w').write(texte + '\n')
    print(texte)


if __name__ == '__main__':
    main()
