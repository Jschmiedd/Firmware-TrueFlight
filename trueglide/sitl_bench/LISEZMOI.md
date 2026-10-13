# Banc d'essai SITL (TrueGlide)

Petit simulateur physique de quadri X (Python, sans dépendance) branché sur le firmware compilé pour PC
(`make TARGET=SITL`), via le protocole du pont Gazebo de Betaflight (UDP 9002 à 9004) et MSP / CLI (TCP 5761).

- `test_axes.py` : vérifie que les axes du simulateur et ceux du firmware concordent (gyro, accéléromètre).
- `test_speeder_court.py` : stationnaire puis interrupteur SPEEDER (croisière 30°, 60°/s) et retour ;
  affiche l'inclinaison visée par le firmware et celle du drone simulé.

Lancer depuis ce dossier, après `make TARGET=SITL` : `python3 test_speeder_court.py`.

## Limite connue (à lire)

Le simulateur est cadencé sur le temps réel en Python et l'attitude estimée par le firmware s'écarte de
l'attitude « vraie » du simulateur dès que le drone accélère à l'horizontale. Il sert à vérifier la
**logique** du firmware (sens des commandes, programme de transition, modes, réglages), pas à juger la
qualité du vol : ça, seul un vol réel prudent le dit.

Résultat du 11 octobre 2026 (`test_speeder_court.py`) : l'inclinaison visée par le firmware suit le programme
attendu (0 → 30° en 0,5 s, maintien, retour vers 0), nez vers le bas comme le manche avant.
