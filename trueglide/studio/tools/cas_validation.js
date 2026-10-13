// Produit, en JSON, des cas de réglage et une mission pour tools/valider_sitl.py
const T = require('../js/tune.js'), N = require('../js/nav.js');
const cas = [];
const drones = [
  { pouces: 3, kv: 2800, cellules: 4, masse: 300, style: 'speeder', speeder: { angle: 60, vitesse: 30, mix: true } },
  { pouces: 5, kv: 1950, cellules: 6, masse: 700, style: 'freestyle' },
  { pouces: 7, kv: 1300, cellules: 6, masse: 1300, style: 'longue_portee', capteurCourant: true, courantEsc: 45 },
  { pouces: 10, kv: 925, cellules: 6, masse: 1550, style: 'cinema' },
  { pouces: 13, kv: 500, cellules: 8, masse: 4000, style: 'cinema' },
  { pouces: 15, kv: 400, cellules: 12, masse: 8000, style: 'course' }
];
// 34 drones tirés au hasard (graine fixe) en plus des cas typiques
let graine = 12345;
const hasard = () => (graine = (graine * 1103515245 + 12345) % 2147483648) / 2147483648;
const styles = Object.keys(T.STYLES);
for (let i = 0; i < 34; i++) {
  const pouces = Math.round((2 + hasard() * 13) * 2) / 2;
  drones.push({ pouces, kv: Math.round(300 + hasard() * 3500), cellules: 2 + Math.floor(hasard() * 11),
    masse: Math.round(150 + hasard() * 7000), style: styles[Math.floor(hasard() * styles.length)],
    qualite: ['bruyant', 'normal', 'rigide'][Math.floor(hasard() * 3)] });
}
for (const d of drones) {
  const r = T.recommander({ qualite: 'normal', pwmEsc: 48, bidir: true, ...d });
  cas.push({ nom: d.pouces + '" ' + d.style, cli: T.versCli(r).split('\n').filter(l => !l.startsWith('#') && l !== 'save'), pids: r.pids });
}
const m = N.genererMission({ altitudeSolAmsl: 152.4, points: [
  { lat: 46.2044, lon: 6.1432, hauteur: 30, vitesse: 5, type: 'FLYOVER', duree: 0 },
  { lat: -33.5429890, lon: 151.6664560, hauteur: 40, vitesse: 8, type: 'HOLD', duree: 12.5, motif: 'ORBIT' },
  { lat: 46.2044, lon: -6.1432, hauteur: 0, vitesse: 3, type: 'LAND', duree: 0 }] });
const reg = N.genererReglages({ vitesseMax: 12, angleMax: 45, rayonArrivee: 4, retourAlt: 50, vitesseRetour: 10,
  satellitesMin: 10, failsafeGps: true, barriereM: 800, actionBarriere: 'RTH', perteRadio: 'CONTINUE' });
console.log(JSON.stringify({ cas, mission: m.lignes, nav: reg.map(r => 'set ' + r.nom + ' = ' + r.valeur) }));
