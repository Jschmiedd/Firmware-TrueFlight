// TrueGlide Studio : réglage de départ calculé à partir du drone (taille d'hélice, moteurs, batterie, masse, style).
// TrueGlide - Copyright (C) 2026 TalkTrueFPV. Derived from Betaflight.
// Free software under the GPL-3.0 license, WITHOUT ANY WARRANTY; see the LICENSE file.
//
// Principe (rien n'est inventé) :
// 1. Points d'appui : les réglages publiés par des régleurs reconnus dans les préréglages officiels de Betaflight
//    (dépôt betaflight/firmware-presets, firmware 2025.12), convertis en PID effectifs sur l'axe roulis. Voir REFERENCES.
// 2. Entre deux points d'appui : interpolation géométrique sur la taille d'hélice. Au-delà de 10" : prolongement de la
//    tendance 7" -> 10" (signalé comme EXTRAPOLÉ, à valider prudemment).
// 3. Correction physique bornée (± 20 %) : un drone plus puissant que la référence de sa taille (rapport poussée / poids)
//    reçoit des gains plus bas, et inversement. La poussée est estimée par la même formule pour le drone et pour la
//    référence, donc seule la comparaison compte.
// 4. Sortie : curseurs du réglage simplifié de Betaflight + « simplified_tuning apply ». Les PID affichés sont recalculés
//    avec la même formule que le firmware (src/main/config/simplified_tuning.c), troncature entière comprise.
(function (root) {
  'use strict';

  // Langue des textes produits ('fr' par défaut, 'en') : évaluée à chaque appel, jamais au chargement.
  var LANGUE = 'fr';
  function tr(fr, en) { return LANGUE === 'en' ? en : fr; }

  // Valeurs par défaut du firmware 2026.6.2 (src/main/flight/pid.h, sensors/gyro.h)
  var PID_DEFAULT = { roll: [45, 80, 30, 120], pitch: [47, 84, 34, 125], yaw: [45, 80, 0, 120] };
  var D_MAX_DEFAULT = { roll: 40, pitch: 46, yaw: 0 };
  var PID_GAIN_MAX = 250, F_GAIN_MAX = 1000;

  // Points d'appui (PID effectifs roulis : P, I, D, F) – préréglages communautaires firmware 2025.12, moyennes de :
  //  1,2" (Tiny Whoop 65 mm, hélices 31 mm) : UAV Tech Whoop 1S & 2S (71 / 127 / 67 / 191)
  //         AOS 65mm Tiny whoop (76 / 135 / 39 / 156). Masse 25 g : ESTIMATION d'un 65 mm 1S 300 mAh (non donnée).
  //  3,5" : Supafly 3/4" (56,7 / 85,7 / 37,8 / 122,4)  UAV Tech Micro (67,5 / 120 / 40,5 / 180)
  //         AOS 3.5 (64 / 115 / 50 / 195)  AOS 4 (67 / 119 / 50 / 195)
  //  5"   : UAV Tech 5" 650-750 g (79,2 / 126,7 / 48 / 249,6)  AOS 5 (67 / 119 / 47 / 187)
  //  7"   : AOS 7 (53 / 95 / 47 / 187)  AOS UL7 (49 / 88 / - / 156)  UAV Tech 6-7" (57,4 / 66,3 / 58,5 / 207)
  //         Supafly 7" (56,7 / 90,7 / 43,2 / 129,6)
  //  10"  : AOS UL10 (35 / 63 / 30 / 156)  UAV Tech 10" (36 / 64 / 40,8 / 192)
  // Préréglages par curseurs convertis avec la formule du firmware (F = 120 × maître × curseur FF, sans le curseur PI).
  var REFERENCES = [
    { pouces: 1.2, P: 73.5, I: 131.0, D: 53.0, F: 173.5, ralentiMin: 100, cellules: 1, kv: 23000, masse: 25,
      sources: ['UAV Tech Whoop (1S & 2S)', 'AOS 65mm Tiny whoop (Chris Rosser)'] },
    { pouces: 3.5, P: 63.8, I: 109.9, D: 44.6, F: 173.1, ralentiMin: 38, cellules: 4, kv: 3000, masse: 400,
      sources: ['SupaflyFPV Freestyle 3/4"', 'UAV Tech Micro 2-4"', 'AOS 3.5 (Chris Rosser)', 'AOS 4 (Chris Rosser)'] },
    { pouces: 5, P: 73.1, I: 122.9, D: 47.5, F: 218.3, ralentiMin: 30, cellules: 6, kv: 1900, masse: 700,
      sources: ['UAV Tech 5" freestyle 650-750 g', 'AOS 5 (Chris Rosser)'] },
    { pouces: 7, P: 54.0, I: 85.0, D: 49.6, F: 169.9, ralentiMin: 27, cellules: 6, kv: 1350, masse: 950,
      sources: ['AOS 7', 'AOS UL7 (Chris Rosser)', 'UAV Tech 6-7" 750-1000 g', 'SupaflyFPV Freestyle 7"'] },
    // ralentiMin 10" : 24 (choix TrueGlide). Les préréglages de référence restent à 27, jugé haut sur 10" : environ la moitié
    // de la vitesse de stationnaire, le drone flotte en descente et les moteurs chauffent. 22 à 25 est la pratique courante.
    { pouces: 10, P: 35.5, I: 63.5, D: 35.4, F: 174.0, ralentiMin: 24, cellules: 6, kv: 925, masse: 1550,
      sources: ['AOS UL10 (Chris Rosser)', 'UAV Tech 10" 1400-1700 g'] }
  ];

  // Filtres du réglage simplifié selon la qualité de construction (UAV Tech, options Low / Medium / High)
  var FILTRES = {
    bruyant: { petit: [60, 100], moyen: [40, 100], grand: [30, 80] },
    normal: { petit: [100, 120], moyen: [60, 120], grand: [60, 100] },
    rigide: { petit: [100, 120], moyen: [120, 120], grand: [100, 120] }
  };

  // Châssis : moteurs qui portent le drone et rendement de chacun. X8 coaxial : le moteur du bas tourne dans le flux
  // du moteur du haut ; 0,8 par moteur est une ESTIMATION courante (perte de 15 à 25 % pour une paire coaxiale), pas
  // une mesure. Quad X pusher : les 4 moteurs sont montés à l'envers sous les bras (hélices pusher) ; même mixeur et même
  // poussée comptée que le Quad X (aucune perte mesurée n'est appliquée).
  var CHASSIS = {
    quadx: { get nom() { return tr('Quad X', 'Quad X'); }, porteurs: 4, rendement: 1.0, sorties: 4, mixeur: 'QUADX' },
    hexa: { get nom() { return tr('Hexa X', 'Hexa X'); }, porteurs: 6, rendement: 1.0, sorties: 6, mixeur: 'HEX6X' },
    x8: { get nom() { return tr('X8 coaxial (octo)', 'X8 coaxial (octo)'); }, porteurs: 8, rendement: 0.8, sorties: 8, mixeur: 'OCTOX8' },
    quadx_pusher: { get nom() { return tr('Quad X pusher (moteurs à l\'envers)', 'Quad X pusher (motors upside down)'); }, porteurs: 4, rendement: 1.0, sorties: 4, mixeur: 'QUADX' }
  };

  var STYLES = {
    freestyle: { get nom() { return tr('Freestyle', 'Freestyle'); }, ff: 1.0, relax: 1.0, master: 1.0 },
    cinema: { get nom() { return tr('Cinématique (images fluides)', 'Cinematic (smooth footage)'); }, ff: 0.7, relax: 0.7, master: 1.0 },
    longue_portee: { get nom() { return tr('Longue portée', 'Long range'); }, ff: 0.85, relax: 1.0, master: 1.0 },
    course: { get nom() { return tr('Course', 'Racing'); }, ff: 1.15, relax: 1.4, master: 1.05 },
    speeder: { get nom() { return tr('Speeder (vitesse)', 'Speeder (speed)'); }, ff: 1.0, relax: 1.0, master: 1.0 }
  };

  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

  // Poussée statique d'un moteur, en grammes : T = Ct·ρ·n²·D⁴ (Ct = 0,1 ; même formule pour le drone et la référence).
  function pousseeEstimee(pouces, kv, cellules) {
    var tension = 3.6 * cellules;            // tension en charge
    var tps = kv * tension * 0.8 / 60;       // tours par seconde en charge
    var D = pouces * 0.0254;
    return 0.1 * 1.2 * tps * tps * Math.pow(D, 4) / 9.81 * 1000;
  }

  function rapportPoussee(pouces, kv, cellules, masse, chassis) {
    var c = CHASSIS[chassis] || CHASSIS.quadx;
    return c.porteurs * c.rendement * pousseeEstimee(pouces, kv, cellules) / masse;
  }

  // Interpolation géométrique entre points d'appui ; au-delà de 10" : tendance 7" -> 10".
  function interpoler(pouces, cle) {
    var R = REFERENCES;
    if (pouces <= R[0].pouces) return { v: R[0][cle], extrapole: pouces < R[0].pouces - 0.5 };
    for (var i = 0; i < R.length - 1; i++) {
      var a = R[i], b = R[i + 1];
      if (pouces <= b.pouces) {
        var t = Math.log(pouces / a.pouces) / Math.log(b.pouces / a.pouces);
        return { v: a[cle] * Math.pow(b[cle] / a[cle], t), extrapole: false };
      }
    }
    var p7 = R[2], p10 = R[3];
    var exposant = Math.log(p10[cle] / p7[cle]) / Math.log(p10.pouces / p7.pouces);
    if (cle === 'F') exposant = 0;            // le feedforward ne suit pas de tendance nette : gardé constant
    return { v: p10[cle] * Math.pow(pouces / p10.pouces, exposant), extrapole: true };
  }

  // Rapport poussée / poids estimé du drone de référence de cette taille ; null hors des points d'appui (pas de
  // comparaison possible : la formule n'est fiable qu'entre drones de même taille d'hélice).
  function rapportReference(pouces) {
    var R = REFERENCES;
    if (pouces < R[0].pouces || pouces > R[R.length - 1].pouces) return null;
    for (var i = 0; i < R.length - 1; i++) {
      if (pouces <= R[i + 1].pouces) {
        var t = Math.log(pouces / R[i].pouces) / Math.log(R[i + 1].pouces / R[i].pouces);
        var kv = R[i].kv * Math.pow(R[i + 1].kv / R[i].kv, t);
        var cel = R[i].cellules + t * (R[i + 1].cellules - R[i].cellules);
        var masse = R[i].masse * Math.pow(R[i + 1].masse / R[i].masse, t);
        return rapportPoussee(pouces, kv, cel, masse);
      }
    }
    return null;
  }

  // Même calcul que calculateNewPidValues() du firmware : flottants 32 bits opération par opération (Math.fround),
  // puis conversion en entier par troncature (constrain() reçoit un int), comme sur le contrôleur de vol.
  function pidsDepuisCurseurs(c) {
    var f = Math.fround;
    function mul() { var r = f(arguments[0]); for (var k = 1; k < arguments.length; k++) r = f(r * f(arguments[k])); return r; }
    function entier(x, hi) { return clamp(Math.trunc(x), 0, hi); }
    // compilé avec -ffast-math : « x / 100.0f » devient « x * 0.01f » (0,01 non représentable exactement)
    var cent = f(0.01);
    function pc(x) { return f(x * cent); }
    var m = pc(c.master), pi = pc(c.pi), d = pc(c.d), ff = pc(c.ff), ig = pc(c.i);
    var out = {};
    ['roll', 'pitch', 'yaw'].forEach(function (axe) {
      var def = PID_DEFAULT[axe];
      var pitchD = axe === 'pitch' ? pc(c.pitchD) : 1, pitchPi = axe === 'pitch' ? pc(c.pitchPi) : 1;
      var P = entier(mul(def[0], m, pi, pitchPi), PID_GAIN_MAX);
      var I = entier(mul(def[1], m, pi, ig, pitchPi), PID_GAIN_MAX);
      var D = entier(mul(def[2], m, d, pitchD), PID_GAIN_MAX);
      var F = entier(mul(def[3], m, pitchPi, ff), F_GAIN_MAX);
      var dmaxDef = D_MAX_DEFAULT[axe], dMax = 0;
      if (dmaxDef > 0) {
        var a = pc(c.dmax);
        var g = f(a + f(f(f(1 - a) * def[2]) / dmaxDef));
        dMax = entier(mul(dmaxDef, m, d, pitchD, g), PID_GAIN_MAX);
      }
      out[axe] = { P: P, I: I, D: D, F: F, Dmax: dMax };
    });
    return out;
  }

  function taille(p) { return p <= 5.5 ? 'petit' : (p <= 7.5 ? 'moyen' : 'grand'); }

  // Firmwares d'ESC : ce que chacun sait faire. dshot : protocole DShot ; bidir : DShot bidirectionnel (vitesse des
  // moteurs à chaque commande) ; edt : télémétrie DShot étendue (température) ; serie : télémétrie par fil séparé
  // (protocole KISS : température, courant, tension, vitesse, environ toutes les 40 ms par moteur).
  var ESC = {
    bluejay: { get nom() { return tr('BLHeli_S flashé en Bluejay', 'BLHeli_S flashed with Bluejay'); }, dshot: true, bidir: true, edt: true, serie: false },
    blheli_s: { get nom() { return tr('BLHeli_S d\'origine', 'Stock BLHeli_S'); }, dshot: true, bidir: false, edt: false, serie: false,
      get conseil() { return tr('Flasher Bluejay sur ces ESC (ESC Configurator, par la FC) apporte le DShot bidirectionnel : filtre RPM, ralenti dynamique et santé moteurs.',
        'Flashing Bluejay on these ESCs (ESC Configurator, through the FC) adds bidirectional DShot: RPM filter, dynamic idle and motor health.'); } },
    am32: { get nom() { return tr('AM32', 'AM32'); }, dshot: true, bidir: true, edt: true, serie: true },
    blheli_32: { get nom() { return tr('BLHeli_32', 'BLHeli_32'); }, dshot: true, bidir: true, edt: false, serie: true },
    kiss: { get nom() { return tr('KISS', 'KISS'); }, dshot: true, bidir: false, edt: false, serie: true },
    blheli: { get nom() { return tr('BLHeli ancien / SimonK (sans DShot)', 'Old BLHeli / SimonK (no DShot)'); }, dshot: false, protocole: 'ONESHOT125', bidir: false, edt: false, serie: false,
      get conseil() { return tr('Ancien firmware sans DShot : OneShot125 est le protocole le plus sûr (MultiShot si l\'ESC l\'accepte). Pas de vitesse moteur : ni filtre RPM ni santé moteurs.',
        'Old firmware without DShot: OneShot125 is the safest protocol (MultiShot if the ESC supports it). No motor RPM: neither RPM filter nor motor health.'); } },
    pwm: { get nom() { return tr('ESC analogique PWM (avion, ancien)', 'Analog PWM ESC (plane, old)'); }, dshot: false, protocole: 'PWM', bidir: false, edt: false, serie: false,
      get conseil() { return tr('Protocole PWM : boucle lente, aucune télémétrie. À réserver aux ESC qui n\'acceptent rien d\'autre.',
        'PWM protocol: slow loop, no telemetry. Only for ESCs that accept nothing else.'); } }
  };

  // Processeurs où Betaflight limite le DShot bidirectionnel à DShot300 et la boucle PID à 4 kHz
  // (USE_PID_DENOM_CHECK dans src/platform/*/target/*/target.h ; levé seulement si fortement surcadencé).
  var MCU_LIMITE_BIDIR = ['STM32F405', 'STM32F411', 'STM32G474', 'APM32F405', 'APM32F407', 'APM32F425', 'APM32F427'];

  // Fréquence du gyroscope (src/main/drivers/accgyro/gyro_sync.c) : 8 kHz sauf exceptions.
  function frequenceGyro(gyros) {
    if (!gyros || !gyros.length) return null;
    var f = gyros.map(function (g) {
      if (/BMI270|BMI160/.test(g)) return 3200;
      if (/LSM6DSO/.test(g)) return 6664;
      if (/ICM45686|ICM45605|ICM56686/.test(g)) return 6400;
      return 8000;
    });
    return Math.min.apply(null, f);    // carte à plusieurs gyroscopes possibles : le plus lent
  }

  // Protocole moteur et boucle PID selon l'ESC et la carte
  function choisirProtocole(caps, carte) {
    if (!caps.dshot) return { protocole: caps.protocole, boucle: null, pourquoi: caps.conseil };
    var mcu = carte && carte.mcu;
    var gyro = carte ? frequenceGyro(carte.g) : null;
    if (caps.bidir && mcu && MCU_LIMITE_BIDIR.indexOf(mcu) >= 0) {
      return { protocole: 'DSHOT300', boucle: gyro ? Math.min(gyro, 4000) : 4000,
        pourquoi: mcu + tr(' avec DShot bidirectionnel : le firmware impose DShot300 et une boucle PID de 4 kHz au plus ' +
          '(s\'il voit DShot600, il le remplace lui-même par DShot300).',
          ' with bidirectional DShot: the firmware enforces DShot300 and a PID loop of 4 kHz at most ' +
          '(if it sees DShot600, it replaces it with DShot300 by itself).') };
    }
    if (caps.bidir && !mcu) {
      return { protocole: 'DSHOT300', boucle: null,
        pourquoi: tr('Carte non indiquée : DShot300 marche partout avec le DShot bidirectionnel (DShot600 si processeur F7, H7 ou AT32).',
          'Board not specified: DShot300 works everywhere with bidirectional DShot (DShot600 with an F7, H7 or AT32 processor).') };
    }
    return { protocole: 'DSHOT600', boucle: gyro,
      pourquoi: (mcu ? mcu + tr(' : ', ': ') : '') + tr('DShot600, le plus rapide, convient à une boucle PID de 8 kHz.',
        'DShot600, the fastest, suits an 8 kHz PID loop.') };
  }

  // Entrée : { pouces, kv, cellules, masse (g), style, qualite ('bruyant'|'normal'|'rigide'), pwmEsc (24|48),
  //            poles (aimants du moteur, 14 par défaut) ; esc (clé de ESC) ou, à défaut, bidir (bool) ; carte (entrée de cartes.js, facultative) ;
  //            serieBranchee (bool : fil de télémétrie série relié) ; courantEsc (A, optionnel) ;
  //            capteurCourant (bool, sinon déduit de la carte) ; speeder: { angle, vitesse, mix } (optionnel) }
  function recommander(e) {
    var avert = [], notes = [], reglages = [], commandes = [];
    var style = STYLES[e.style] || STYLES.freestyle;
    function set(nom, valeur, pourquoi) { reglages.push({ nom: nom, valeur: String(valeur), pourquoi: pourquoi }); }

    if (!(e.pouces >= 1.2 && e.pouces <= 15)) throw new Error(tr('Taille d\'hélice hors de 1,2 à 15 pouces', 'Prop size outside 1.2 to 15 inches'));
    if (!(e.masse > 0 && e.kv > 0 && e.cellules >= 1)) throw new Error(tr('Masse, KV et nombre de cellules obligatoires', 'Weight, KV and cell count are required'));

    var base = {};
    var extrapole = false;
    ['P', 'I', 'D', 'F'].forEach(function (k) { var r = interpoler(e.pouces, k); base[k] = r.v; extrapole = extrapole || r.extrapole; });

    var chassis = CHASSIS[e.chassis] ? e.chassis : 'quadx';
    var ch = CHASSIS[chassis];
    var tw = rapportPoussee(e.pouces, e.kv, e.cellules, e.masse, chassis);
    var twRef = rapportReference(e.pouces);
    var facteur = twRef ? clamp(Math.sqrt(twRef / tw), 0.8, 1.2) : 1.0;
    var prudence = extrapole ? 0.85 : 1.0;      // départ plus bas hors des points d'appui

    var cible = {
      P: base.P * facteur * prudence * style.master,
      I: base.I * facteur * prudence * style.master,
      D: base.D * facteur * prudence * style.master,
      F: base.F * facteur * prudence * style.ff
    };

    // Curseurs : maître à 100, le reste porte la cible (le pilote ajuste ensuite le maître par pas de 5).
    var c = {
      master: 100,
      pi: Math.round(clamp(cible.P / PID_DEFAULT.roll[0] * 100, 0, 200)),
      d: Math.round(clamp(cible.D / PID_DEFAULT.roll[2] * 100, 0, 200)),
      dmax: 0,
      pitchPi: 100,
      pitchD: 100
    };
    c.i = Math.round(clamp(cible.I / (PID_DEFAULT.roll[1] * c.pi / 100) * 100, 0, 200));
    c.ff = Math.round(clamp(cible.F / PID_DEFAULT.roll[3] * 100, 0, 200));   // le firmware n'applique pas le curseur PI au FF

    var pids = pidsDepuisCurseurs(c);

    set('simplified_pids_mode', 'RPY', tr('Réglage simplifié actif sur les 3 axes : les curseurs du Configurator restent utilisables.',
      'Simplified tuning active on all 3 axes: the Configurator sliders stay usable.'));
    set('simplified_master_multiplier', c.master, tr('Curseur maître : c\'est lui que l\'on monte ou baisse pendant les essais.',
      'Master slider: this is the one you raise or lower during test flights.'));
    set('simplified_pi_gain', c.pi, tr('P et I selon la taille du drone et sa puissance.', 'P and I based on the quad\'s size and power.'));
    set('simplified_i_gain', c.i, tr('Part de I.', 'I share.'));
    set('simplified_d_gain', c.d, tr('Amortissement (D).', 'Damping (D).'));
    set('simplified_d_max_gain', c.dmax, tr('D constant (comme les préréglages de référence) : comportement plus prévisible.',
      'Constant D (like the reference presets): more predictable behaviour.'));
    set('simplified_feedforward_gain', c.ff, tr('Réactivité aux manches selon le style « ' + style.nom + ' ».', 'Stick responsiveness for the "' + style.nom + '" style.'));
    set('simplified_pitch_pi_gain', c.pitchPi, tr('Tangage comme roulis (le firmware garde déjà un tangage un peu plus fort).',
      'Pitch same as roll (the firmware already keeps pitch slightly stronger).'));
    set('simplified_pitch_d_gain', c.pitchD, '');

    // ESC et carte : protocole, télémétrie disponible
    var caps = e.esc ? ESC[e.esc] : { dshot: true, bidir: !!e.bidir, edt: !!e.bidir, serie: false };
    if (!caps) throw new Error(tr('Type d\'ESC inconnu : ', 'Unknown ESC type: ') + e.esc);

    // Filtres. Sans DShot bidirectionnel il n'y a pas de filtre RPM : le bruit des moteurs n'est retiré que par les
    // filtres passe-bas et le filtre dynamique, donc filtrage plus fort (gyro 70 % et D 100 % au plus).
    var f = FILTRES[e.qualite || 'normal'][taille(e.pouces)].slice();
    var sansRpm = !caps.bidir;
    if (sansRpm) f = [Math.min(f[0], 70), Math.min(f[1], 100)];
    set('simplified_gyro_filter', 'ON', '');
    set('simplified_gyro_filter_multiplier', f[0], sansRpm ?
      tr('Filtrage gyro selon la taille et la qualité de construction, renforcé faute de filtre RPM.', 'Gyro filtering based on size and build quality, strengthened since there is no RPM filter.') :
      tr('Filtrage gyro selon la taille et la qualité de construction.', 'Gyro filtering based on size and build quality.'));
    set('simplified_dterm_filter', 'ON', '');
    set('simplified_dterm_filter_multiplier', f[1], sansRpm ?
      tr('Filtrage du terme D, renforcé faute de filtre RPM : vérifier la température des moteurs après le premier vol.', 'D-term filtering, strengthened since there is no RPM filter: check motor temperature after the first flight.') :
      tr('Filtrage du terme D.', 'D-term filtering.'));
    var carte = e.carte || null;
    var serie = caps.serie && !!e.serieBranchee;     // la télémétrie série demande un fil vers un port série libre
    var proto = choisirProtocole(caps, carte);
    set('motor_pwm_protocol', proto.protocole, proto.pourquoi);
    if (caps.conseil) avert.push(caps.conseil);
    if (carte && carte.m && carte.m < ch.sorties) avert.push(tr('Cette carte n\'a que ' + carte.m + ' sorties moteur, il en faut ' + ch.sorties + ' (' + ch.nom + ').',
      'This board only has ' + carte.m + ' motor outputs, ' + ch.sorties + ' are needed (' + ch.nom + ').'));
    if (chassis === 'hexa' || chassis === 'x8') {
      notes.push(tr(ch.nom + ' : mixeur ' + ch.mixeur + ' (onglet Configuration, ou « mixer ' + ch.mixeur + ' » dans le CLI), puis vérifier l\'ordre et le sens des moteurs dans l\'onglet Moteurs. ' +
        'La santé moteurs, les alertes OSD et les outils de journaux suivent les ' + ch.porteurs + ' moteurs.',
        ch.nom + ': ' + ch.mixeur + ' mixer (Configuration tab, or "mixer ' + ch.mixeur + '" in the CLI), then check motor order and direction in the Motors tab. ' +
        'Motor health, OSD warnings and the log tools follow all ' + ch.porteurs + ' motors.'));
    }
    if (chassis === 'x8') {
      notes.push(tr('X8 coaxial : poussée estimée avec 20 % de perte par moteur (moteurs du bas dans le flux de ceux du haut) : c\'est une estimation, ' +
        'le rapport poussée / poids réel se vérifie au stationnaire (gaz de stationnaire dans le journal).',
        'X8 coaxial: thrust estimated with a 20 % loss per motor (bottom motors in the downwash of the top ones): this is an estimate, ' +
        'check the real thrust-to-weight ratio at hover (hover throttle in the log).'));
    }
    if (chassis === 'quadx_pusher') {
      notes.push(tr('Quad X pusher : mixeur Quad X normal. Les moteurs sont à l\'envers sous les bras, avec des hélices pusher. ' +
        'Dans l\'onglet Moteurs, le schéma et les sens de rotation se lisent VU DE DESSUS du drone : en regardant un moteur par en dessous, ' +
        'on voit le sens inverse. Vérifier sens et ordre hélices retirées, puis monter chaque hélice face marquée vers le haut (contre la cloche), ' +
        'de la même main qu\'à cette position sur le schéma.',
        'Quad X pusher: normal Quad X mixer. The motors are upside down under the arms, with pusher props. ' +
        'In the Motors tab, the diagram and spin directions are SEEN FROM ABOVE the quad: looking at a motor from below, ' +
        'you see the opposite direction. Check direction and order with props off, then fit each prop marked face up (towards the bell), ' +
        'with the same hand as at that position on the diagram.'));
    }
    if (serie) {
      commandes.push('feature ESC_SENSOR');
      notes.push(tr('Télémétrie série : relier le fil « TLM » de l\'ESC à l\'entrée RX d\'un port série libre, puis dans l\'onglet Ports ' +
        'activer « ESC » (capteur ESC) sur ce port.',
        'Serial telemetry: connect the ESC "TLM" wire to the RX pin of a free UART, then in the Ports tab ' +
        'enable "ESC" (ESC sensor) on that port.'));
    }

    // Nombre de pôles des aimants : la télémétrie donne une vitesse électrique, convertie avec ce nombre
    var poles = e.poles || 14;
    if (poles !== 14) {
      set('motor_poles', poles, tr('Moteur à ' + poles + ' pôles (aimants) : sans ce réglage, filtre RPM et ralenti dynamique visent une mauvaise fréquence.',
        'Motor with ' + poles + ' poles (magnets): without this setting, the RPM filter and dynamic idle target the wrong frequency.'));
    }
    if (poles > 14 && e.kv && e.cellules) {
      // vitesse électrique à vide, batterie pleine (4,2 V par cellule) : c'est elle que l'ESC doit suivre
      var erpmMax = Math.round(e.kv * e.cellules * 4.2 * poles / 2 / 1000);
      notes.push(tr('Moteur à ' + poles + ' aimants : à vide, batterie pleine, l\'ESC doit commuter jusqu\'à environ ' + erpmMax +
        ' 000 eRPM (KV × tension × pôles / 2). Vérifier que c\'est dans la limite indiquée par le fabricant de l\'ESC.',
        'Motor with ' + poles + ' magnets: unloaded, on a full battery, the ESC must commutate up to about ' + erpmMax +
        ' 000 eRPM (KV × voltage × poles / 2). Check that this is within the limit stated by the ESC manufacturer.'));
    }
    if (e.pouces < 2 && poles === 14) {
      notes.push(tr('Tiny Whoop : les moteurs 0702, 0802 et 1102 ont souvent 12 aimants (les préréglages whoop règlent motor_poles = 12). ' +
        'Vérifier la fiche du moteur et corriger « Pôles des moteurs ».',
        'Tiny Whoop: 0702, 0802 and 1102 motors often have 12 magnets (the whoop presets set motor_poles = 12). ' +
        'Check the motor spec sheet and correct "Motor poles".'));
    }
    if (poles % 2) avert.push(tr('Nombre de pôles impair (' + poles + ') : un moteur sans balais a toujours un nombre pair d\'aimants, vérifier la fiche du moteur.',
      'Odd pole count (' + poles + '): a brushless motor always has an even number of magnets, check the motor spec sheet.'));

    // Filtre RPM et ralenti dynamique : seulement avec la télémétrie DShot bidirectionnelle
    var ralenti = Math.round(interpoler(e.pouces, 'ralentiMin').v);
    if (e.pouces > 10) ralenti = Math.max(20, Math.round(ralenti * Math.pow(10 / e.pouces, 1)));
    if (caps.bidir) {
      set('dshot_bidir', 'ON', tr('Vitesse réelle des moteurs : filtre RPM et ralenti dynamique.', 'Actual motor RPM: RPM filter and dynamic idle.'));
      set('dyn_idle_min_rpm', ralenti, tr('Ralenti dynamique ' + (ralenti * 100) + ' tr/min : garde de l\'air sur les hélices (meilleur propwash, pas de désynchro).',
        'Dynamic idle ' + (ralenti * 100) + ' rpm: keeps air flowing over the props (better propwash handling, no desyncs).'));
      if (e.pouces < 2) {
        set('dyn_idle_p_gain', 40, tr('Tiny Whoop : ralenti dynamique plus doux (préréglage AOS 65mm).', 'Tiny Whoop: softer dynamic idle (AOS 65mm preset).'));
      }
      if (e.pouces >= 8) {
        notes.push(tr('Ralenti dynamique sur grandes hélices : en descente rapide gaz à zéro, si le drone tremble (propwash), monter de 2 ou 3 ; ' +
          's\'il flotte et descend mal, baisser de 2 ou 3.',
          'Dynamic idle on large props: in a fast descent at zero throttle, if the quad shakes (propwash), raise by 2 or 3; ' +
          'if it floats and will not come down, lower by 2 or 3.'));
      }
      if (e.pouces >= 6) {
        var minHz = clamp(Math.floor(0.9 * ralenti * 100 / 60), 30, 100);
        set('rpm_filter_min_hz', minHz, tr('Grandes hélices : fréquence moteur au ralenti ≈ ' + Math.round(ralenti * 100 / 60) + ' Hz, le filtre RPM doit descendre en dessous.',
          'Large props: motor frequency at idle ≈ ' + Math.round(ralenti * 100 / 60) + ' Hz, the RPM filter must go below it.'));
      }
    } else if (caps.dshot && e.pouces < 2) {
      avert.push(tr('Tiny Whoop sans DShot bidirectionnel : le préréglage AOS 65mm juge le filtre RPM obligatoire. Flasher les ESC en Bluejay ' +
        '(DShot bidirectionnel) avant de régler ; sans lui, le vol sera bruité et les moteurs chaufferont.',
        'Tiny Whoop without bidirectional DShot: the AOS 65mm preset calls the RPM filter mandatory. Flash the ESCs with Bluejay ' +
        '(bidirectional DShot) before tuning; without it the quad will be noisy and the motors will run hot.'));
    } else if (caps.dshot) {
      avert.push(tr('Sans DShot bidirectionnel, pas de filtre RPM ni de ralenti dynamique : le vol sera moins propre. ' +
        'Les ESC AM32, BLHeli_32 et BLHeli_S flashés en Bluejay le permettent.',
        'Without bidirectional DShot, no RPM filter or dynamic idle: the quad will fly less cleanly. ' +
        'AM32, BLHeli_32 and Bluejay-flashed BLHeli_S ESCs support it.'));
    }

    set('thrust_linear', e.pwmEsc >= 48 ? 20 : 0, e.pwmEsc >= 48 ? tr('ESC à 48 kHz : linéarisation de la poussée (UAV Tech).', '48 kHz ESC: thrust linearization (UAV Tech).') :
      tr('ESC à 24 kHz : pas de linéarisation (UAV Tech).', '24 kHz ESC: no linearization (UAV Tech).'));

    // Terme I et anti-gravité
    var relax = e.pouces <= 4 ? 10 : (e.pouces <= 5.5 ? 15 : (e.pouces <= 8 ? 8 : 5));
    relax = clamp(Math.round(relax * style.relax), 3, 30);
    set('iterm_relax_cutoff', relax, tr('Gros drones : coupure plus basse (inertie plus grande), comme les préréglages 7" et 10".',
      'Bigger quads: lower cutoff (more inertia), like the 7" and 10" presets.'));
    var ag = e.pouces <= 5.5 ? 100 : (e.pouces <= 8 ? 90 : 80);
    set('anti_gravity_gain', ag, '');
    if (e.pouces < 2) {
      set('pidsum_limit', 1000, tr('Tiny Whoop : toute l\'autorité au PID (UAV Tech Whoop).', 'Tiny Whoop: full authority to the PID (UAV Tech Whoop).'));
      set('pidsum_limit_yaw', 1000, '');
    }
    if (e.pouces >= 6) {
      set('pidsum_limit', 1000, tr('Grandes hélices : laisser toute l\'autorité au PID (UAV Tech).', 'Large props: give the PID full authority (UAV Tech).'));
      set('pidsum_limit_yaw', 1000, '');
    }
    if (e.style === 'longue_portee' || e.style === 'cinema' || e.pouces >= 7 || e.pouces < 2) {
      set('vbat_sag_compensation', 100, tr('Même réponse du début à la fin de la batterie (AOS).', 'Same response from the start to the end of the pack (AOS).'));
    }

    // Protection anti-surchauffe / surintensité (TrueGlide) : courant du capteur de la FC ou des ESC (série)
    var capteurCourant = e.capteurCourant !== undefined ? e.capteurCourant : !!(carte && carte.courant);
    if (!capteurCourant && serie) {
      set('current_meter', 'ESC', tr('Pas de capteur de courant sur la FC : courant lu par la télémétrie série des ESC.',
        'No current sensor on the FC: current read from the ESC serial telemetry.'));
      capteurCourant = true;
    }
    if (capteurCourant && e.courantEsc > 0) {
      // un ESC par moteur : le calibre total est celui de toutes les sorties moteur
      var limite = Math.round(ch.sorties * e.courantEsc * 0.8);
      if (limite > 1000) {
        avert.push(tr('Calibre total ' + ch.sorties + ' × ' + e.courantEsc + ' A : 80 % dépasse 1000 A, le maximum de power_guard_current. ' +
          'Limite de courant non proposée : vérifier le calibre saisi (par ESC, pas le total).',
          'Total rating ' + ch.sorties + ' × ' + e.courantEsc + ' A: 80 % exceeds 1000 A, the power_guard_current maximum. ' +
          'No current limit proposed: check the rating entered (per ESC, not the total).'));
      } else {
        set('power_guard_current', limite, tr('TrueGlide : gaz limités au-delà de 80 % de ' + ch.sorties + ' × ' + e.courantEsc + ' A (calibre continu de chaque ESC).',
          'TrueGlide: throttle limited above 80 % of ' + ch.sorties + ' × ' + e.courantEsc + ' A (continuous rating of each ESC).'));
      }
    }
    var temperature = (caps.bidir && caps.edt) || serie;
    if (caps.bidir && caps.edt) {
      set('dshot_edt', 'ON', tr('Télémétrie DShot étendue (' + caps.nom + ') : température des ESC, nécessaire à la limite de température.',
        'Extended DShot telemetry (' + caps.nom + '): ESC temperature, required for the temperature limit.'));
    }
    if (temperature) {
      set('power_guard_esc_temp', 100, tr('TrueGlide : gaz limités si un ESC dépasse 100 °C (' + (caps.bidir && caps.edt ? 'télémétrie DShot étendue' : 'télémétrie série') + ').',
        'TrueGlide: throttle limited if an ESC exceeds 100 °C (' + (caps.bidir && caps.edt ? 'extended DShot telemetry' : 'serial telemetry') + ').'));
      set('power_guard_min_throttle', 50, tr('Jamais moins de 50 % de gaz disponibles pendant la limitation.',
        'Never less than 50 % throttle available while limiting.'));
    } else if (caps.dshot) {
      notes.push(tr('Température des ESC indisponible avec ' + (caps.nom || 'cet ESC') + ' sans télémétrie : la limite de température TrueGlide ne peut pas fonctionner.',
        'ESC temperature unavailable with ' + (caps.nom || 'this ESC') + ' without telemetry: the TrueGlide temperature limit cannot work.'));
    }
    if (caps.bidir) {
      set('dshot_telemetry_fallback', 'ON', tr('TrueGlide : si la télémétrie d\'un ESC se perd, sa vitesse suit les autres moteurs au lieu de rester figée (filtre RPM juste).',
        'TrueGlide: if an ESC\'s telemetry drops out, its RPM follows the other motors instead of freezing (RPM filter stays accurate).'));
    }
    if (caps.bidir || serie) {
      set('motor_desync_recovery', 'ON', tr('TrueGlide : un moteur ' + (caps.bidir ? 'désynchronisé ou calé' : 'calé (détecté en 0,3 s par la télémétrie série)') +
        ' est relancé (coupé 50 ms puis remis) au lieu de chauffer à pleine puissance.',
        'TrueGlide: a ' + (caps.bidir ? 'desynced or stalled' : 'stalled (detected within 0.3 s by serial telemetry)') +
        ' motor is restarted (cut for 50 ms then re-enabled) instead of heating up at full power.'));
    } else {
      notes.push(tr('Sans vitesse des moteurs (ni DShot bidirectionnel ni télémétrie série), la santé moteurs TrueGlide ne peut pas fonctionner.',
        'Without motor RPM (neither bidirectional DShot nor serial telemetry), TrueGlide motor health cannot work.'));
    }

    // Speeder
    if (e.style === 'speeder') {
      var sp = e.speeder || {};
      set('speeder_cruise_angle', clamp(Math.round(sp.angle || 20), 10, 80), tr('Inclinaison atteinte en fin de transition (mode ANGLE + interrupteur SPEEDER) : 20° pour les premiers essais.',
        'Tilt reached at the end of the transition (ANGLE mode + SPEEDER switch): 20° for the first tests.'));
      set('speeder_transition_rate', clamp(Math.round(sp.vitesse || 30), 5, 180), tr('Vitesse de la transition en degrés par seconde.', 'Transition speed in degrees per second.'));
      set('speeder_fpv_mix', sp.mix ? 'ON' : 'OFF', tr('Roulis / lacet tournés avec la transition.', 'Roll / yaw rotated with the transition.'));
      notes.push(tr('Speeder : assigner le mode SPEEDER à un interrupteur (onglet Modes) et voler en mode ANGLE. ' +
        'Premiers essais avec speeder_cruise_angle = 20, puis monter par pas de 10°.',
        'Speeder: assign the SPEEDER mode to a switch (Modes tab) and fly in ANGLE mode. ' +
        'First tests with speeder_cruise_angle = 20, then raise in steps of 10°.'));
    }

    if (extrapole) {
      avert.push(tr('Taille hors des points d\'appui (' + e.pouces + '") : valeurs EXTRAPOLÉES et volontairement 15 % plus basses. ' +
        'Monter le curseur maître par pas de 5 en vérifiant la température des moteurs.',
        'Size outside the reference points (' + e.pouces + '"): EXTRAPOLATED values, deliberately 15 % lower. ' +
        'Raise the master slider in steps of 5 while checking motor temperature.'));
    }
    if (!twRef) {
      notes.push(tr('Hors de 3,5" à 10" : pas de correction selon la puissance (aucun drone de référence comparable).',
        'Outside 3.5" to 10": no power-based correction (no comparable reference quad).'));
    } else if (facteur <= 0.8 || facteur >= 1.2) {
      avert.push(tr('Rapport poussée / poids très différent de la référence de cette taille : correction plafonnée à ± 20 %.',
        'Thrust-to-weight ratio very different from the reference for this size: correction capped at ± 20 %.'));
    }
    notes.push(tr('Premier vol : stationnaire 30 s, atterrir, toucher les moteurs. Tièdes : monter le curseur maître de 5. ' +
      'Chauds ou bruit aigu : baisser le filtre (curseur gyro) ou le maître. Oscillations lentes : baisser le maître de 10.',
      'First flight: hover for 30 s, land, touch the motors. Warm: raise the master slider by 5. ' +
      'Hot or high-pitched noise: lower the filter (gyro slider) or the master. Slow oscillations: lower the master by 10.'));

    return {
      curseurs: c,
      pids: pids,
      commandes: commandes,
      protocole: proto,
      reglages: reglages,
      avertissements: avert,
      notes: notes,
      physique: {
        // puissance relative à la référence de même taille (estimation) : +20 % = 20 % plus puissant
        puissanceRelative: twRef ? Math.round((tw / twRef - 1) * 100) : null,
        facteur: Math.round(facteur * 100) / 100,
        extrapole: extrapole
      },
      sources: REFERENCES.filter(function (r) { return Math.abs(r.pouces - e.pouces) <= 3; })
        .reduce(function (a, r) { return a.concat(r.sources); }, [])
    };
  }

  function versCli(rec, entete) {
    var l = ['# ' + (entete || 'TrueGlide Studio'), tr('# À coller dans l\'onglet CLI du Configurator, puis « save » est inclus à la fin.',
      '# Paste into the Configurator CLI tab; "save" is included at the end.')];
    (rec.commandes || []).forEach(function (c) { l.push(c); });
    rec.reglages.forEach(function (r) { l.push('set ' + r.nom + ' = ' + r.valeur); });
    l.push('simplified_tuning apply');
    l.push('save');
    return l.join('\n');
  }

  // Vérifie chaque réglage contre la base extraite du firmware (nom connu, valeur dans les bornes ou permise).
  function verifier(reglages, db) {
    var erreurs = [];
    reglages.forEach(function (r) {
      var d = db[r.nom];
      if (!d) { erreurs.push(r.nom + tr(' : réglage inconnu du firmware', ': setting unknown to the firmware')); return; }
      if ('min' in d) {
        var v = Number(r.valeur);
        if (!Number.isInteger(v) || v < d.min || v > d.max) erreurs.push(r.nom + ' = ' + r.valeur + tr(' hors de ', ' outside ') + d.min + '..' + d.max);
      } else if (d.values) {
        if (d.values.indexOf(r.valeur) < 0) erreurs.push(r.nom + ' = ' + r.valeur + tr(' non permis (', ' not allowed (') + d.values.join(', ') + ')');
      }
    });
    return erreurs;
  }

  var API = {
    REFERENCES: REFERENCES, STYLES: STYLES, ESC: ESC, CHASSIS: CHASSIS, rapportPoussee: rapportPoussee, MCU_LIMITE_BIDIR: MCU_LIMITE_BIDIR, frequenceGyro: frequenceGyro,
    choisirProtocole: choisirProtocole, recommander: recommander, versCli: versCli, verifier: verifier,
    pidsDepuisCurseurs: pidsDepuisCurseurs, pousseeEstimee: pousseeEstimee, interpoler: interpoler,
    langue: function (l) { LANGUE = (l === 'en') ? 'en' : 'fr'; }
  };
  if (typeof module !== 'undefined') module.exports = API; else root.TFTune = API;
})(this);
