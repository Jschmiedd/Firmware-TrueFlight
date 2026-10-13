import math, struct, time
from msp_tool import Sitl
from quadsim import Quad, Link, SIM, qrot_inv
s = Sitl(fresh=True); link = Link(); quad = Quad()
def hold(seconds):
    n = int(seconds * 1000); start = time.perf_counter() - SIM['t']
    for _ in range(n):
        SIM['t'] += 0.001
        link.send(quad, SIM['t'], [1500, 1500, 1000, 1500] + [1000] * 12)
        w = start + SIM['t'] - time.perf_counter()
        if w > 0: time.sleep(w)
def axis_q(axis, deg):
    h = math.radians(deg) / 2; v = [0, 0, 0]; v[axis] = math.sin(h); return (math.cos(h), *v)
def report(label):
    a = struct.unpack('<hhh', s.msp(108)[:6]); g = struct.unpack('<9h', s.msp(102)[:18])[3:6]
    print(f"{label:38s} FC att roll {a[0]/10:6.1f} pitch {a[1]/10:6.1f} yaw {a[2]:4d} | gyro {g}")
try:
    for label, q, w in [("à plat", (1, 0, 0, 0), [0, 0, 0]),
                        ("nez vers le BAS 20° (rot +y FLU)", axis_q(1, 20), [0, 0, 0]),
                        ("aile droite en BAS 20° (rot +x FLU)", axis_q(0, 20), [0, 0, 0]),
                        ("nez vers la gauche 30° (rot +z FLU)", axis_q(2, 30), [0, 0, 0]),
                        ("à plat", (1, 0, 0, 0), [0, 0, 0])]:
        quad.q = q; quad.w = [0,0,0]; quad.acc_body = qrot_inv(q, (0.0, 0.0, 9.81)); hold(4.0); report(label)
finally:
    s.close()
