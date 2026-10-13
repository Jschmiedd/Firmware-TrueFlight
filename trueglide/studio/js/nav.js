// TrueGlide Studio : préparation d'une mission GPS et des réglages de navigation de Betaflight 2026.6
// TrueGlide - Copyright (C) 2026 TalkTrueFPV. Derived from Betaflight.
// Free software under the GPL-3.0 license, WITHOUT ANY WARRANTY; see the LICENSE file.
// (mode AUTOPILOT, POS HOLD, ALTHOLD, GPS RESCUE). Produit les commandes CLI « waypoint » exactes du firmware :
//   waypoint insert <index> <lat.ddddddd> <lon.ddddddd> <altitude cm AMSL> <vitesse cm/s> <TYPE> <durée 0,1 s> <MOTIF>
(function (root) {
  'use strict';

  // Langue des textes produits ('fr' par défaut, 'en') : évaluée à chaque appel, jamais au chargement.
  var LANGUE = 'fr';
  function tr(fr, en) { return LANGUE === 'en' ? en : fr; }

  var MAX_WAYPOINTS = 30;   // src/main/pg/flight_plan.h
  var TYPES = ['FLYOVER', 'FLYBY', 'HOLD', 'LAND', 'TAKEOFF'];
  var MOTIFS = ['NONE', 'ORBIT', 'FIGURE8'];
  var NOMS_TYPES = {
    get FLYOVER() { return tr('Passer au-dessus', 'Fly over'); },
    get FLYBY() { return tr('Passer à côté (virage anticipé)', 'Fly by (early turn)'); },
    get HOLD() { return tr('Attendre', 'Hold'); },
    get LAND() { return tr('Atterrir', 'Land'); },
    get TAKEOFF() { return tr('Décoller', 'Take off'); }
  };

  function rad(d) { return d * Math.PI / 180; }

  // Distance en mètres entre deux points GPS (formule de haversine, Terre sphérique de 6 371 km).
  function distance(a, b) {
    var R = 6371000, dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function coord(v) { return (v < 0 ? '-' : '') + Math.abs(v).toFixed(7); }

  // mission : { altitudeSolAmsl (m), depart: {lat, lon} (optionnel), points: [{ lat, lon, hauteur (m au-dessus du
  //             départ), vitesse (m/s), type, duree (s), motif }] }
  function genererMission(mission) {
    var erreurs = [], avert = [], lignes = ['waypoint clear'];
    var pts = mission.points || [];
    if (!(typeof mission.altitudeSolAmsl === 'number' && isFinite(mission.altitudeSolAmsl))) {
      erreurs.push(tr('Altitude du terrain (mètres au-dessus du niveau de la mer) obligatoire : le firmware travaille en altitude AMSL.',
        'Ground altitude (meters above sea level) required: the firmware works with AMSL altitude.'));
    }
    if (pts.length === 0) erreurs.push(tr('Aucun point.', 'No waypoints.'));
    if (pts.length > MAX_WAYPOINTS) erreurs.push(tr('Au plus ' + MAX_WAYPOINTS + ' points (limite du firmware).', 'At most ' + MAX_WAYPOINTS + ' waypoints (firmware limit).'));
    var total = 0, temps = 0, precedent = mission.depart || null;
    pts.forEach(function (p, i) {
      var n = tr('Point ' + (i + 1) + ' : ', 'Waypoint ' + (i + 1) + ': ');
      if (!(p.lat >= -90 && p.lat <= 90)) erreurs.push(n + tr('latitude invalide', 'invalid latitude'));
      if (!(p.lon >= -180 && p.lon <= 180)) erreurs.push(n + tr('longitude invalide', 'invalid longitude'));
      if (TYPES.indexOf(p.type) < 0) erreurs.push(n + tr('type inconnu', 'unknown type'));
      if (MOTIFS.indexOf(p.motif || 'NONE') < 0) erreurs.push(n + tr('motif inconnu', 'unknown pattern'));
      var vit = Math.round((p.vitesse || 0) * 100);
      if (vit < 0 || vit > 65535) erreurs.push(n + tr('vitesse hors limites', 'speed out of range'));
      var duree = Math.round((p.duree || 0) * 10);
      if (duree < 0 || duree > 65535) erreurs.push(n + tr('durée hors limites', 'duration out of range'));
      if (p.type !== 'LAND' && p.type !== 'TAKEOFF' && (p.hauteur || 0) < 5) {
        avert.push(n + tr('moins de 5 m au-dessus du départ : le firmware monte d\'abord à ap_min_nav_altitude_m (5 m par défaut).',
          'less than 5 m above home: the firmware first climbs to ap_min_nav_altitude_m (5 m by default).'));
      }
      var alt = Math.round(((mission.altitudeSolAmsl || 0) + (p.hauteur || 0)) * 100);
      lignes.push(['waypoint insert', i, coord(p.lat), coord(p.lon), alt, vit, p.type, duree, p.motif || 'NONE'].join(' '));
      if (precedent) {
        var d = distance(precedent, p);
        total += d;
        if (d > 2000) avert.push(n + tr('tronçon de ' + Math.round(d) + ' m : vérifier la portée radio et vidéo.', 'leg of ' + Math.round(d) + ' m: check radio and video range.'));
        if (vit > 0) temps += d / (vit / 100);
      }
      temps += duree / 10;
      precedent = p;
    });
    return {
      erreurs: erreurs, avertissements: avert, lignes: erreurs.length ? [] : lignes,
      distanceTotaleM: Math.round(total), dureeEstimeeS: Math.round(temps)
    };
  }

  // reglages : { vitesseMax (m/s), angleMax (°), rayonArrivee (m), retourAlt (m), vitesseRetour (m/s), satellitesMin,
  //              failsafeGps (bool), barriereM (0 = sans), actionBarriere ('LAND'|'RTH'), perteRadio ('DISABLE'|'CONTINUE'|'LAND') }
  function genererReglages(r) {
    var s = [];
    function set(nom, valeur, pourquoi) { s.push({ nom: nom, valeur: String(valeur), pourquoi: pourquoi || '' }); }
    if (r.vitesseMax) set('ap_max_velocity', Math.round(r.vitesseMax * 100), tr('Vitesse maximale en navigation (cm/s).', 'Maximum navigation speed (cm/s).'));
    if (r.angleMax) set('ap_max_angle', Math.round(r.angleMax), tr('Inclinaison maximale permise à l\'autopilote.', 'Maximum tilt allowed for the autopilot.'));
    if (r.rayonArrivee) set('ap_waypoint_arrival_radius', Math.round(r.rayonArrivee * 100), tr('Point atteint à moins de cette distance (cm).', 'Waypoint reached within this distance (cm).'));
    if (r.retourAlt) set('gps_rescue_return_alt', Math.round(r.retourAlt), tr('Altitude de retour au départ (m).', 'Return-to-home altitude (m).'));
    if (r.vitesseRetour) set('gps_rescue_ground_speed', Math.round(r.vitesseRetour * 100), tr('Vitesse de retour (cm/s).', 'Return speed (cm/s).'));
    if (r.satellitesMin) set('gps_rescue_min_sats', Math.round(r.satellitesMin), tr('Satellites minimum pour autoriser le retour.', 'Minimum satellites to allow the return.'));
    if (r.failsafeGps) set('failsafe_procedure', 'GPS-RESCUE', tr('Perte radio : retour automatique au point de départ.', 'Radio loss: automatic return to home.'));
    if (r.barriereM !== undefined && r.barriereM !== null) {
      set('ap_max_distance_from_home', Math.round(r.barriereM), tr('Barrière virtuelle (m, 0 = sans).', 'Geofence (m, 0 = none).'));
      if (r.barriereM > 0 && r.actionBarriere) set('ap_geofence_action', r.actionBarriere, tr('Action au franchissement de la barrière.', 'Action when crossing the geofence.'));
    }
    if (r.perteRadio) set('ap_rx_loss_policy', r.perteRadio, tr('Comportement de la mission si la radio est perdue.', 'Mission behaviour if the radio link is lost.'));
    return s;
  }

  function versCli(mission, reglages) {
    var l = [tr('# TrueGlide Studio : mission GPS', '# TrueGlide Studio: GPS mission'),
      tr('# Modes à placer sur des interrupteurs (onglet Modes) : AUTOPILOT, POS HOLD, ALTHOLD, GPS RESCUE',
        '# Modes to assign to switches (Modes tab): AUTOPILOT, POS HOLD, ALTHOLD, GPS RESCUE')];
    reglages.forEach(function (r) { l.push('set ' + r.nom + ' = ' + r.valeur); });
    return l.concat(mission.lignes, ['save']).join('\n');
  }

  var API = { MAX_WAYPOINTS: MAX_WAYPOINTS, TYPES: TYPES, MOTIFS: MOTIFS, NOMS_TYPES: NOMS_TYPES, distance: distance,
    genererMission: genererMission, genererReglages: genererReglages, versCli: versCli,
    langue: function (l) { LANGUE = (l === 'en') ? 'en' : 'fr'; } };
  if (typeof module !== 'undefined') module.exports = API; else root.TFNav = API;
})(this);
