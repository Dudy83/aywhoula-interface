/**
 * Bouées du réseau CANDHIS (Cerema) qui émettent en temps réel : code de
 * campagne, nom, latitude, longitude.
 *
 * Relevé le 12 novembre 2026 sur la carte publique de candhis.cerema.fr
 * (données sous Licence Ouverte Etalab). La liste bouge peu ; elle est à
 * rafraîchir quand une bouée est mise en service ou retirée.
 */
export const CANDHIS_STATIONS: [code: string, name: string, lat: number, lon: number][] = [
  ['01101', 'Leucate', 42.9167, 3.125],
  ['01102', 'Port-la-Nouvelle', 43.0097, 3.0861],
  ['01305', 'Le Planier', 43.2083, 5.23],
  ['01705', 'Royan', 45.61, -1.0317],
  ['02911', 'Les Pierres Noires', 48.2903, -4.9683],
  ['02922', 'Île de Batz', 48.7283, -4.0717],
  ['02A01', 'Bonifacio', 41.3226, 8.8775],
  ['02B04', 'La Revellata', 42.5692, 8.65],
  ['02B05', 'Alistro', 42.2617, 9.6433],
  ['03001', 'Espiguette', 43.411, 4.1625],
  ['03302', 'Cap Ferret', 44.6525, -1.4467],
  ['03404', 'Sète', 43.3713, 3.7771],
  ['04403', 'Plateau du Four', 47.2398, -2.7805],
  ['05008', 'Cherbourg', 49.6941, -1.6214],
  ['05602', 'Belle-Île', 47.285, -3.285],
  ['06402', 'Anglet', 43.5322, -1.615],
  ['06403', 'Saint-Jean-de-Luz', 43.4083, -1.6817],
  ['07609', 'Le Havre', 49.475, 0.0842],
  ['08002', 'Baie de Somme', 50.25, 1.3353],
  ['08302', 'Porquerolles', 42.9667, 6.2048],
  ['08303', 'Cap Roux', 43.4652, 6.9351],
  ['08504', 'Île d’Yeu Nord', 46.8332, -2.295],
  ['08505', 'Noirmoutier', 46.9238, -2.4679],
  ['97107', 'La Vigie (Guadeloupe)', 16.5167, -61.4167],
  ['97202', 'Basse-Pointe (Martinique)', 14.8905, -61.1146],
  ['97204', 'Fort-de-France (Martinique)', 14.5482, -61.0972],
  ['97205', 'Sainte-Lucie', 14.1763, -60.9345],
  ['97304', 'Île de Cayenne (Guyane)', 4.9472, -51.9983],
  ['97501', 'Saint-Pierre-et-Miquelon', 46.7037, -56.1879],
  ['97601', 'Récif Nord (Mayotte)', -12.5495, 45.0668],
  ['98000', 'Monaco', 43.7136, 7.4262],
];
