// ─── Mock Database for Raahi Safety Engine ──────────────────────────────────
// Stores police stations, hospitals, fire stations scattered along scored routes.
// The DB GROWS over time — every route scored generates new police stations
// along its corridor, which are permanently stored in the runtime cache.
//
// HOW IT WORKS:
//   1. Static seed = real police stations in major Indian cities
//   2. When scoreRoute() runs, generateSafeZonesAlongRoute(coords) is called
//   3. It sprinkles random police stations every ~800m-1.5km along the route
//   4. They're added to the runtime store (deduplicated by proximity)
//   5. countSafeZonesNearby() then counts ALL zones (seed + generated)
//
// The more routes you score, the more police stations exist in the DB.

export interface MockSafeZone {
  id: string;
  name: string;
  type: "police_station" | "hospital" | "fire_station" | "bus_stand" | "railway_station";
  lat: number;
  lng: number;
  hours: string;
  city: string;
  state: string;
  generated: boolean; // true = dynamically generated, false = seed data
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEED DATA — Real police stations, hospitals, fire stations across India
// ═══════════════════════════════════════════════════════════════════════════════

const SEED_SAFE_ZONES: MockSafeZone[] = [
  // ── Patna, Bihar ──────────────────────────────────────────────────────────
  { id: "ps-pat-01", name: "Kotwali Police Station, Patna",         type: "police_station", lat: 25.6115, lng: 85.1440, hours: "24/7", city: "Patna", state: "Bihar", generated: false },
  { id: "ps-pat-02", name: "Gandhi Maidan Police Station",          type: "police_station", lat: 25.6120, lng: 85.1350, hours: "24/7", city: "Patna", state: "Bihar", generated: false },
  { id: "ps-pat-03", name: "Patna City Police Station",             type: "police_station", lat: 25.6030, lng: 85.1780, hours: "24/7", city: "Patna", state: "Bihar", generated: false },
  { id: "ps-pat-04", name: "Kankarbagh Police Station",             type: "police_station", lat: 25.5920, lng: 85.1270, hours: "24/7", city: "Patna", state: "Bihar", generated: false },
  { id: "ps-pat-05", name: "Shastri Nagar Police Station",          type: "police_station", lat: 25.6250, lng: 85.1180, hours: "24/7", city: "Patna", state: "Bihar", generated: false },
  { id: "ps-pat-06", name: "Boring Road Police Station",            type: "police_station", lat: 25.6050, lng: 85.1190, hours: "24/7", city: "Patna", state: "Bihar", generated: false },
  { id: "ps-pat-07", name: "Sultanganj Police Station",             type: "police_station", lat: 25.6170, lng: 85.1560, hours: "24/7", city: "Patna", state: "Bihar", generated: false },
  { id: "ps-pat-08", name: "Pirbahore Police Station",              type: "police_station", lat: 25.6070, lng: 85.1640, hours: "24/7", city: "Patna", state: "Bihar", generated: false },
  { id: "ps-pat-09", name: "Kadamkuan Police Station",              type: "police_station", lat: 25.6060, lng: 85.1530, hours: "24/7", city: "Patna", state: "Bihar", generated: false },
  { id: "ps-pat-10", name: "Agamkuan Police Station",               type: "police_station", lat: 25.6000, lng: 85.1680, hours: "24/7", city: "Patna", state: "Bihar", generated: false },
  { id: "hp-pat-01", name: "Patna Medical College Hospital",        type: "hospital",       lat: 25.6138, lng: 85.1470, hours: "24/7", city: "Patna", state: "Bihar", generated: false },
  { id: "hp-pat-02", name: "AIIMS Patna",                           type: "hospital",       lat: 25.5735, lng: 85.0910, hours: "24/7", city: "Patna", state: "Bihar", generated: false },
  { id: "hp-pat-03", name: "Nalanda Medical College Hospital",      type: "hospital",       lat: 25.6100, lng: 85.1480, hours: "24/7", city: "Patna", state: "Bihar", generated: false },
  { id: "fs-pat-01", name: "Patna Fire Station, Fraser Road",       type: "fire_station",   lat: 25.6100, lng: 85.1390, hours: "24/7", city: "Patna", state: "Bihar", generated: false },
  { id: "rs-pat-01", name: "Patna Junction Railway Station",        type: "railway_station", lat: 25.6093, lng: 85.1376, hours: "24/7", city: "Patna", state: "Bihar", generated: false },
  { id: "bs-pat-01", name: "Mithapur Bus Stand",                    type: "bus_stand",      lat: 25.6130, lng: 85.1320, hours: "06:00-22:00", city: "Patna", state: "Bihar", generated: false },

  // ── Gaya, Bihar ───────────────────────────────────────────────────────────
  { id: "ps-gay-01", name: "Gaya Town Police Station",              type: "police_station", lat: 24.7955, lng: 84.9994, hours: "24/7", city: "Gaya", state: "Bihar", generated: false },
  { id: "ps-gay-02", name: "Bodh Gaya Police Station",              type: "police_station", lat: 24.6961, lng: 84.9869, hours: "24/7", city: "Gaya", state: "Bihar", generated: false },
  { id: "ps-gay-03", name: "Manpur Police Station",                 type: "police_station", lat: 24.8050, lng: 84.9800, hours: "24/7", city: "Gaya", state: "Bihar", generated: false },
  { id: "hp-gay-01", name: "Magadh Medical College Hospital",       type: "hospital",       lat: 24.7910, lng: 85.0020, hours: "24/7", city: "Gaya", state: "Bihar", generated: false },

  // ── Muzaffarpur, Bihar ────────────────────────────────────────────────────
  { id: "ps-muz-01", name: "Muzaffarpur Town Police Station",       type: "police_station", lat: 26.1209, lng: 85.3647, hours: "24/7", city: "Muzaffarpur", state: "Bihar", generated: false },
  { id: "ps-muz-02", name: "Sadar Police Station, Muzaffarpur",     type: "police_station", lat: 26.1150, lng: 85.3750, hours: "24/7", city: "Muzaffarpur", state: "Bihar", generated: false },
  { id: "hp-muz-01", name: "SKMCH Muzaffarpur",                     type: "hospital",       lat: 26.1180, lng: 85.3700, hours: "24/7", city: "Muzaffarpur", state: "Bihar", generated: false },

  // ── Bhagalpur, Bihar ──────────────────────────────────────────────────────
  { id: "ps-bhg-01", name: "Bhagalpur Town Police Station",         type: "police_station", lat: 25.2425, lng: 86.9842, hours: "24/7", city: "Bhagalpur", state: "Bihar", generated: false },
  { id: "ps-bhg-02", name: "Nathnagar Police Station",              type: "police_station", lat: 25.2500, lng: 86.9700, hours: "24/7", city: "Bhagalpur", state: "Bihar", generated: false },
  { id: "hp-bhg-01", name: "JLNMCH Bhagalpur",                     type: "hospital",       lat: 25.2450, lng: 86.9900, hours: "24/7", city: "Bhagalpur", state: "Bihar", generated: false },

  // ── Darbhanga, Bihar ──────────────────────────────────────────────────────
  { id: "ps-dar-01", name: "Darbhanga Town Police Station",         type: "police_station", lat: 26.1542, lng: 85.8918, hours: "24/7", city: "Darbhanga", state: "Bihar", generated: false },
  { id: "hp-dar-01", name: "DMCH Darbhanga",                        type: "hospital",       lat: 26.1580, lng: 85.8960, hours: "24/7", city: "Darbhanga", state: "Bihar", generated: false },

  // ── Delhi ─────────────────────────────────────────────────────────────────
  { id: "ps-del-01", name: "Connaught Place Police Station",        type: "police_station", lat: 28.6315, lng: 77.2167, hours: "24/7", city: "New Delhi", state: "Delhi", generated: false },
  { id: "ps-del-02", name: "India Gate Police Post",                type: "police_station", lat: 28.6129, lng: 77.2295, hours: "24/7", city: "New Delhi", state: "Delhi", generated: false },
  { id: "ps-del-03", name: "Karol Bagh Police Station",             type: "police_station", lat: 28.6519, lng: 77.1907, hours: "24/7", city: "New Delhi", state: "Delhi", generated: false },
  { id: "ps-del-04", name: "Sarojini Nagar Police Station",         type: "police_station", lat: 28.5779, lng: 77.2010, hours: "24/7", city: "New Delhi", state: "Delhi", generated: false },
  { id: "ps-del-05", name: "Hauz Khas Police Station",              type: "police_station", lat: 28.5494, lng: 77.2001, hours: "24/7", city: "New Delhi", state: "Delhi", generated: false },
  { id: "ps-del-06", name: "Lajpat Nagar Police Station",           type: "police_station", lat: 28.5700, lng: 77.2400, hours: "24/7", city: "New Delhi", state: "Delhi", generated: false },
  { id: "ps-del-07", name: "Paharganj Police Station",              type: "police_station", lat: 28.6440, lng: 77.2120, hours: "24/7", city: "New Delhi", state: "Delhi", generated: false },
  { id: "hp-del-01", name: "AIIMS New Delhi",                       type: "hospital",       lat: 28.5672, lng: 77.2100, hours: "24/7", city: "New Delhi", state: "Delhi", generated: false },
  { id: "hp-del-02", name: "Safdarjung Hospital",                   type: "hospital",       lat: 28.5681, lng: 77.2066, hours: "24/7", city: "New Delhi", state: "Delhi", generated: false },
  { id: "rs-del-01", name: "New Delhi Railway Station",              type: "railway_station", lat: 28.6431, lng: 77.2197, hours: "24/7", city: "New Delhi", state: "Delhi", generated: false },

  // ── Mumbai, Maharashtra ───────────────────────────────────────────────────
  { id: "ps-mum-01", name: "Colaba Police Station",                 type: "police_station", lat: 18.9067, lng: 72.8147, hours: "24/7", city: "Mumbai", state: "Maharashtra", generated: false },
  { id: "ps-mum-02", name: "Bandra Police Station",                 type: "police_station", lat: 19.0544, lng: 72.8401, hours: "24/7", city: "Mumbai", state: "Maharashtra", generated: false },
  { id: "ps-mum-03", name: "Andheri Police Station",                type: "police_station", lat: 19.1197, lng: 72.8464, hours: "24/7", city: "Mumbai", state: "Maharashtra", generated: false },
  { id: "ps-mum-04", name: "Dadar Police Station",                  type: "police_station", lat: 19.0178, lng: 72.8478, hours: "24/7", city: "Mumbai", state: "Maharashtra", generated: false },
  { id: "ps-mum-05", name: "Kurla Police Station",                  type: "police_station", lat: 19.0726, lng: 72.8790, hours: "24/7", city: "Mumbai", state: "Maharashtra", generated: false },
  { id: "hp-mum-01", name: "KEM Hospital, Parel",                   type: "hospital",       lat: 19.0003, lng: 72.8421, hours: "24/7", city: "Mumbai", state: "Maharashtra", generated: false },
  { id: "rs-mum-01", name: "Mumbai CST",                            type: "railway_station", lat: 18.9398, lng: 72.8354, hours: "24/7", city: "Mumbai", state: "Maharashtra", generated: false },

  // ── Pune, Maharashtra ─────────────────────────────────────────────────────
  { id: "ps-pun-01", name: "Shivajinagar Police Station, Pune",     type: "police_station", lat: 18.5314, lng: 73.8446, hours: "24/7", city: "Pune", state: "Maharashtra", generated: false },
  { id: "ps-pun-02", name: "Koregaon Park Police Station",          type: "police_station", lat: 18.5362, lng: 73.8937, hours: "24/7", city: "Pune", state: "Maharashtra", generated: false },
  { id: "ps-pun-03", name: "Kothrud Police Station",                type: "police_station", lat: 18.5074, lng: 73.8077, hours: "24/7", city: "Pune", state: "Maharashtra", generated: false },
  { id: "ps-pun-04", name: "Deccan Police Station, Pune",           type: "police_station", lat: 18.5196, lng: 73.8400, hours: "24/7", city: "Pune", state: "Maharashtra", generated: false },
  { id: "hp-pun-01", name: "Sassoon Hospital, Pune",                type: "hospital",       lat: 18.5233, lng: 73.8553, hours: "24/7", city: "Pune", state: "Maharashtra", generated: false },

  // ── Bengaluru, Karnataka ──────────────────────────────────────────────────
  { id: "ps-blr-01", name: "Cubbon Park Police Station",            type: "police_station", lat: 12.9763, lng: 77.5929, hours: "24/7", city: "Bengaluru", state: "Karnataka", generated: false },
  { id: "ps-blr-02", name: "Koramangala Police Station",            type: "police_station", lat: 12.9352, lng: 77.6245, hours: "24/7", city: "Bengaluru", state: "Karnataka", generated: false },
  { id: "ps-blr-03", name: "Indiranagar Police Station",            type: "police_station", lat: 12.9719, lng: 77.6412, hours: "24/7", city: "Bengaluru", state: "Karnataka", generated: false },
  { id: "ps-blr-04", name: "Whitefield Police Station",             type: "police_station", lat: 12.9698, lng: 77.7500, hours: "24/7", city: "Bengaluru", state: "Karnataka", generated: false },
  { id: "ps-blr-05", name: "HSR Layout Police Station",             type: "police_station", lat: 12.9116, lng: 77.6389, hours: "24/7", city: "Bengaluru", state: "Karnataka", generated: false },
  { id: "hp-blr-01", name: "Victoria Hospital, Bengaluru",          type: "hospital",       lat: 12.9568, lng: 77.5728, hours: "24/7", city: "Bengaluru", state: "Karnataka", generated: false },

  // ── Chennai, Tamil Nadu ───────────────────────────────────────────────────
  { id: "ps-chn-01", name: "Mylapore Police Station",               type: "police_station", lat: 13.0368, lng: 80.2676, hours: "24/7", city: "Chennai", state: "Tamil Nadu", generated: false },
  { id: "ps-chn-02", name: "T. Nagar Police Station",               type: "police_station", lat: 13.0418, lng: 80.2341, hours: "24/7", city: "Chennai", state: "Tamil Nadu", generated: false },
  { id: "ps-chn-03", name: "Adyar Police Station",                  type: "police_station", lat: 13.0067, lng: 80.2565, hours: "24/7", city: "Chennai", state: "Tamil Nadu", generated: false },
  { id: "hp-chn-01", name: "Government General Hospital, Chennai",  type: "hospital",       lat: 13.0786, lng: 80.2752, hours: "24/7", city: "Chennai", state: "Tamil Nadu", generated: false },

  // ── Kolkata, West Bengal ──────────────────────────────────────────────────
  { id: "ps-kol-01", name: "Park Street Police Station",            type: "police_station", lat: 22.5536, lng: 88.3519, hours: "24/7", city: "Kolkata", state: "West Bengal", generated: false },
  { id: "ps-kol-02", name: "New Market Police Station",             type: "police_station", lat: 22.5626, lng: 88.3507, hours: "24/7", city: "Kolkata", state: "West Bengal", generated: false },
  { id: "ps-kol-03", name: "Salt Lake Police Station",              type: "police_station", lat: 22.5800, lng: 88.4130, hours: "24/7", city: "Kolkata", state: "West Bengal", generated: false },
  { id: "hp-kol-01", name: "SSKM Hospital, Kolkata",                type: "hospital",       lat: 22.5440, lng: 88.3393, hours: "24/7", city: "Kolkata", state: "West Bengal", generated: false },

  // ── Hyderabad, Telangana ──────────────────────────────────────────────────
  { id: "ps-hyd-01", name: "Banjara Hills Police Station",          type: "police_station", lat: 17.4156, lng: 78.4347, hours: "24/7", city: "Hyderabad", state: "Telangana", generated: false },
  { id: "ps-hyd-02", name: "Jubilee Hills Police Station",          type: "police_station", lat: 17.4325, lng: 78.4073, hours: "24/7", city: "Hyderabad", state: "Telangana", generated: false },
  { id: "ps-hyd-03", name: "Secunderabad Police Station",           type: "police_station", lat: 17.4399, lng: 78.4983, hours: "24/7", city: "Hyderabad", state: "Telangana", generated: false },
  { id: "hp-hyd-01", name: "Osmania General Hospital",              type: "hospital",       lat: 17.3616, lng: 78.4747, hours: "24/7", city: "Hyderabad", state: "Telangana", generated: false },

  // ── Jaipur, Rajasthan ─────────────────────────────────────────────────────
  { id: "ps-jai-01", name: "Hawa Mahal Police Station, Jaipur",     type: "police_station", lat: 26.9239, lng: 75.8267, hours: "24/7", city: "Jaipur", state: "Rajasthan", generated: false },
  { id: "ps-jai-02", name: "MI Road Police Station",                type: "police_station", lat: 26.9100, lng: 75.7900, hours: "24/7", city: "Jaipur", state: "Rajasthan", generated: false },
  { id: "hp-jai-01", name: "SMS Hospital, Jaipur",                  type: "hospital",       lat: 26.8986, lng: 75.8092, hours: "24/7", city: "Jaipur", state: "Rajasthan", generated: false },

  // ── Lucknow, Uttar Pradesh ────────────────────────────────────────────────
  { id: "ps-lkn-01", name: "Hazratganj Police Station",             type: "police_station", lat: 26.8554, lng: 80.9518, hours: "24/7", city: "Lucknow", state: "Uttar Pradesh", generated: false },
  { id: "ps-lkn-02", name: "Charbagh Police Station",               type: "police_station", lat: 26.8356, lng: 80.9119, hours: "24/7", city: "Lucknow", state: "Uttar Pradesh", generated: false },
  { id: "hp-lkn-01", name: "King George Medical University",        type: "hospital",       lat: 26.8466, lng: 80.9427, hours: "24/7", city: "Lucknow", state: "Uttar Pradesh", generated: false },
  { id: "rs-lkn-01", name: "Lucknow Charbagh Railway Station",      type: "railway_station", lat: 26.8356, lng: 80.9219, hours: "24/7", city: "Lucknow", state: "Uttar Pradesh", generated: false },

  // ── Varanasi, Uttar Pradesh ───────────────────────────────────────────────
  { id: "ps-vrn-01", name: "Lanka Police Station, Varanasi",        type: "police_station", lat: 25.2677, lng: 82.9913, hours: "24/7", city: "Varanasi", state: "Uttar Pradesh", generated: false },
  { id: "ps-vrn-02", name: "Dashashwamedh Police Station",          type: "police_station", lat: 25.3109, lng: 83.0107, hours: "24/7", city: "Varanasi", state: "Uttar Pradesh", generated: false },
  { id: "hp-vrn-01", name: "BHU Hospital, Varanasi",                type: "hospital",       lat: 25.2677, lng: 82.9880, hours: "24/7", city: "Varanasi", state: "Uttar Pradesh", generated: false },

  // ── Ranchi, Jharkhand ─────────────────────────────────────────────────────
  { id: "ps-ran-01", name: "Kotwali Police Station, Ranchi",        type: "police_station", lat: 23.3441, lng: 85.3096, hours: "24/7", city: "Ranchi", state: "Jharkhand", generated: false },
  { id: "ps-ran-02", name: "Lalpur Police Station, Ranchi",         type: "police_station", lat: 23.3700, lng: 85.3200, hours: "24/7", city: "Ranchi", state: "Jharkhand", generated: false },
  { id: "hp-ran-01", name: "RIMS Ranchi",                           type: "hospital",       lat: 23.3560, lng: 85.3150, hours: "24/7", city: "Ranchi", state: "Jharkhand", generated: false },
];

// ═══════════════════════════════════════════════════════════════════════════════
// RUNTIME STORE — Grows over time as routes are scored
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// HAVERSINE DISTANCE
// ═══════════════════════════════════════════════════════════════════════════════

function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number
): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ═══════════════════════════════════════════════════════════════════════════════
// DYNAMIC GENERATION — Sprinkle police stations along route corridors
// ═══════════════════════════════════════════════════════════════════════════════

// Seeded random — deterministic for same coordinates so re-scoring same route
// doesn't create new stations
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

const POLICE_STATION_NAMES = [
  "Nagar Thana", "Chowki Police Post", "Traffic Police Station",
  "Highway Patrol Post", "City Police Station", "Town Police Station",
  "Sub-Divisional Police Station", "Outpost", "Police Chowki",
  "Women's Police Station", "Cyber Police Station", "Rural Police Post",
  "Railway Police Post", "Beat Police Chowki", "Area Police Station",
];

const SAFE_ZONE_TYPES: MockSafeZone["type"][] = [
  "police_station", "police_station", "police_station", "police_station",
  "hospital", "fire_station", // bias towards police stations (4:1:1)
];

/**
 * Generate random safe zones along a route's coordinates for THIS request.
 * Does NOT mutate global state.
 * - Sprinkles one station every ~2km to 4km along the route
 * - Offsets them 50-400m perpendicular to the route (realistic placement)
 * - Returns generated stations for this route
 */
export function generateSafeZonesAlongRoute(
  coords: [number, number][]
): MockSafeZone[] {
  if (coords.length < 4) return [];

  // Create a seed from the first and last coordinate for determinism
  const seedVal = Math.abs(
    Math.round(coords[0][0] * 10000) ^
    Math.round(coords[0][1] * 10000) ^
    Math.round(coords[coords.length - 1][0] * 10000) ^
    Math.round(coords[coords.length - 1][1] * 10000)
  );
  const rng = seededRandom(seedVal);

  const generatedZones: MockSafeZone[] = [];
  const localGrid = new Set<string>();
  let localCounter = 0;

  let distAccum = 0;
  const INTERVAL_MIN = 2500;  // meters — minimum distance between generated stations
  const INTERVAL_MAX = 5000;  // meters — maximum distance
  let nextThreshold = INTERVAL_MIN + rng() * (INTERVAL_MAX - INTERVAL_MIN);

  for (let i = 1; i < coords.length; i++) {
    const [lat1, lng1] = coords[i - 1];
    const [lat2, lng2] = coords[i];
    const segDist = haversineMeters(lat1, lng1, lat2, lng2);
    distAccum += segDist;

    if (distAccum >= nextThreshold) {
      // Interpolate position along this segment
      const t = 1 - (distAccum - nextThreshold) / segDist;
      const baseLat = lat1 + t * (lat2 - lat1);
      const baseLng = lng1 + t * (lng2 - lng1);

      // Offset perpendicular to the route by 50-400m
      const offsetM = 50 + rng() * 350;
      const angle = rng() * 2 * Math.PI;
      const dlat = (offsetM / 6371000) * (180 / Math.PI);
      const dlng = dlat / Math.cos(baseLat * Math.PI / 180);
      const stationLat = baseLat + dlat * Math.sin(angle);
      const stationLng = baseLng + dlng * Math.cos(angle);

      // Dedup: grid key at ~200m resolution
      const gridKey = `${(stationLat * 500).toFixed(0)},${(stationLng * 500).toFixed(0)}`;
      if (!localGrid.has(gridKey)) {
        localGrid.add(gridKey);
        localCounter++;

        const typeIdx = Math.floor(rng() * SAFE_ZONE_TYPES.length);
        const nameIdx = Math.floor(rng() * POLICE_STATION_NAMES.length);
        const type = SAFE_ZONE_TYPES[typeIdx];
        const baseName = type === "police_station"
          ? POLICE_STATION_NAMES[nameIdx]
          : type === "hospital"
            ? `Area Hospital #${localCounter}`
            : `Fire Station #${localCounter}`;

        const zone: MockSafeZone = {
          id: `gen-${localCounter}`,
          name: `${baseName} (Zone ${localCounter})`,
          type,
          lat: +stationLat.toFixed(6),
          lng: +stationLng.toFixed(6),
          hours: "24/7",
          city: "Route Corridor",
          state: "Generated",
          generated: true,
        };

        generatedZones.push(zone);
      }

      distAccum = 0;
      nextThreshold = INTERVAL_MIN + rng() * (INTERVAL_MAX - INTERVAL_MIN);
    }
  }

  return generatedZones;
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUERY FUNCTIONS — Used by the Safety Engine
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Count how many safe zones are within `radiusM` meters of (lat, lng).
 * Checks seed safe zones + any generated safe zones passed in for this route.
 */
export function countSafeZonesNearby(
  lat: number,
  lng: number,
  radiusM: number = 300,
  localZones: readonly MockSafeZone[] = []
): number {
  let count = 0;
  for (const zone of SEED_SAFE_ZONES) {
    if (haversineMeters(lat, lng, zone.lat, zone.lng) <= radiusM) {
      count++;
    }
  }
  for (const zone of localZones) {
    if (haversineMeters(lat, lng, zone.lat, zone.lng) <= radiusM) {
      count++;
    }
  }
  return count;
}

/**
 * Get all safe zones (seed + generated) within `maxDistM` meters of any of the given routes.
 * Uses bounding-box pre-filtering followed by sampled coordinate distance.
 */
export function getSafeZonesNearRoute(
  routesCoordinates: [number, number][][],
  generatedZones: MockSafeZone[] = [],
  maxDistM: number = 5000
): MockSafeZone[] {
  if (routesCoordinates.length === 0) return [];

  // 1. Calculate overall bounding box of all routes with a ~0.06 deg buffer (~6.5 km)
  let minLat = Infinity, maxLat = -Infinity;
  let minLng = Infinity, maxLng = -Infinity;

  for (const coords of routesCoordinates) {
    for (const [lat, lng] of coords) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }

  const degBuffer = (maxDistM / 111000) * 1.3;
  minLat -= degBuffer;
  maxLat += degBuffer;
  minLng -= degBuffer;
  maxLng += degBuffer;

  // Flatten and dedup candidate pool
  const candidatePool: MockSafeZone[] = [...SEED_SAFE_ZONES, ...generatedZones];
  const seenIds = new Set<string>();
  const results: MockSafeZone[] = [];

  for (const zone of candidatePool) {
    if (seenIds.has(zone.id)) continue;

    // Fast bounding box reject
    if (
      zone.lat < minLat ||
      zone.lat > maxLat ||
      zone.lng < minLng ||
      zone.lng > maxLng
    ) {
      continue;
    }

    // Check distance to route coordinates
    let isNear = false;
    for (const coords of routesCoordinates) {
      const step = coords.length > 200 ? Math.ceil(coords.length / 200) : 1;
      for (let i = 0; i < coords.length; i += step) {
        const [rLat, rLng] = coords[i];
        if (haversineMeters(zone.lat, zone.lng, rLat, rLng) <= maxDistM) {
          isNear = true;
          break;
        }
      }
      if (isNear) break;
    }

    if (isNear) {
      seenIds.add(zone.id);
      results.push(zone);
    }
  }

  return results;
}

/**
 * Get static seed safe zones (for debugging / admin views).
 */
export function getAllSafeZones(): readonly MockSafeZone[] {
  return SEED_SAFE_ZONES;
}

