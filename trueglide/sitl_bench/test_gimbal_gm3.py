"""Pilote nacelle Caddx GM3 sur le SITL : UART2 (TCP 5762) en fonction GIMBAL.
Vérifie : trames envoyées à la nacelle (en-tête A5 5A, CRC CCITT), recentrage sans suivi de tête,
renvoi d'un octet d'en-tête suivi d'un autre octet (correction du « && »).
Simulateur seulement : un port TCP sans client ne se vide jamais et finit par bloquer la boucle, d'où la connexion
immédiate au port de la nacelle."""
import socket, struct, time
from msp_tool import Sitl

def crc16_ccitt(data):
    crc = 0
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xffff if crc & 0x8000 else (crc << 1) & 0xffff
    return crc

def lire(sock, duree):
    sock.settimeout(0.1); buf = b''; t0 = time.time()
    while time.time() - t0 < duree:
        try:
            buf += sock.recv(4096)
        except socket.timeout:
            pass
    return buf

s = Sitl(fresh=True)
out = s.cli("serial 1 262144 115200 57600 0 115200", "get gimbal_sensitivity", "save")
print("\n".join(l for l in out.splitlines() if l.startswith(("serial", "gimbal", "###"))))
s.close()
s = Sitl()
g = socket.create_connection(('127.0.0.1', 5762), timeout=3)
try:
    flux = lire(g, 1.0)
    trames = [flux[i:i + 10] for i in range(len(flux) - 9) if flux[i:i + 2] == b'\xa5\x5a']
    print("octets reçus en 1 s :", len(flux), " trames :", len(trames))
    t = trames[-1]
    crc_ok = struct.unpack('<H', t[8:10])[0] == ((crc16_ccitt(t[:8]) >> 8) | ((crc16_ccitt(t[:8]) & 0xff) << 8))
    print("dernière trame :", t.hex(), " CRC correct :", crc_ok)
    lire(g, 0.2)
    g.sendall(b'\xa5\x12')                      # début d'en-tête puis autre chose : doit être renvoyé tel quel
    retour = lire(g, 0.3)
    i = retour.find(b'\x12')
    print("renvoi après en-tête incomplet :", retour[max(0, i - 1):i + 1].hex() if i >= 0 else "rien")
finally:
    g.close(); s.close()
