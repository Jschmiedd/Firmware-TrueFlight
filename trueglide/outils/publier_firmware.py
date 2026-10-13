#!/usr/bin/env python3
# TrueGlide - Copyright (C) 2026 TalkTrueFPV. Derived from Betaflight.
# Free software under the GPL-3.0 license, WITHOUT ANY WARRANTY; see the LICENSE file.
"""Prépare le dossier « firmware/ » lu par la mise à jour en ligne de TrueGlide Configurator.

Entrée : les fichiers .hex du dossier obj/ (trueglide_*, truenav_*, truenav_light_*).
Sortie (à mettre en ligne sur GitHub Pages, à côté de l'application) :
    <sortie>/firmware/index.json                 manifeste : version, révision, date, liste des fichiers
    <sortie>/firmware/<MODELE>/<nom>.hex.gz      fichiers .hex compressés

Sécurité : un .hex n'est publié que si la révision git compilée dedans est celle du commit actuel (arbre
propre). Un fichier plus ancien ou compilé avec des modifications non commitées est écarté et listé. Le
manifeste donne la somme SHA-256 du .hex décompressé : le Configurator la vérifie avant de flasher.

Usage : python3 trueglide/outils/publier_firmware.py --sortie DOSSIER [--obj obj] [--cartes A,B]
"""
import argparse
import datetime
import gzip
import hashlib
import json
import pathlib
import re
import subprocess
import sys

MODELES = [("truenav_light_", "TRUENAV_LIGHT"), ("truenav_", "TRUENAV"), ("trueglide_", "STANDARD")]
NOM = re.compile(r"^(?P<version>[0-9][0-9.]*)_(?P<mcu>[A-Z0-9]+)_(?P<carte>[A-Z0-9_]+)\.hex$")


def analyser_nom(nom):
    """Modèle, version, MCU et carte d'après le nom du fichier, ou None si ce n'est pas un .hex TrueGlide."""
    for prefixe, modele in MODELES:
        if nom.startswith(prefixe):
            m = NOM.match(nom[len(prefixe):])
            if m:
                return {"model": modele, "version": m["version"], "mcu": m["mcu"], "board": m["carte"]}
    return None


def octets_hex(texte):
    """Contenu binaire d'un fichier Intel HEX (enregistrements de données mis bout à bout, dans l'ordre)."""
    donnees = bytearray()
    for ligne in texte.splitlines():
        ligne = ligne.strip()
        if not ligne.startswith(":"):
            continue
        brut = bytes.fromhex(ligne[1:])
        if len(brut) < 5 or sum(brut) & 0xFF:
            raise ValueError("ligne Intel HEX invalide : " + ligne[:20])
        if brut[3] == 0x00:
            donnees += brut[4:4 + brut[0]]
    return bytes(donnees)


def revision_git(racine):
    """Révision courte (9 caractères, comme le Makefile) si l'arbre est propre, sinon None."""
    if subprocess.run(["git", "diff", "--shortstat"], cwd=racine, capture_output=True, text=True).stdout.strip():
        return None
    return subprocess.run(["git", "rev-parse", "--short=9", "HEAD"], cwd=racine, capture_output=True,
                          text=True, check=True).stdout.strip()


def preparer(obj, sortie, revision, cartes=None, date=None):
    """Écrit le manifeste et les .hex.gz ; renvoie (manifeste, fichiers écartés)."""
    fichiers, ecartes, versions = [], [], set()
    for chemin in sorted(pathlib.Path(obj).glob("*.hex")):
        info = analyser_nom(chemin.name)
        if info is None or (cartes and info["board"] not in cartes):
            continue
        brut = chemin.read_bytes()  # tel quel (fins de ligne comprises) : la somme SHA-256 porte sur ces octets
        if revision.encode("ascii") not in octets_hex(brut.decode("ascii")):
            ecartes.append(chemin.name)
            continue
        relatif = f"{info['model']}/{chemin.name}.gz"
        cible = pathlib.Path(sortie) / "firmware" / relatif
        cible.parent.mkdir(parents=True, exist_ok=True)
        # mtime=0 : même entrée, même fichier compressé (pas de différence inutile d'une publication à l'autre)
        cible.write_bytes(gzip.compress(brut, compresslevel=9, mtime=0))
        versions.add(info["version"])
        fichiers.append({**info, "file": relatif, "size": len(brut), "sha256": hashlib.sha256(brut).hexdigest()})
    if len(versions) > 1:
        raise SystemExit("plusieurs versions dans obj/ : " + ", ".join(sorted(versions)))
    manifeste = {
        "format": 1,
        "version": versions.pop() if versions else None,
        "revision": revision,
        "date": date or datetime.date.today().isoformat(),
        "files": sorted(fichiers, key=lambda f: (f["board"], f["model"])),
    }
    dossier = pathlib.Path(sortie) / "firmware"
    dossier.mkdir(parents=True, exist_ok=True)
    (dossier / "index.json").write_text(json.dumps(manifeste, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return manifeste, ecartes


def main():
    racine = pathlib.Path(__file__).resolve().parents[2]
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--sortie", required=True, help="dossier du site (le sous-dossier firmware/ y est créé)")
    p.add_argument("--obj", default=str(racine / "obj"), help="dossier des .hex (obj/ par défaut)")
    p.add_argument("--cartes", default="", help="liste de cartes séparées par des virgules (toutes par défaut)")
    a = p.parse_args()
    revision = revision_git(racine)
    if not revision:
        sys.exit("Modifications non commitées : commiter, recompiler, puis publier.")
    cartes = {c.strip().upper() for c in a.cartes.split(",") if c.strip()} or None
    manifeste, ecartes = preparer(a.obj, a.sortie, revision, cartes)
    print(f"{len(manifeste['files'])} fichiers publiés (version {manifeste['version']}, révision {revision}).")
    if ecartes:
        print(f"{len(ecartes)} fichiers écartés (pas compilés depuis ce commit) : recompiler ces cartes.")
        for nom in ecartes[:20]:
            print("  " + nom)


if __name__ == "__main__":
    main()
