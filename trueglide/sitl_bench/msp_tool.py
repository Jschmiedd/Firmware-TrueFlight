"""Lance le SITL TrueGlide, parle MSP v1 (trames longues comprises) et CLI."""
import os, socket, subprocess, sys, time
ELF = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'obj', 'main', 'trueglide_SITL.elf')
HERE = os.path.dirname(os.path.abspath(__file__)) + '/sitl'

class Sitl:
    def __init__(self, fresh=False):
        os.makedirs(HERE, exist_ok=True)
        if fresh and os.path.exists(HERE + '/eeprom.bin'):
            os.remove(HERE + '/eeprom.bin')
        self.p = subprocess.Popen(['stdbuf', '-oL', ELF], cwd=HERE, stdout=open(HERE + '/sitl_out.log', 'w'), stderr=subprocess.STDOUT)
        for _ in range(50):
            try:
                self.s = socket.create_connection(('127.0.0.1', 5761), timeout=3); break
            except OSError:
                time.sleep(0.1)
        time.sleep(0.3)
    def msp(self, cmd, payload=b''):
        for _ in range(3):
            try:
                return self._msp(cmd, payload)
            except (TimeoutError, OSError):
                self.s.close(); self.s = socket.create_connection(('127.0.0.1', 5761), timeout=3); time.sleep(0.2)
        raise TimeoutError('MSP')
    def _msp(self, cmd, payload=b''):
        self.s.settimeout(1.0)
        n = len(payload)
        c = n ^ cmd
        for b in payload: c ^= b
        self.s.sendall(b'$M<' + bytes([n, cmd]) + payload + bytes([c]))
        buf = b''; t0 = time.time()
        while time.time() - t0 < 3:
            try:
                buf += self.s.recv(65536)
            except socket.timeout:
                break
            i = buf.find(b'$M>')
            if i < 0 or len(buf) < i + 5: continue
            n = buf[i+3]; off = i + 5
            if n == 255:
                if len(buf) < i + 7: continue
                n = buf[i+5] | (buf[i+6] << 8); off = i + 7
            if len(buf) >= off + n: return buf[off:off+n]
        raise TimeoutError(buf[:40])
    def cli(self, *cmds):
        """Mode CLI : envoie chaque commande et attend l'invite « # » avant la suivante."""
        self.s.settimeout(0.3)
        self.s.sendall(b'#')
        self._lire_jusqua_invite(1.0)
        out = b''
        for c in cmds:
            self.s.sendall(c.encode() + b'\n')
            out += self._lire_jusqua_invite(3.0 if c in ('save', 'get', 'dump', 'diff') else 2.0)
        return out.decode(errors='replace')
    def _lire_jusqua_invite(self, delai):
        buf = b''; t0 = time.time()
        while time.time() - t0 < delai:
            try:
                d = self.s.recv(65536)
                if not d: break
                buf += d
                if buf.endswith(b'\r\n# ') or buf.endswith(b'\n# '): break
            except socket.timeout:
                pass
        return buf
    def close(self):
        try: self.s.close()
        except Exception: pass
        self.p.terminate(); self.p.wait(5)
