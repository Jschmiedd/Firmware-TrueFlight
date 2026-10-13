// Tests de TrueGlide Studio : node --test trueglide/studio/test/studio.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/tune.js');
const A = require('../js/analyse.js');
const N = require('../js/nav.js');
const DB = require('../js/settings_db.js');
const CARTES = require('../js/cartes.js');

const base = { kv: 1350, cellules: 6, masse: 950, style: 'freestyle', qualite: 'normal', pwmEsc: 24, bidir: true };

test('tous les réglages proposés existent dans le firmware et respectent ses bornes', () => {
  for (const pouces of [2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) {
    for (const style of Object.keys(T.STYLES)) {
      for (const qualite of ['bruyant', 'normal', 'rigide']) {
        for (const bidir of [true, false]) {
          const r = T.recommander({ ...base, pouces, style, qualite, bidir, capteurCourant: true, courantEsc: 60,
            speeder: { angle: 70, vitesse: 40, mix: true } });
          assert.deepEqual(T.verifier(r.reglages, DB), [], `${pouces}" ${style} ${qualite}`);
        }
      }
    }
  }
});

test('un 7" standard retombe sur la moyenne des préréglages 7"', () => {
  const r = T.recommander({ ...base, pouces: 7 });
  assert.equal(r.physique.facteur, 1);
  assert.ok(Math.abs(r.pids.roll.P - 54) <= 1, `P = ${r.pids.roll.P}`);
  assert.ok(Math.abs(r.pids.roll.I - 85) <= 1, `I = ${r.pids.roll.I}`);
  assert.ok(Math.abs(r.pids.roll.D - 49.6) <= 1, `D = ${r.pids.roll.D}`);
  assert.ok(Math.abs(r.pids.roll.F - 169.9) <= 2, `F = ${r.pids.roll.F}`);
});

test('les gains baissent quand la taille augmente (7" -> 10" -> 15")', () => {
  const p = [7, 10, 15].map(pouces => T.recommander({ ...base, pouces, kv: 900, masse: 1500 }).pids.roll.P);
  assert.ok(p[0] > p[1] && p[1] > p[2], p.join(' > '));
});

test('un drone plus lourd (moins puissant) reçoit des gains plus forts, borné à +20 %', () => {
  const leger = T.recommander({ ...base, pouces: 7, masse: 950 });
  const lourd = T.recommander({ ...base, pouces: 7, masse: 1400 });
  assert.ok(lourd.pids.roll.P > leger.pids.roll.P);
  assert.ok(lourd.physique.facteur <= 1.2);
});

test('au-delà de 10" : extrapolé, prudent et signalé', () => {
  const r = T.recommander({ ...base, pouces: 13, kv: 500, cellules: 8, masse: 4000 });
  assert.equal(r.physique.extrapole, true);
  assert.equal(r.physique.puissanceRelative, null);
  assert.ok(r.avertissements.some(a => /EXTRAPOL/.test(a)));
});

test('sans DShot bidirectionnel : ni filtre RPM ni ralenti dynamique, et un avertissement', () => {
  const r = T.recommander({ ...base, pouces: 7, bidir: false });
  const noms = r.reglages.map(x => x.nom);
  assert.ok(!noms.includes('dshot_bidir') && !noms.includes('dyn_idle_min_rpm') && !noms.includes('rpm_filter_min_hz'));
  assert.ok(r.avertissements.length > 0);
});

test('grandes hélices : le filtre RPM descend sous la fréquence du ralenti', () => {
  const r = T.recommander({ ...base, pouces: 10, kv: 925, masse: 1550 });
  const idle = Number(r.reglages.find(x => x.nom === 'dyn_idle_min_rpm').valeur) * 100 / 60;
  const minHz = Number(r.reglages.find(x => x.nom === 'rpm_filter_min_hz').valeur);
  assert.ok(minHz < idle, `${minHz} Hz < ${idle} Hz`);
});

test('DShot bidirectionnel : protections santé moteurs proposées', () => {
  const r = T.recommander({ ...base, pouces: 3, kv: 4600, cellules: 4, masse: 410 });
  const v = n => (r.reglages.find(x => x.nom === n) || {}).valeur;
  assert.equal(v('dshot_telemetry_fallback'), 'ON');
  assert.equal(v('motor_desync_recovery'), 'ON');
  assert.equal(v('dshot_edt'), 'ON');   // sans elle, pas de température ESC pour power_guard_esc_temp
  const sans = T.recommander({ ...base, pouces: 3, kv: 4600, cellules: 4, masse: 410, bidir: false });
  assert.ok(!sans.reglages.some(x => x.nom === 'motor_desync_recovery'));
});

test('style speeder : réglages de transition présents', () => {
  const r = T.recommander({ ...base, pouces: 3, kv: 2800, cellules: 4, masse: 300, style: 'speeder', speeder: { angle: 65, vitesse: 25 } });
  const v = n => r.reglages.find(x => x.nom === n).valeur;
  assert.equal(v('speeder_cruise_angle'), '65');
  assert.equal(v('speeder_transition_rate'), '25');
  assert.equal(v('speeder_fpv_mix'), 'OFF');
});

test('calcul des PID identique au firmware (cas connus vérifiés dans le SITL)', () => {
  // valeurs par défaut du firmware : curseurs à 100 (D et Dmax à 100 aussi ici)
  const d = T.pidsDepuisCurseurs({ master: 100, pi: 100, i: 100, d: 100, dmax: 100, ff: 100, pitchPi: 100, pitchD: 100 });
  assert.deepEqual(d.roll, { P: 45, I: 80, D: 30, F: 120, Dmax: 40 });
  assert.deepEqual(d.pitch, { P: 47, I: 84, D: 34, F: 125, Dmax: 46 });
  assert.deepEqual(d.yaw, { P: 45, I: 80, D: 0, F: 120, Dmax: 0 });
});

test('CLI : se termine par simplified_tuning apply puis save', () => {
  const cli = T.versCli(T.recommander({ ...base, pouces: 5 })).split('\n');
  assert.equal(cli[cli.length - 2], 'simplified_tuning apply');
  assert.equal(cli[cli.length - 1], 'save');
  assert.ok(cli.every(l => l.startsWith('#') || l.startsWith('set ') || l === 'simplified_tuning apply' || l === 'save'));
});

test('analyse : lit l\'en-tête des trois firmwares TRUEGLIDE, TRUENAV et TRUENAV_LIGHT', () => {
  for (const nom of ['TRUEGLIDE', 'TRUENAV', 'TRUENAV_LIGHT']) {
    const cfg = A.lire(`# ${nom} / STM32F405 (S405) 2026.6.2 Oct 12 2026 / 20:00:00 (d53eca0) MSP API: 1.48`);
    assert.equal(cfg.mcu, 'STM32F405', nom);
    assert.equal(cfg.version, '2026.6.2', nom);
  }
});

test('analyse : lit un diff all et repère les problèmes', () => {
  const diff = [
    '# version',
    '# Betaflight / STM32F405 (S405) 2025.12.2 Jan  1 2026 / 00:00:00 (abcdef) MSP API: 1.47',
    'board_name SPEEDYBEEF405V4',
    'feature GPS',
    'aux 0 0 0 1700 2100 0 0',
    'set motor_pwm_protocol = DSHOT300',
    'set failsafe_procedure = DROP',
    'profile 0',
    'set p_roll = 50'
  ].join('\n');
  const cfg = A.lire(diff);
  assert.equal(cfg.carte, 'SPEEDYBEEF405V4');
  assert.equal(cfg.version, '2025.12.2');
  assert.equal(cfg.set.p_roll, '50');
  assert.equal(cfg.aux.length, 1);
  const c = A.controler(cfg, DB, { pouces: 7 }).map(x => x.texte).join('\n');
  assert.match(c, /2025\.12\.2/);           // version différente
  assert.match(c, /dshot_bidir/);           // bidir absent = OFF par défaut sur une vraie carte
  assert.match(c, /GPS-RESCUE/);
  assert.match(c, /power_guard/);
  const e = A.ecarts(cfg, DB, [{ nom: 'motor_pwm_protocol', valeur: 'DSHOT600', pourquoi: '' }, { nom: 'p_roll', valeur: '50', pourquoi: '' }]);
  assert.deepEqual(e.map(x => x.nom), ['motor_pwm_protocol']);
});

test('navigation : commandes waypoint au format exact du firmware', () => {
  const m = N.genererMission({ altitudeSolAmsl: 152.4, points: [
    { lat: 46.2044, lon: 6.1432, hauteur: 30, vitesse: 5, type: 'FLYOVER', duree: 0 },
    { lat: 46.2050, lon: 6.1440, hauteur: 40, vitesse: 8, type: 'HOLD', duree: 12.5, motif: 'ORBIT' },
    { lat: 46.2044, lon: 6.1432, hauteur: 0, vitesse: 3, type: 'LAND', duree: 0 }
  ] });
  assert.deepEqual(m.erreurs, []);
  assert.deepEqual(m.lignes, [
    'waypoint clear',
    'waypoint insert 0 46.2044000 6.1432000 18240 500 FLYOVER 0 NONE',
    'waypoint insert 1 46.2050000 6.1440000 19240 800 HOLD 125 ORBIT',
    'waypoint insert 2 46.2044000 6.1432000 15240 300 LAND 0 NONE'
  ]);
  // 2 × 90,8 m : Δlat 0,0006° = 66,7 m, Δlon 0,0008° × cos 46,2° = 61,6 m
  assert.ok(m.distanceTotaleM >= 181 && m.distanceTotaleM <= 182, String(m.distanceTotaleM));
});

test('navigation : refuse une mission sans altitude du terrain ou trop longue', () => {
  assert.ok(N.genererMission({ points: [{ lat: 1, lon: 1, hauteur: 10, vitesse: 1, type: 'FLYOVER' }] }).erreurs.length > 0);
  const trop = Array.from({ length: 31 }, () => ({ lat: 1, lon: 1, hauteur: 10, vitesse: 1, type: 'FLYOVER' }));
  assert.ok(N.genererMission({ altitudeSolAmsl: 0, points: trop }).erreurs.some(e => /30/.test(e)));
});

test('navigation : réglages dans les bornes du firmware', () => {
  const s = N.genererReglages({ vitesseMax: 12, angleMax: 45, rayonArrivee: 4, retourAlt: 50, vitesseRetour: 10,
    satellitesMin: 10, failsafeGps: true, barriereM: 800, actionBarriere: 'RTH', perteRadio: 'CONTINUE' });
  assert.deepEqual(T.verifier(s, DB), []);
});

test('distance GPS : 1° de latitude ≈ 111,2 km', () => {
  const d = N.distance({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
  assert.ok(Math.abs(d - 111195) < 10, String(d));
});

test('compatibilité : tous les types d\'ESC sur toutes les cartes donnent des réglages valides', () => {
  const noms = Object.keys(CARTES);
  for (const esc of Object.keys(T.ESC)) {
    for (const nom of noms) {
      for (const serieBranchee of [false, true]) {
        const r = T.recommander({ ...base, pouces: 5, esc, carte: CARTES[nom], serieBranchee, courantEsc: 40 });
        assert.deepEqual(T.verifier(r.reglages, DB), [], `${esc} / ${nom}`);
      }
    }
  }
});

test('F405 / F411 / G474 avec DShot bidirectionnel : DShot300 et 4 kHz (règle de Betaflight)', () => {
  for (const nom of ['SPEEDYBEEF405MINI', 'MATEKF411', 'NEUTRONRCG4AIO']) {
    const r = T.recommander({ ...base, pouces: 5, esc: 'bluejay', carte: CARTES[nom] });
    assert.equal(r.protocole.protocole, 'DSHOT300', nom);
    assert.ok(r.protocole.boucle <= 4000, nom);
  }
  for (const nom of ['MATEKH743', 'SPEEDYBEEF7V3', 'JHEF435PRO']) {
    assert.equal(T.recommander({ ...base, pouces: 5, esc: 'am32', carte: CARTES[nom] }).protocole.protocole, 'DSHOT600', nom);
  }
});

test('ESC sans DShot bidirectionnel : pas de réglage qui en dépend', () => {
  for (const esc of ['blheli_s', 'blheli', 'pwm', 'kiss']) {
    const noms = T.recommander({ ...base, pouces: 5, esc }).reglages.map(x => x.nom);
    for (const n of ['dshot_bidir', 'dyn_idle_min_rpm', 'dshot_telemetry_fallback', 'dshot_edt']) assert.ok(!noms.includes(n), `${esc} ${n}`);
  }
  assert.equal(T.recommander({ ...base, pouces: 5, esc: 'blheli' }).protocole.protocole, 'ONESHOT125');
  assert.equal(T.recommander({ ...base, pouces: 5, esc: 'pwm' }).protocole.protocole, 'PWM');
});

test('télémétrie série (KISS, BLHeli_32, AM32) : capteur ESC, température et moteur calé', () => {
  const r = T.recommander({ ...base, pouces: 5, esc: 'kiss', serieBranchee: true, capteurCourant: false, courantEsc: 30 });
  const v = n => (r.reglages.find(x => x.nom === n) || {}).valeur;
  assert.deepEqual(r.commandes, ['feature ESC_SENSOR']);
  assert.equal(v('current_meter'), 'ESC');
  assert.equal(v('power_guard_esc_temp'), '100');
  assert.equal(v('motor_desync_recovery'), 'ON');
  assert.ok(T.versCli(r).includes('feature ESC_SENSOR'));
  // sans le fil : rien de tout ça
  const sans = T.recommander({ ...base, pouces: 5, esc: 'kiss', serieBranchee: false });
  assert.ok(!sans.reglages.some(x => x.nom === 'motor_desync_recovery'));
});

test('base des cartes : 629 cartes, gyroscope reconnu sur toutes les cartes de vol', () => {
  assert.equal(Object.keys(CARTES).length, 629);
  const sansGyro = Object.entries(CARTES).filter(([n, c]) => !c.g.length && !/^(NUCLEO|SITL|PICO|STM32F411DISCO|STM32N657DK)/.test(n));
  assert.deepEqual(sansGyro.map(([n]) => n), []);
  assert.equal(T.frequenceGyro(['BMI270']), 3200);
  assert.equal(T.frequenceGyro(['ICM42688P']), 8000);
});

test('analyse : DShot600 + bidirectionnel sur F405 expliqué', () => {
  const cfg = A.lire('board_name SPEEDYBEEF405MINI\nset motor_pwm_protocol = DSHOT600\nset dshot_bidir = ON');
  const c = A.controler(cfg, DB, { pouces: 3 }, CARTES).map(x => x.texte).join('\n');
  assert.match(c, /remplace lui-même par DShot300/);
});

test('conversion d\'un diff Betaflight 4.4 : renommages, inversion du D, suppressions', () => {
  const d = ['# Betaflight / STM32F405 (S405) 4.4.2 May 31 2023 / 22:53:28 (23d066d) MSP API: 1.45',
    'board_name SPEEDYBEEF405MINI', 'feature -AIRMODE', 'aux 0 0 0 1800 2100 0 0',
    'set dshot_idle_value = 450', 'set gyro_1_sensor_align = CW90', 'set abs_control_gain = 10',
    'set gps_rescue_throttle_hover = 1350', 'profile 0', 'set d_roll = 45', 'set d_min_roll = 32',
    'set level_limit = 85', 'set simplified_dmax_gain = 0', 'save'].join('\n');
  const r = A.migrer(d, DB);
  assert.equal(r.inversionD, true);
  assert.deepEqual(r.lignes, ['board_name SPEEDYBEEF405MINI', 'feature -AIRMODE', 'aux 0 0 0 1800 2100 0 0',
    'set motor_idle = 450', 'set ap_hover_throttle = 1350', 'profile 0', 'set d_max_roll = 45', 'set d_roll = 32',
    'set angle_limit = 80']);
  assert.deepEqual(r.retires.map(x => x.nom).sort(), ['abs_control_gain', 'gyro_1_sensor_align', 'simplified_dmax_gain']);
  assert.deepEqual(r.invalides, []);
  // toutes les lignes « set » converties sont valides pour TrueGlide
  const sets = r.lignes.filter(l => l.startsWith('set ')).map(l => { const m = l.match(/^set (\S+) = (.*)$/); return { nom: m[1], valeur: m[2] }; });
  assert.deepEqual(T.verifier(sets, DB), []);
});

test('conversion : un diff 2025.12 garde le sens du D, un diff 2026.6 est inchangé', () => {
  const v2025 = A.migrer('# Betaflight / STM32F405 (S405) 2025.12.2 Feb 23 2026\nset d_roll = 30\nset d_max_roll = 40', DB);
  assert.equal(v2025.inversionD, false);
  assert.deepEqual(v2025.lignes, ['set d_roll = 30', 'set d_max_roll = 40']);
  const v2026 = A.migrer('# Betaflight / STM32F405 (S405) 2026.6.2\nset p_roll = 50', DB);
  assert.deepEqual([v2026.traduits.length, v2026.retires.length, v2026.lignes], [0, 0, ['set p_roll = 50']]);
});

test('moteurs à nombre de pôles différent : motor_poles réglé, rien si 14', () => {
  const r = T.recommander({ ...base, pouces: 5, esc: 'bluejay', poles: 24 });
  assert.equal(r.reglages.find(x => x.nom === 'motor_poles').valeur, '24');
  // 1350 KV × 6 × 4,2 V × 24 / 2 = 408 240 eRPM à vide
  assert.ok(r.notes.some(n => n.includes('408 000 eRPM')));
  assert.deepEqual(T.verifier(r.reglages, DB), []);
  assert.ok(!T.recommander({ ...base, pouces: 5, esc: 'bluejay' }).reglages.some(x => x.nom === 'motor_poles'));
});

test('diff all : PID réglés dans un profil qui ne vole pas', () => {
  const diff = ['# Betaflight / STM32F405 (S405) 4.4.2 Jan  1 2023 / 00:00:00 (23d066d) MSP API: 1.45', 'board_name SPEEDYBEEF405MINI',
    'profile 0', 'set p_roll = 55', 'set d_roll = 45', 'profile 1', '# restore original profile selection', 'profile 1',
    'rateprofile 0', 'set roll_rc_rate = 115', '# restore original rateprofile selection', 'rateprofile 0'].join('\n');
  const cfg = A.lire(diff);
  assert.deepEqual([cfg.profil, cfg.profilRate], [1, 0]);
  assert.equal(cfg.profilsRate[0].roll_rc_rate, '115');
  assert.ok(!('roll_rc_rate' in cfg.profilsPid[1]));          // les rates ne se rangent plus dans un profil PID
  const alertes = A.controler(cfg, DB, {}).filter(x => x.niveau === 'alerte').map(x => x.texte);
  assert.equal(alertes.length, 1);
  assert.match(alertes[0], /profil PID actif est le 1.*profil 0/);
  // profil actif réglé : aucune alerte
  assert.equal(A.controler(A.lire(diff.replace('selection\nprofile 1', 'selection\nprofile 0')), DB, {}).filter(x => x.niveau === 'alerte').length, 0);
});

test('textes en anglais : plus de français, mêmes valeurs qu\'en français', () => {
  const FRANCAIS = /[éèàçÉÈÀÇ«»]| (le|la|les|du|des|est) /i;
  const entree = { ...base, pouces: 5, esc: 'blheli_s', poles: 13, capteurCourant: true, courantEsc: 40 };
  const diff = ['# Betaflight / STM32F405 (S405) 4.4.2 May 31 2023 / 22:53:28 (23d066d) MSP API: 1.45',
    'board_name SPEEDYBEEF405MINI', 'feature GPS', 'set dshot_idle_value = 450', 'set abs_control_gain = 10',
    'set level_limit = 85', 'set motor_pwm_protocol = MULTISHOT', 'set failsafe_procedure = DROP', 'set motor_poles = 12',
    'profile 0', 'set p_roll = 55', 'set d_min_roll = 32', 'profile 1', 'rateprofile 0', 'set roll_rc_rate = 115', 'rateprofile 1'].join('\n');
  const fr = T.recommander(entree);
  let en, textes;
  try {
    T.langue('en'); A.langue('en'); N.langue('en');
    en = T.recommander(entree);
    const en5 = T.recommander({ ...base, pouces: 5 });
    const en13 = T.recommander({ ...base, pouces: 13, kv: 500, cellules: 8, masse: 4000, esc: 'kiss', style: 'speeder' });
    const mig = A.migrer(diff, DB);
    const ctrl = A.controler(A.lire(diff), DB, { pouces: 7 }, CARTES).concat(
      A.controler(A.lire('board_name SPEEDYBEEF405MINI\nset motor_pwm_protocol = DSHOT600\nset dshot_bidir = ON'), DB, { pouces: 7 }, CARTES));
    const m = N.genererMission({ altitudeSolAmsl: 100, points: [{ lat: 46.2, lon: 6.1, hauteur: 2, vitesse: 5, type: 'FLYOVER' },
      { lat: 46.3, lon: 6.1, hauteur: 30, vitesse: 5, type: 'HOLD', duree: 5 }] });
    const reg = N.genererReglages({ vitesseMax: 12, angleMax: 45, rayonArrivee: 4, retourAlt: 50, vitesseRetour: 10,
      satellitesMin: 10, failsafeGps: true, barriereM: 800, actionBarriere: 'RTH', perteRadio: 'CONTINUE' });
    textes = [en, en5, en13].flatMap(r => r.reglages.map(x => x.pourquoi).concat(r.avertissements, r.notes, [r.protocole.pourquoi]))
      .concat(ctrl.map(x => x.texte), mig.traduits.map(x => x.note), mig.retires.map(x => x.raison),
        m.avertissements, reg.map(x => x.pourquoi), N.versCli(m, reg).split('\n').filter(l => l[0] === '#'),
        Object.keys(T.STYLES).map(k => T.STYLES[k].nom), Object.keys(T.ESC).map(k => T.ESC[k].nom), N.TYPES.map(t => N.NOMS_TYPES[t]));
    assert.ok(ctrl.length > 5 && mig.traduits.length > 0 && m.avertissements.length > 0);
  } finally {
    T.langue('fr'); A.langue('fr'); N.langue('fr');
  }
  for (const t of textes) assert.ok(!FRANCAIS.test(' ' + t + ' '), t);
  assert.deepEqual(en.reglages.map(x => [x.nom, x.valeur]), fr.reglages.map(x => [x.nom, x.valeur]));
  assert.deepEqual([en.curseurs, en.pids, en.physique, en.protocole.protocole], [fr.curseurs, fr.pids, fr.physique, fr.protocole.protocole]);
  assert.equal(T.STYLES.cinema.nom, 'Cinématique (images fluides)');   // retour au français
});

test('Châssis : poussée selon le nombre de moteurs porteurs, conseils et sorties de la carte', () => {
  const base = { pouces: 7, kv: 1300, cellules: 6, masse: 1000, style: 'freestyle', esc: 'bluejay' };
  const q = T.rapportPoussee(7, 1300, 6, 1000, 'quadx');
  assert.equal(T.rapportPoussee(7, 1300, 6, 1000), q);                       // défaut : quad
  assert.ok(Math.abs(T.rapportPoussee(7, 1300, 6, 1000, 'hexa') / q - 1.5) < 1e-9);
  assert.ok(Math.abs(T.rapportPoussee(7, 1300, 6, 1000, 'x8') / q - 1.6) < 1e-9);   // 8 × 0,8 / 4
  assert.equal(T.rapportPoussee(7, 1300, 6, 1000, 'quadx_pusher'), q);         // moteurs à l'envers : comme un quad X
  const quad = T.recommander(base);
  const x8 = T.recommander(Object.assign({}, base, { chassis: 'x8', carte: { m: 4 } }));
  assert.ok(x8.notes.some(n => n.includes('OCTOX8')));
  assert.ok(x8.avertissements.some(a => a.includes('il en faut 8')));
  assert.ok(x8.physique.facteur <= quad.physique.facteur);                   // plus de poussée : gains pas plus hauts
  // Quad X pusher : 4 moteurs à l'envers, mixeur Quad X, conseil sur le sens de rotation vu de dessus
  const pusher = T.recommander(Object.assign({}, base, { chassis: 'quadx_pusher', carte: { m: 4 } }));
  assert.ok(!pusher.avertissements.some(a => a.includes('il en faut')));
  assert.ok(pusher.notes.some(n => n.includes('VU DE DESSUS')));
  assert.ok(!pusher.reglages.some(r => r.nom.startsWith('pusher') || r.nom === 'speeder_pusher_angle'));
});

test('limite de courant : un ESC par sortie moteur (hexa, X8 compris)', () => {
  const v = (r, n) => (r.reglages.find(x => x.nom === n) || {}).valeur;
  const opts = { ...base, pouces: 7, capteurCourant: true, courantEsc: 55 };
  assert.equal(v(T.recommander({ ...opts, chassis: 'quadx' }), 'power_guard_current'), '176');
  assert.equal(v(T.recommander({ ...opts, chassis: 'quadx_pusher' }), 'power_guard_current'), '176');
  assert.equal(v(T.recommander({ ...opts, chassis: 'x8' }), 'power_guard_current'), '352');
  // au-delà du maximum du firmware : rien n'est écrit, un avertissement l'explique
  const trop = T.recommander({ ...opts, chassis: 'x8', courantEsc: 200 });
  assert.equal(v(trop, 'power_guard_current'), undefined);
  assert.ok(trop.avertissements.some(a => /1000 A/.test(a)));
});

test('speeder sans angle choisi : 20° pour les premiers essais', () => {
  const r = T.recommander({ ...base, pouces: 5, kv: 1900, masse: 700, style: 'speeder' });
  assert.equal(r.reglages.find(x => x.nom === 'speeder_cruise_angle').valeur, '20');
});

test('sans filtre RPM, filtrage renforcé', () => {
  const v = (r, n) => Number(r.reglages.find(x => x.nom === n).valeur);
  const avec = T.recommander({ ...base, pouces: 3, kv: 4600, cellules: 4, masse: 410, qualite: 'rigide' });
  const sans = T.recommander({ ...base, pouces: 3, kv: 4600, cellules: 4, masse: 410, qualite: 'rigide', bidir: false });
  assert.equal(v(avec, 'simplified_gyro_filter_multiplier'), 100);
  assert.equal(v(sans, 'simplified_gyro_filter_multiplier'), 70);
  assert.equal(v(sans, 'simplified_dterm_filter_multiplier'), 100);
});

test('ralenti dynamique : 27 en 7", 24 en 10", 20 au plus bas au-delà', () => {
  const v = r => Number(r.reglages.find(x => x.nom === 'dyn_idle_min_rpm').valeur);
  assert.equal(v(T.recommander({ ...base, pouces: 7 })), 27);
  assert.equal(v(T.recommander({ ...base, pouces: 10, kv: 925, masse: 1550 })), 24);
  const v12 = v(T.recommander({ ...base, pouces: 12, kv: 700, masse: 2500 }));
  assert.ok(v12 >= 20 && v12 <= 24, `12" : ${v12}`);
});

test('Tiny Whoop : point d\'appui 1,2" (UAV Tech Whoop, AOS 65mm), réglages dans les bornes', () => {
  const whoop = { pouces: 1.2, kv: 23000, cellules: 1, masse: 25, style: 'freestyle', qualite: 'normal', pwmEsc: 48, esc: 'bluejay' };
  const r = T.recommander(whoop);
  assert.deepEqual(T.verifier(r.reglages, DB), []);
  assert.equal(r.physique.facteur, 1);                       // le drone de référence lui-même
  assert.ok(Math.abs(r.pids.roll.P - 73.5) <= 1, `P = ${r.pids.roll.P}`);
  const v = n => (r.reglages.find(x => x.nom === n) || {}).valeur;
  assert.equal(v('dyn_idle_min_rpm'), '100');
  assert.equal(v('pidsum_limit'), '1000');
  assert.equal(v('vbat_sag_compensation'), '100');
  assert.ok(r.notes.some(n => n.includes('12 aimants')));    // moteurs de whoop souvent à 12 pôles
  // 75 mm 2S : entre le whoop et le 3,5", toujours valide
  const r75 = T.recommander({ ...whoop, pouces: 1.6, kv: 13500, cellules: 2, masse: 35 });
  assert.deepEqual(T.verifier(r75.reglages, DB), []);
  assert.throws(() => T.recommander({ ...whoop, pouces: 1.1 }));
});
