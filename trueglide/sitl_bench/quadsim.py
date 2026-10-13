"""Simulateur physique minimal de quadri X branché sur le SITL TrueGlide (protocole du pont Gazebo).
Corps FLU (x avant, y gauche, z haut), monde ENU. Sert à vérifier en boucle fermée le sens et
l'amplitude des assiettes commandées (mode angle, transition speeder)."""
import math, socket, struct, time

def qmul(a, b):
    w1, x1, y1, z1 = a; w2, x2, y2, z2 = b
    return (w1*w2 - x1*x2 - y1*y2 - z1*z2, w1*x2 + x1*w2 + y1*z2 - z1*y2,
            w1*y2 - x1*z2 + y1*w2 + z1*x2, w1*z2 + x1*y2 - y1*x2 + z1*w2)

def qrot(q, v):  # corps -> monde
    w, x, y, z = q
    p = qmul(qmul(q, (0.0, *v)), (w, -x, -y, -z))
    return p[1:]

def qrot_inv(q, v):
    w, x, y, z = q
    return qrot((w, -x, -y, -z), v)

class Quad:
    MASS = 0.8; ARM = 0.085; TMAX = 7.85; KYAW = 0.015; TAU = 0.02
    I = (0.004, 0.004, 0.007)
    # ordre Betaflight QUADX : M1 arrière droit, M2 avant droit, M3 arrière gauche, M4 avant gauche
    POS = ((-1, -1), (1, -1), (-1, 1), (1, 1))
    SPIN = (-1, 1, 1, -1)   # +1 : couple de réaction +z (calibré sur le mixeur Betaflight, props in)

    def __init__(self):
        self.q = (1.0, 0.0, 0.0, 0.0); self.w = [0.0, 0.0, 0.0]
        self.v = [0.0, 0.0, 0.0]; self.p = [0.0, 0.0, 50.0]
        self.mot = [0.0] * 4; self.acc_body = (0.0, 0.0, 9.81)

    def step(self, cmd, dt):
        for i in range(4):
            self.mot[i] += (max(0.0, min(1.0, cmd[i])) - self.mot[i]) * dt / (self.TAU + dt)
        T = [self.TMAX * m * m for m in self.mot]
        a = self.ARM
        tx = sum(self.POS[i][1] * a * T[i] for i in range(4))
        ty = sum(-self.POS[i][0] * a * T[i] for i in range(4))
        tz = sum(self.SPIN[i] * self.KYAW * T[i] for i in range(4))
        I = self.I; w = self.w
        dw = ((tx - (I[2] - I[1]) * w[1] * w[2]) / I[0],
              (ty - (I[0] - I[2]) * w[2] * w[0]) / I[1],
              (tz - (I[1] - I[0]) * w[0] * w[1]) / I[2])
        self.w = [w[k] + dw[k] * dt for k in range(3)]
        # intégration de l'attitude
        dq = qmul(self.q, (0.0, *self.w))
        q = tuple(self.q[k] + 0.5 * dq[k] * dt for k in range(4))
        n = math.sqrt(sum(c * c for c in q)); self.q = tuple(c / n for c in q)
        F = qrot(self.q, (0.0, 0.0, sum(T)))
        drag = [-0.3 * c for c in self.v]
        acc = [(F[k] + drag[k]) / self.MASS for k in range(3)]; acc[2] -= 9.81
        self.v = [self.v[k] + acc[k] * dt for k in range(3)]
        self.p = [self.p[k] + self.v[k] * dt for k in range(3)]
        spec = [acc[0], acc[1], acc[2] + 9.81]
        self.acc_body = qrot_inv(self.q, spec)

    def pitch_deg(self):
        """Inclinaison du nez : + = nez vers le bas (convention Betaflight)."""
        nose = qrot(self.q, (1.0, 0.0, 0.0))
        return -math.degrees(math.asin(max(-1.0, min(1.0, nose[2]))))

    def roll_deg(self):
        left = qrot(self.q, (0.0, 1.0, 0.0))
        return math.degrees(math.asin(max(-1.0, min(1.0, left[2]))))

    def fdm(self, t):
        w = self.w
        gyro = (w[0], -w[1], -w[2])                  # capteur FRD
        acc = (-self.acc_body[0], -self.acc_body[1], -self.acc_body[2])   # calibré : voir test_axes.py
        rx = (0.0, 1.0, 0.0, 0.0)
        qp = qmul(qmul(rx, self.q), rx)
        return struct.pack('<d3d3d4d3d3dd', t, *gyro, *acc, *qp, *self.v, *self.p, 101325.0)

class Link:
    def __init__(self):
        self.out = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.inp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.inp.bind(('127.0.0.1', 9002)); self.inp.setblocking(False)
        self.motors = [0.0] * 4
    def send(self, quad, t, rc):
        self.out.sendto(quad.fdm(t), ('127.0.0.1', 9003))
        self.out.sendto(struct.pack('<d16H', t, *rc), ('127.0.0.1', 9004))
        try:
            while True:
                d = self.inp.recv(64)
                self.motors = list(struct.unpack('<4f', d[:16]))
        except BlockingIOError:
            pass

SIM = {'t': 0.0}

def fly(link, quad, rc, seconds, log=None, dt=0.001):
    """Avance la simulation de `seconds` à pas fixe, cadencée sur le temps réel (1 kHz)."""
    n = int(round(seconds / dt))
    start = time.perf_counter() - SIM['t']
    for _ in range(n):
        quad.step(link.motors, dt)
        SIM['t'] += dt
        link.send(quad, SIM['t'], rc)
        if log is not None: log.append((SIM['t'], quad.pitch_deg(), quad.roll_deg(), quad.p[2]))
        wait = start + SIM['t'] - time.perf_counter()
        if wait > 0: time.sleep(wait)
