import struct
from msp_tool import Sitl
from quadsim import Quad, Link, fly
setup = ["feature -RX_SERIAL", "feature RX_UDP", "aux 0 0 0 1700 2100 0 0", "aux 1 1 1 1700 2100 0 0",
         "aux 2 120 2 1700 2100 0 0", "set small_angle = 180", "set runaway_takeoff_prevention = OFF",
         "set speeder_cruise_angle = 30", "set speeder_transition_rate = 60", "save"]
s = Sitl(fresh=True); s.cli(*setup); s.close()
s = Sitl(); link = Link(); quad = Quad()
rc = lambda thr, arm, sp: [1500, 1500, thr, 1500, arm, 2000, sp] + [1500] * 9
att = lambda: struct.unpack('<hh', s.msp(108)[:4])[1] / 10
try:
    fly(link, quad, rc(1000, 1000, 1000), 6); fly(link, quad, rc(1000, 2000, 1000), 1); fly(link, quad, rc(1400, 2000, 1000), 0.5)
    print("stationnaire        FC %5.1f  sim %5.1f" % (att(), quad.pitch_deg()))
    for i in range(8):
        fly(link, quad, rc(1400, 2000, 2000), 0.1)
        print("SPEEDER +%4d ms    FC %5.1f  sim %5.1f  (consigne attendue %4.1f)" % ((i + 1) * 100, att(), quad.pitch_deg(), min(30, 6 * (i + 1))))
    for i in range(6):
        fly(link, quad, rc(1400, 2000, 1000), 0.1)
        print("retour  +%4d ms    FC %5.1f  sim %5.1f  (consigne attendue %4.1f)" % ((i + 1) * 100, att(), quad.pitch_deg(), max(0, 30 - 6 * (i + 1))))
finally:
    s.close()
