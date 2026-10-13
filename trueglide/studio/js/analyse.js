// TrueGlide Studio : lecture d'un « diff all » (ou « dump ») du Configurator et contrôles de cohérence.
// TrueGlide - Copyright (C) 2026 TalkTrueFPV. Derived from Betaflight.
// Free software under the GPL-3.0 license, WITHOUT ANY WARRANTY; see the LICENSE file.
(function (root) {
  'use strict';

  // Langue des textes produits ('fr' par défaut, 'en') : évaluée à chaque appel, jamais au chargement.
  var LANGUE = 'fr';
  function tr(fr, en) { return LANGUE === 'en' ? en : fr; }

  // Lit les lignes utiles d'un diff / dump : en-tête de version, carte, features, set, aux, profils.
  function lire(texte) {
    // profil / profilRate : profils actifs. Un « diff all » liste chaque profil puis resélectionne l'actif
    // (dernière ligne « profile N » / « rateprofile N »).
    var r = { version: null, carte: null, mcu: null, features: { on: [], off: [] }, set: {}, aux: [], profil: 0, profilsPid: {},
      profilRate: 0, profilsRate: {} };
    var profil = null, groupe = null;
    String(texte || '').split(/\r?\n/).forEach(function (ligne) {
      var l = ligne.trim();
      var m;
      if ((m = l.match(/^#\s*(Betaflight|TrueGlide|TrueFlight|TrueNav(?:[ _]Light)?)\s*\/\s*(\S+)\s*\(([^)]*)\)\s*(\S+)/i))) {
        r.mcu = m[2]; r.carte = m[3]; r.version = m[4];
        return;
      }
      if ((m = l.match(/^board_name\s+(\S+)/))) { r.carte = m[1]; return; }
      if ((m = l.match(/^feature\s+(-?)(\S+)/))) { (m[1] ? r.features.off : r.features.on).push(m[2]); return; }
      if ((m = l.match(/^profile\s+(\d+)/))) {
        profil = Number(m[1]); groupe = r.profilsPid; r.profil = profil; groupe[profil] = groupe[profil] || {}; return;
      }
      if ((m = l.match(/^rateprofile\s+(\d+)/))) {
        profil = Number(m[1]); groupe = r.profilsRate; r.profilRate = profil; groupe[profil] = groupe[profil] || {}; return;
      }
      if ((m = l.match(/^aux\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/))) {
        r.aux.push({ index: +m[1], mode: +m[2], voie: +m[3], min: +m[4], max: +m[5] }); return;
      }
      if ((m = l.match(/^set\s+([a-z0-9_]+)\s*=\s*(.*)$/))) {
        r.set[m[1]] = m[2].trim();
        if (groupe) groupe[profil][m[1]] = m[2].trim();
      }
    });
    return r;
  }

  // Défauts d'une vraie carte pour les réglages moteur (src/main/pg/motor.c, pg/rpm_filter.c, flight/pid.c) : la base
  // extraite du SITL n'a pas de DShot. Quelques cartes changent dshot_bidir par défaut (21 configurations sur 629).
  var DEFAUTS_CARTE = {
    motor_pwm_protocol: 'DSHOT600', dshot_bidir: 'OFF', motor_poles: '14', rpm_filter_harmonics: '3',
    rpm_filter_min_hz: '100', dyn_idle_min_rpm: '0', motor_idle: '550'
  };

  // Valeur courante : celle du diff, sinon le défaut d'une vraie carte, sinon celui du firmware (base extraite).
  function valeur(cfg, nom, db) {
    if (nom in cfg.set) return cfg.set[nom];
    if (nom in DEFAUTS_CARTE) return DEFAUTS_CARTE[nom];
    if (db && db[nom] && 'default' in db[nom]) return db[nom].default;
    return null;
  }

  // Contrôles : renvoie [{ niveau: 'alerte'|'conseil'|'ok', texte }]
  // cartes : base des cartes (cartes.js), facultative ; MCU_LIMITE : processeurs où Betaflight impose DShot300
  // et 4 kHz avec le DShot bidirectionnel (tune.js, MCU_LIMITE_BIDIR).
  var MCU_LIMITE = ['STM32F405', 'STM32F411', 'STM32G474', 'APM32F405', 'APM32F407', 'APM32F425', 'APM32F427'];

  function controler(cfg, db, drone, cartes) {
    var out = [];
    function a(niveau, texte) { out.push({ niveau: niveau, texte: texte }); }
    var proto = valeur(cfg, 'motor_pwm_protocol', db);
    var bidir = valeur(cfg, 'dshot_bidir', db);
    var carte = cartes && cfg.carte ? cartes[String(cfg.carte).toUpperCase()] : null;
    var mcu = (carte && carte.mcu) || cfg.mcu || null;
    if (cfg.carte && cartes && !carte) {
      a('conseil', tr('Carte ' + cfg.carte + ' inconnue de TrueGlide 2026.6 : vérifier qu\'un firmware existe pour elle.',
        'Board ' + cfg.carte + ' unknown to TrueGlide 2026.6: check that a firmware exists for it.'));
    }
    if (bidir === 'ON' && proto === 'DSHOT600' && mcu && MCU_LIMITE.some(function (m) { return mcu.indexOf(m.replace('STM32', '')) >= 0; })) {
      a('conseil', tr('DShot600 avec DShot bidirectionnel sur ' + mcu + ' : le firmware le remplace lui-même par DShot300 et limite la ' +
        'boucle PID à 4 kHz (ce processeur n\'est pas assez rapide pour les deux). Ce n\'est pas une panne ; mettre DShot300.',
        'DShot600 with bidirectional DShot on ' + mcu + ': the firmware replaces it with DShot300 by itself and limits the ' +
        'PID loop to 4 kHz (this processor is not fast enough for both). This is not a fault; set DShot300.'));
    }

    if (cfg.version) {
      var maj = String(cfg.version).split('.').slice(0, 2).join('.');
      if (maj !== '2026.6') {
        a('conseil', tr('Configuration issue de la version ' + cfg.version + ' : après le flash de TrueGlide (base 2026.6.2), ' +
          'refaire la configuration plutôt que coller tout le diff ; recoller seulement ports, modes, OSD et réglages connus.',
          'Configuration from version ' + cfg.version + ': after flashing TrueGlide (2026.6.2 base), ' +
          'redo the setup rather than pasting the whole diff; only paste back ports, modes, OSD and known settings.'));
      }
    }
    if (proto && !/^DSHOT/.test(proto) && proto !== 'PROSHOT1000') {
      a('alerte', tr('Protocole moteur ' + proto + ' : DSHOT300 ou DSHOT600 est recommandé avec AM32 / BLHeli_32 / BLHeli_S.',
        'Motor protocol ' + proto + ': DSHOT300 or DSHOT600 is recommended with AM32 / BLHeli_32 / BLHeli_S.'));
    }
    if (bidir !== 'ON') {
      a('conseil', tr('dshot_bidir est désactivé : avec un ESC AM32, BLHeli_32 ou Bluejay, l\'activer donne le filtre RPM, ' +
        'le ralenti dynamique et la température ESC pour la protection TrueGlide.',
        'dshot_bidir is disabled: with an AM32, BLHeli_32 or Bluejay ESC, enabling it gives the RPM filter, ' +
        'dynamic idle and ESC temperature for TrueGlide protection.'));
    } else {
      a('ok', tr('Télémétrie DShot bidirectionnelle active.', 'Bidirectional DShot telemetry active.'));
      var harm = valeur(cfg, 'rpm_filter_harmonics', db);
      if (harm === '0') a('conseil', tr('dshot_bidir est actif mais le filtre RPM est coupé (rpm_filter_harmonics = 0).',
        'dshot_bidir is enabled but the RPM filter is off (rpm_filter_harmonics = 0).'));
      var idle = Number(valeur(cfg, 'dyn_idle_min_rpm', db) || 0);
      if (drone && drone.pouces >= 6 && idle === 0) {
        a('conseil', tr('Grandes hélices sans ralenti dynamique (dyn_idle_min_rpm = 0) : risque de désynchronisation et propwash.',
          'Large props without dynamic idle (dyn_idle_min_rpm = 0): risk of desyncs and propwash.'));
      }
    }
    var poles = valeur(cfg, 'motor_poles', db);
    if (poles && poles !== '14') {
      a('conseil', tr('motor_poles = ' + poles + ' : vérifier sur la fiche du moteur (12N14 = 14 pôles). Une erreur fausse le filtre RPM.',
        'motor_poles = ' + poles + ': check the motor spec sheet (12N14 = 14 poles). A wrong value throws off the RPM filter.'));
    }
    if (valeur(cfg, 'power_guard_current', db) === '0' && valeur(cfg, 'power_guard_esc_temp', db) === '0') {
      a('conseil', tr('Protection anti-surchauffe TrueGlide inactive (power_guard_*) : la régler limite les risques de brûler moteurs et ESC.',
        'TrueGlide overheat protection inactive (power_guard_*): setting it reduces the risk of burning motors and ESCs.'));
    }
    if (bidir === 'ON' && valeur(cfg, 'motor_desync_recovery', db) !== 'ON') {
      a('conseil', tr('motor_desync_recovery est inactif : TrueGlide peut relancer un moteur désynchronisé ou calé au lieu de le laisser chauffer.',
        'motor_desync_recovery is inactive: TrueGlide can restart a desynced or stalled motor instead of letting it heat up.'));
    }
    if (bidir === 'ON' && valeur(cfg, 'dshot_telemetry_fallback', db) !== 'ON') {
      a('conseil', tr('dshot_telemetry_fallback est inactif : en cas de trames DShot perdues, la vitesse du moteur reste figée pour le filtre RPM.',
        'dshot_telemetry_fallback is inactive: when DShot frames are lost, the motor RPM stays frozen for the RPM filter.'));
    }
    var fs = valeur(cfg, 'failsafe_procedure', db);
    if (fs === 'DROP' && cfg.features.on.indexOf('GPS') >= 0) {
      a('conseil', tr('GPS présent mais failsafe en DROP : GPS-RESCUE ramène le drone en cas de perte radio.',
        'GPS present but failsafe set to DROP: GPS-RESCUE brings the quad back on radio loss.'));
    }
    if (drone && drone.pouces >= 7 && Number(valeur(cfg, 'vbat_sag_compensation', db) || 0) === 0) {
      a('conseil', tr('vbat_sag_compensation = 0 : sur un grand drone, 100 garde la même réponse jusqu\'à la fin de la batterie.',
        'vbat_sag_compensation = 0: on a large quad, 100 keeps the same response until the end of the pack.'));
    }
    // Réglages écrits dans un autre profil que celui qui vole
    [['PID', cfg.profilsPid, cfg.profil, 'profile', /^(p|i|d|f|d_max|d_min)_(roll|pitch|yaw)$/, 'PID'],
     ['de vitesses (rates)', cfg.profilsRate, cfg.profilRate, 'rateprofile', /^(roll|pitch|yaw)_(rc_rate|srate|expo)$/, 'rate']
    ].forEach(function (t) {
      var profils = t[1] || {}, actif = t[2];
      function regles(n) { return Object.keys(profils[n] || {}).filter(function (k) { return t[4].test(k); }).length; }
      var autres = Object.keys(profils).filter(function (n) { return Number(n) !== actif && regles(n) > 0; });
      if (Object.keys(profils).length > 1 && regles(actif) === 0 && autres.length) {
        a('alerte', tr('Le profil ' + t[0] + ' actif est le ' + actif + ', qui garde les valeurs d\'usine ; les valeurs réglées sont dans le profil ' +
          autres.join(', ') + '. Si ce n\'est pas voulu : « ' + t[3] + ' ' + autres[0] + ' » puis « save » (ou changer de profil dans le Configurator).',
          'The active ' + t[5] + ' profile is ' + actif + ', which keeps the factory values; the tuned values are in profile ' +
          autres.join(', ') + '. If this is not intended: "' + t[3] + ' ' + autres[0] + '" then "save" (or switch profile in the Configurator).'));
      }
    });
    var mode = valeur(cfg, 'simplified_pids_mode', db);
    if (mode === 'OFF') a('conseil', tr('PID réglés à la main (simplified_pids_mode = OFF) : le réglage TrueGlide repasse en curseurs.',
      'PIDs tuned by hand (simplified_pids_mode = OFF): the TrueGlide tune switches back to sliders.'));
    return out;
  }

  // Écart entre la configuration actuelle et une recommandation : [{ nom, actuel, propose, pourquoi }]
  function ecarts(cfg, db, reglages) {
    var out = [];
    reglages.forEach(function (r) {
      var actuel = valeur(cfg, r.nom, db);
      if (actuel === null || String(actuel).toUpperCase() !== String(r.valeur).toUpperCase()) {
        out.push({ nom: r.nom, actuel: actuel === null ? '?' : actuel, propose: r.valeur, pourquoi: r.pourquoi });
      }
    });
    return out;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Conversion d'un diff de Betaflight plus ancien (4.4, 4.5, 2025.12) vers TrueGlide (base 2026.6.2).
  // Correspondances vérifiées dans le code de chaque version (src/main/cli/settings.c, fc/parameter_names.h, pid.h).
  // ---------------------------------------------------------------------------------------------------------------
  var RENOMMES = {
    dshot_idle_value: { nom: 'motor_idle', get note() { return tr('renommé en 2025.12 (même unité : 0,01 %)', 'renamed in 2025.12 (same unit: 0.01 %)'); } },
    level_limit: { nom: 'angle_limit', borne: [10, 80], get note() { return tr('renommé en 4.5 (80° au plus depuis)', 'renamed in 4.5 (80° at most since then)'); } },
    angle_level_strength: { nom: 'angle_p_gain', get note() { return tr('renommé en 4.5 (le mode ANGLE a été revu : vérifier en vol)', 'renamed in 4.5 (ANGLE mode was reworked: check in flight)'); } },
    gps_rescue_throttle_hover: { nom: 'ap_hover_throttle', get note() { return tr('le retour GPS utilise l\'autopilote depuis 2025.12', 'GPS rescue uses the autopilot since 2025.12'); } },
    gps_rescue_throttle_min: { nom: 'ap_throttle_min', get note() { return tr('autopilote depuis 2025.12', 'autopilot since 2025.12'); } },
    gps_rescue_throttle_max: { nom: 'ap_throttle_max', get note() { return tr('autopilote depuis 2025.12', 'autopilot since 2025.12'); } },
    gps_rescue_max_angle: { nom: 'ap_max_angle', get note() { return tr('autopilote depuis 2025.12', 'autopilot since 2025.12'); } },
    gps_rescue_landing_alt: { nom: 'ap_landing_altitude_m', get note() { return tr('autopilote depuis 2025.12', 'autopilot since 2025.12'); } },
    gyro_to_use: { nom: 'gyro_enabled_bitmask', valeurs: { FIRST: '1', SECOND: '2', BOTH: '3' }, sansBorne: true,
      get note() { return tr('remplacé par un masque de gyroscopes (2 et 3 seulement sur une carte à deux gyroscopes)',
        'replaced by a gyro bitmask (2 and 3 only on a board with two gyros)'); } }
  };
  var SUPPRIMES = [
    [/^abs_control_/, 'le contrôle absolu n\'existe plus', 'absolute control no longer exists'],
    [/^gyro_[12]_(align|sensor_align|bustype|spibus|i2c_address)/, 'matériel décrit par la configuration de la carte', 'hardware described by the board configuration'],
    [/^(horizon_transition|horizon_tilt_effect|horizon_tilt_expert_mode|roll_level_expo|pitch_level_expo)$/, 'mode HORIZON / ANGLE revu en 4.5 : régler horizon_level_strength, angle_p_gain', 'HORIZON / ANGLE mode reworked in 4.5: tune horizon_level_strength, angle_p_gain'],
    [/^simplified_dmax_gain$/, 'réglage simplifié du D changé en 2025.12 : refaire avec les curseurs (TrueGlide Studio les propose)', 'simplified D tuning changed in 2025.12: redo it with the sliders (TrueGlide Studio suggests them)'],
    [/^min_throttle$/, 'protocoles analogiques : régler motor_idle', 'analog protocols: set motor_idle'],
    [/^(expresslrs_rate_index|expresslrs_switch_mode)$/, 'se règlent dans le récepteur (script Lua ELRS)', 'set in the receiver (ELRS Lua script)'],
    [/^gps_rescue_/, 'le retour GPS utilise l\'autopilote (réglages ap_*) depuis 2025.12', 'GPS rescue uses the autopilot (ap_* settings) since 2025.12'],
    [/^(iterm_limit|transient_throttle_limit|failsafe_off_delay|rc_smoothing_feedforward_cutoff|crashflip_expo|osd_gps_sats_show_hdop|gps_ublox_mode|pos_hold_without_mag|dyn_idle_start_increase)$/, 'supprimé du firmware', 'removed from the firmware']
  ];
  var GARDER = /^(feature|serial|aux|adjrange|rxrange|vtxtable|vtx|beacon|map|led|color|mode_color|mmix|smix|servo|beeper|profile|rateprofile|batch|board_name|manufacturer_id|mcu_id|signature|resource|timer|dma|osd_custom|waypoint)\b/;

  function versionMajeure(v) {
    var m = String(v || '').match(/^(\d+)\.(\d+)/);
    return m ? Number(m[1]) * 100 + Number(m[2]) : null;    // 4.4 -> 404, 2025.12 -> 202512
  }

  // Avant 2025.12 : d_X = D maximum, d_min_X = D de base. Depuis : d_X = D de base, d_max_X = D maximum.
  function dAvantInversion(version) {
    var v = versionMajeure(version);
    return v !== null && v < 202512;
  }

  function migrer(texte, db) {
    var cfg = lire(texte);
    var ancienD = dAvantInversion(cfg.version);
    var sortie = [], traduits = [], retires = [], invalides = [], autres = 0;
    function valide(nom, valeur) {
      var d = db[nom];
      if (!d) return tr('réglage inconnu de TrueGlide', 'setting unknown to TrueGlide');
      if ('min' in d) {
        var n = Number(valeur);
        if (!Number.isFinite(n) || n < d.min || n > d.max) return tr('valeur ', 'value ') + valeur + tr(' hors de ', ' outside ') + d.min + '..' + d.max;
      } else if (d.values && d.values.indexOf(String(valeur).toUpperCase()) < 0) {
        return tr('valeur ', 'value ') + valeur + tr(' non permise (', ' not allowed (') + d.values.join(', ') + ')';
      }
      return null;
    }
    String(texte || '').split(/\r?\n/).forEach(function (ligne) {
      var l = ligne.trim();
      if (!l || l[0] === '#' || /^(save|defaults|diff|dump|exit)\b/.test(l)) return;
      var m = l.match(/^set\s+([a-z0-9_]+)\s*=\s*(.*)$/);
      if (!m) {
        if (GARDER.test(l)) { sortie.push(l); autres++; }
        else retires.push({ nom: l.split(/\s+/)[0], raison: tr('commande inconnue de TrueGlide', 'command unknown to TrueGlide') });
        return;
      }
      var nom = m[1], valeur = m[2].trim(), nouveau = nom, note = null;
      var dm = nom.match(/^d_(min_)?(roll|pitch|yaw)$/);
      if (ancienD && dm) {
        nouveau = dm[1] ? 'd_' + dm[2] : 'd_max_' + dm[2];
        note = dm[1] ? tr('D de base : s\'appelait d_min avant 2025.12', 'Base D: was called d_min before 2025.12') :
          tr('D maximum : s\'appelait d avant 2025.12', 'Maximum D: was called d before 2025.12');
      } else if (RENOMMES[nom]) {
        nouveau = RENOMMES[nom].nom;
        note = RENOMMES[nom].note;
        if (RENOMMES[nom].valeurs) valeur = RENOMMES[nom].valeurs[valeur.toUpperCase()] || valeur;
        var b = RENOMMES[nom].borne;
        if (b && Number(valeur) > b[1]) { note += tr(' : ', ': ') + valeur + tr(' ramené à ', ' clamped to ') + b[1]; valeur = String(b[1]); }
        if (b && Number(valeur) < b[0]) { note += tr(' : ', ': ') + valeur + tr(' ramené à ', ' clamped to ') + b[0]; valeur = String(b[0]); }
      } else if (!db[nom]) {
        var raison = tr('n\'existe plus dans TrueGlide 2026.6', 'no longer exists in TrueGlide 2026.6');
        SUPPRIMES.some(function (s) { if (s[0].test(nom)) { raison = tr(s[1], s[2]); return true; } return false; });
        retires.push({ nom: nom, valeur: valeur, raison: raison });
        return;
      }
      var erreur = RENOMMES[nom] && RENOMMES[nom].sansBorne ? null : valide(nouveau, valeur);
      if (erreur) { invalides.push({ nom: nouveau, ancien: nom, valeur: valeur, raison: erreur }); return; }
      if (note) traduits.push({ ancien: nom, nom: nouveau, valeur: valeur, note: note });
      sortie.push('set ' + nouveau + ' = ' + valeur);
    });
    return { version: cfg.version, carte: cfg.carte, inversionD: ancienD, lignes: sortie, traduits: traduits,
      retires: retires, invalides: invalides, autres: autres };
  }

  var API = { DEFAUTS_CARTE: DEFAUTS_CARTE, RENOMMES: RENOMMES, migrer: migrer, dAvantInversion: dAvantInversion, lire: lire, valeur: valeur, controler: controler, ecarts: ecarts,
    langue: function (l) { LANGUE = (l === 'en') ? 'en' : 'fr'; } };
  if (typeof module !== 'undefined') module.exports = API; else root.TFAnalyse = API;
})(this);
