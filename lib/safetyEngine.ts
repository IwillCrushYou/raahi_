import { supabaseAdmin, hasSupabaseKeys } from "@/lib/supabase";
import * as turf from "@turf/turf";
import { generateSafeZonesAlongRoute, countSafeZonesNearby, type MockSafeZone } from "@/mockDB/db";

interface ScoreInput {
  coords: [number, number][];
  time: Date;
}

interface ScoreResult {
  score: number;
  reasonTags: string[];
  generatedSafeZones?: MockSafeZone[];
}

const WEIGHTS = {
  safeZones: 0.10,       // 10%  — proximity to police stations, hospitals (mock DB)
  popularPlaces: 0.10,   // 10%  — geometry-based footfall proxy
  reportDensity: 0.10,   // 10%  — community reports within 150m
  historicalCrime: 0.15,  // 15%  — NCRB crime data by district
  timeOfDay: 0.05,       //  5%  — night penalty (11pm-5am)
  weather: 0.05,         //  5%  — rain/fog/storm penalty
  lighting: 0.30,        // 30%  — street lamp density from OSM
  govAccidents: 0.15,    // 15%  — NCRB traffic accident data
} as const;              // 100% total

const SAFE_ZONE_RADIUS_M = 300;  // meters — search radius for nearby safe zones

const NIGHT_PENALTY = 30;
const WEATHER_PENALTY = 20;
const REPORT_RADIUS_M = 150;
const LAMPS_PER_KM_FULL = 20;

const lightingCache = new Map<string, { factor: number; ts: number }>();

function getCacheKey(coords: [number, number][]) {
  const first = coords[0];
  const last = coords[coords.length - 1];
  return `${first[0].toFixed(3)},${first[1].toFixed(3)}-${last[0].toFixed(3)},${last[1].toFixed(3)}`;
}

function routeDistanceKm(coords: [number, number][]): number {
  const R = 6371;
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const [lat1, lng1] = coords[i - 1];
    const [lat2, lng2] = coords[i];
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
    total += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  return total || 0.001;
}

function createRouteBuffer(coords: [number, number][]) {
  const line = turf.lineString(coords.map(([lat, lng]) => [lng, lat]));
  const simplified = turf.simplify(line, { tolerance: 0.0005, highQuality: false });
  return turf.buffer(simplified, 0.05, { units: "kilometers" });
}

function bufferToPoly(buffer: any): string {
  const coords =
    buffer.geometry.type === "Polygon"
      ? buffer.geometry.coordinates[0]
      : buffer.geometry.coordinates[0][0];

  return coords.map(([lng, lat]: number[]) => `${lat} ${lng}`).join(" ");
}

function isShortRoute(coords: [number, number][]) {
  return coords.length < 12;
}

async function getLightingFactor(
  coords: [number, number][]
): Promise<{ factor: number; isPoorrlyLit: boolean }> {
  const FALLBACK = { factor: 60, isPoorrlyLit: false };

  if (coords.length < 5) return FALLBACK;

  const key = getCacheKey(coords);
  const cached = lightingCache.get(key);
  if (cached && Date.now() - cached.ts < 5 * 60 * 1000) {
    return { factor: cached.factor, isPoorrlyLit: cached.factor < 40 };
  }

  try {
    let query: string;

    if (isShortRoute(coords)) {
      let minLat = Infinity, maxLat = -Infinity;
      let minLng = Infinity, maxLng = -Infinity;

      for (const [lat, lng] of coords) {
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
      }

      query = `[out:json][timeout:8];
        node["highway"="street_lamp"](${minLat},${minLng},${maxLat},${maxLng});
        out count;`;
    } else {
      const buffer = createRouteBuffer(coords);
      const poly = bufferToPoly(buffer);

      query = `[out:json][timeout:10];
        node["highway"="street_lamp"](poly:"${poly}");
        out count;`;
    }

    const res = await fetch("https://overpass.kumi.systems/api/interpreter", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) return FALLBACK;

    const json = await res.json();
    if (!json?.elements?.length) return FALLBACK;

    const lampCount = Number(json.elements[0].tags?.total ?? 0);

    const distKm = routeDistanceKm(coords);
    const lampsPerKm = lampCount / distKm;

    const osmFactor = Math.min(
      100,
      Math.round((lampsPerKm / LAMPS_PER_KM_FULL) * 100)
    );

    const satelliteFactor = 60;

    const factor = Math.round(osmFactor * 0.7 + satelliteFactor * 0.3);

    lightingCache.set(key, { factor, ts: Date.now() });

    return {
      factor,
      isPoorrlyLit: factor < 40,
    };
  } catch {
    return FALLBACK;
  }
}

function sampleCoords(
  coords: [number, number][],
  maxPoints: number = 30
): [number, number][] {
  if (coords.length <= maxPoints) return coords;

  const sampled: [number, number][] = [];
  const step = coords.length / maxPoints;

  for (let i = 0; i < maxPoints; i++) {
    sampled.push(coords[Math.floor(i * step)]);
  }

  const last = coords[coords.length - 1];
  if (sampled[sampled.length - 1] !== last) {
    sampled.push(last);
  }
  return sampled;
}

async function countNearbyReports(lng: number, lat: number, radiusM: number) {
  if (!hasSupabaseKeys) return 0;
  try {
    const { data } = await supabaseAdmin
      .rpc("count_reports_nearby", { lng, lat, radius_m: radiusM })
      .maybeSingle();
    return typeof data === "number"
      ? data
      : typeof data === "object" && data && "count" in data
        ? (data as any).count
        : 0;
  } catch {
    return 0;
  }
}



async function getWeatherCondition(lng: number, lat: number) {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return { id: 800, main: "Clear" };

  try {
    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lng}&appid=${apiKey}`
    );
    if (!res.ok) return { id: 800, main: "Clear" };
    const data = await res.json();
    return data.weather?.[0] ?? { id: 800, main: "Clear" };
  } catch {
    return { id: 800, main: "Clear" };
  }
}

function isBadWeather(id: number) {
  return id < 700 || id === 741 || id === 701 || id === 721;
}

function isNightTime(date: Date) {
  const h = date.getHours();
  return h >= 23 || h < 5;
}

async function getDistrictFromCoords(lng: number, lat: number) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=district&access_token=${token}`
    );
    const data = await res.json();
    return data.features?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

// ── Government of India Traffic Accident Data ──────────────────────────────
// Source: NCRB "State/UTs/City-wise Traffic Accidents" dataset via data.gov.in
// Fetched through /api/accident server-side proxy to avoid CORS restrictions

// National max for normalizing accident_volume.
// Value from NCRB 2022 dataset — highest single state/UT total_traffic_accidents___cases.
// ⚠️  UPDATE THIS if the dataset year changes (check the /api/accident proxy for the resource ID).
const NATIONAL_MAX_ACCIDENTS = 68236;

const accidentCache = new Map<string, { factor: number; ts: number }>();

/**
 * Reverse-geocode coordinates to get city and state names for the Gov API
 * Uses Mapbox reverse geocoding with place (city) and region (state) types
 */
async function getCityAndStateFromCoords(
  lng: number,
  lat: number
): Promise<{ city: string | null; state: string | null }> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) return { city: null, state: null };

  try {
    const res = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?types=place,region&access_token=${token}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return { city: null, state: null };
    const data = await res.json();

    let city: string | null = null;
    let state: string | null = null;

    for (const feature of data.features ?? []) {
      if (feature.place_type?.includes("place") && !city) {
        city = feature.text;
      }
      if (feature.place_type?.includes("region") && !state) {
        state = feature.text;
      }
    }
    return { city, state };
  } catch {
    return { city: null, state: null };
  }
}

// Known cities in the dataset for fuzzy matching
const GOV_CITIES = [
  "Agra", "Ahmedabad", "Amritsar", "Asansol", "Aurangabad", "Bengaluru",
  "Bhopal", "Chennai", "Coimbatore", "Delhi (city)", "Dhanbad",
  "Durg Bhilainagar", "Faridabad", "Ghaziabad", "Gwalior", "Hyderabad",
  "Indore", "Jabalpur", "Jaipur", "Jamshedpur", "Jodhpur", "Kannur",
  "Kanpur", "Kochi", "Kolkata", "Kollam", "Kota", "Kozhikode",
  "Lucknow", "Ludhiana", "Madurai", "Malappuram", "Meerut", "Mumbai",
  "Nagpur", "Nasik", "Patna", "Pune", "Raipur", "Rajkot", "Ranchi",
  "Srinagar", "Surat", "Thiruvananthapuram", "Thrissur", "Tiruchirappalli",
  "Vadodara", "Varanasi", "Vasai Virar", "Vijayawada", "Vishakhapatnam",
];

const GOV_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand",
  "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan",
  "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh",
  "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands",
  "Chandigarh", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep",
  "Puducherry",
];

// City name aliases: Mapbox names → Gov dataset names
const CITY_ALIASES: Record<string, string> = {
  "bangalore": "Bengaluru",
  "bombay": "Mumbai",
  "calcutta": "Kolkata",
  "madras": "Chennai",
  "new delhi": "Delhi (city)",
  "delhi": "Delhi (city)",
  "nashik": "Nasik",
  "trivandrum": "Thiruvananthapuram",
  "trichy": "Tiruchirappalli",
  "vizag": "Vishakhapatnam",
  "visakhapatnam": "Vishakhapatnam",
  "prayagraj": "Prayagraj +",
  "allahabad": "Prayagraj +",
  "cochin": "Kochi",
  "calicut": "Kozhikode",
};

function matchGovName(name: string | null, list: string[]): string | null {
  if (!name) return null;
  const lower = name.toLowerCase().trim();

  // 1. Check alias first (Bangalore→Bengaluru, etc.)
  if (CITY_ALIASES[lower]) return CITY_ALIASES[lower];

  // 2. Exact match (case-insensitive)
  const exact = list.find((e) => e.toLowerCase() === lower);
  if (exact) return exact;

  // 3. Safe partial: only check if the input fully contains a dataset name
  //    e.g. "Durg" input should NOT match "Durg Bhilainagar", but
  //    "Durg Bhilainagar" input should match "Durg Bhilainagar"
  //    We do NOT check the reverse (dataset name contains input) to avoid
  //    false positives like "Nagar" matching "Durg Bhilainagar"
  const partial = list.find((e) => {
    const eLower = e.toLowerCase();
    // Input must contain the full dataset name (not the other way around)
    return lower.includes(eLower) && eLower.length >= 3;
  });
  return partial ?? null;
}

/**
 * Fetch accident data via internal /api/accident proxy (server-side)
 * This avoids CORS issues with the Gov API and validates the returned record
 */
async function fetchAccidentRecord(
  name: string
): Promise<{ cases: number; injured: number; died: number } | null> {
  try {
    // Use internal Next.js API route to proxy the request server-side
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
    const url = `${baseUrl}/api/accident?name=${encodeURIComponent(name)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const data = await res.json();
    const rec = data.record;
    if (!rec) return null;

    return {
      cases: rec.cases || 0,
      injured: rec.injured || 0,
      died: rec.died || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Compute a 0–100 safety factor from Gov accident data.
 * Uses: fatality_rate (40%), injury_rate (30%), normalized volume (30%)
 * Returns 100 = safest, 0 = most dangerous
 */
async function getGovAccidentFactor(
  lng: number,
  lat: number
): Promise<{ factor: number; isHighRisk: boolean }> {
  const FALLBACK = { factor: 70, isHighRisk: false };

  // Check cache
  // toFixed(1) gives ~11km resolution — appropriate for city-level accident data
  const cacheKey = `gov:${lat.toFixed(1)},${lng.toFixed(1)}`;
  const cached = accidentCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 10 * 60 * 1000) {
    return { factor: cached.factor, isHighRisk: cached.factor < 40 };
  }

  try {
    const { city, state } = await getCityAndStateFromCoords(lng, lat);

    // Try city-level first, fall back to state-level
    let record: { cases: number; injured: number; died: number } | null = null;
    const matchedCity = matchGovName(city, GOV_CITIES);
    if (matchedCity) {
      record = await fetchAccidentRecord(matchedCity);
    }

    if (!record) {
      const matchedState = matchGovName(state, GOV_STATES);
      if (matchedState) {
        record = await fetchAccidentRecord(matchedState);
      }
    }

    if (!record || record.cases === 0) {
      accidentCache.set(cacheKey, { factor: FALLBACK.factor, ts: Date.now() });
      return FALLBACK;
    }

    const fatalityRate = Math.min(1, record.died / record.cases);
    const injuryRate = Math.min(1, record.injured / record.cases);
    const accidentVolume = Math.min(1, record.cases / NATIONAL_MAX_ACCIDENTS);

    const rawRisk =
      fatalityRate * 0.4 + injuryRate * 0.3 + accidentVolume * 0.3;

    const factor = Math.round(
      Math.max(0, Math.min(100, 100 - rawRisk * 100))
    );

    accidentCache.set(cacheKey, { factor, ts: Date.now() });

    return { factor, isHighRisk: factor < 40 };
  } catch {
    return FALLBACK;
  }
}

async function getHistoricalCrimeFactor(district: string | null) {
  const FALLBACK = { factor: 80, hasSevereCrime: false };
  if (!district || !hasSupabaseKeys) return FALLBACK;

  try {
    const { data } = await supabaseAdmin
      .from("crime_stats")
      .select("*")
      .ilike("district", `%${district}%`)
      .maybeSingle();

    if (!data) return FALLBACK;

    const raw =
      data.murder * 15 +
      data.attempt_to_murder * 10 +
      data.kidnapping * 12 +
      data.rape * 20 +
      data.attempt_to_rape * 12 +
      data.acid_attack * 20 +
      data.sexual_harras * 8 +
      data.stalking * 5 +
      data.hit_and_run * 5;

    return {
      factor: Math.max(0, Math.min(100, 100 - raw / 5)),
      hasSevereCrime:
        data.murder > 10 || data.rape > 5 || data.acid_attack > 2,
    };
  } catch {
    return FALLBACK;
  }
}

// ── Popular Places Score (geometry-only footfall proxy) ─────────────────────

function haversineMeters(
  lat1: number, lng1: number, lat2: number, lng2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(
  lat1: number, lng1: number, lat2: number, lng2: number
): number {
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const r1 = (lat1 * Math.PI) / 180;
  const r2 = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(r2);
  const x =
    Math.cos(r1) * Math.sin(r2) - Math.sin(r1) * Math.cos(r2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function getPopularPlacesScore(coords: [number, number][]): number {
  if (coords.length < 6) return 50; // not enough data

  // Build segments: array of distances (meters) between consecutive points
  const segments: number[] = [];
  for (let i = 1; i < coords.length; i++) {
    const [lat1, lng1] = coords[i - 1];
    const [lat2, lng2] = coords[i];
    segments.push(haversineMeters(lat1, lng1, lat2, lng2));
  }

  const totalLength = segments.reduce((a, b) => a + b, 0);
  if (totalLength < 10) return 50; // degenerate route

  // Build bearing changes between consecutive segments
  const bearingChanges: number[] = [];
  for (let i = 1; i < coords.length - 1; i++) {
    const b1 = bearingDeg(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]);
    const b2 = bearingDeg(coords[i][0], coords[i][1], coords[i + 1][0], coords[i + 1][1]);
    let diff = Math.abs(b2 - b1);
    if (diff > 180) diff = 360 - diff;
    bearingChanges.push(diff);
  }

  // 1. CLUSTER DENSITY: sliding window of 5 consecutive segments
  const WINDOW = 5;
  let denseWindows = 0;
  const totalWindows = Math.max(1, segments.length - WINDOW + 1);
  for (let i = 0; i <= segments.length - WINDOW; i++) {
    let windowSum = 0;
    for (let j = i; j < i + WINDOW; j++) {
      windowSum += segments[j];
    }
    if (windowSum < 80) denseWindows++; // 5 segments < 80m total = dense cluster
  }
  const clusterRatio = denseWindows / totalWindows;

  // 2. MICRO-TURN DENSITY: bearing changes between 5° and 15°
  let microTurnCount = 0;
  for (const change of bearingChanges) {
    if (change >= 5 && change <= 15) microTurnCount++;
  }
  const microTurnDensity = microTurnCount / (totalLength / 1000); // per km

  // 3. POINT DENSITY: coords per km
  const pointDensity = coords.length / (totalLength / 1000);

  // 4. SCORE FORMULA
  const popularPlacesScore = Math.min(
    100,
    Math.max(
      0,
      Math.round(
        clusterRatio * 40 +
        microTurnDensity * 5 +
        pointDensity * 1.5 +
        20 // base score
      )
    )
  );

  console.log(
    "[popularPlaces]",
    { clusterRatio: +clusterRatio.toFixed(3), microTurnDensity: +microTurnDensity.toFixed(2), pointDensity: +pointDensity.toFixed(2), popularPlacesScore }
  );

  return popularPlacesScore;
}

export async function scoreRoute(input: ScoreInput): Promise<ScoreResult> {
  const { coords, time } = input;
  const reasonTags: string[] = [];

  const sampled = sampleCoords(coords, 30);

  let totalReports = 0;

  const results = await Promise.all(
    sampled.map(async ([lat, lng]) => {
      return countNearbyReports(lng, lat, REPORT_RADIUS_M);
    })
  );

  for (const r of results) {
    totalReports += r;
  }

  const reportFactor = Math.max(0, 100 - totalReports * 10);
  if (reportFactor < 60) reasonTags.push("high_report_density");

  let timeFactor = isNightTime(time) ? 70 : 100;
  if (timeFactor < 100) reasonTags.push("late_night_travel");

  const mid = sampled[Math.floor(sampled.length / 2)];

  const [weather, district, govAccident] = await Promise.all([
    getWeatherCondition(mid[1], mid[0]),
    getDistrictFromCoords(mid[1], mid[0]),
    getGovAccidentFactor(mid[1], mid[0]),
  ]);

  let weatherFactor = 100;
  if (isBadWeather(weather.id)) {
    weatherFactor = 80;
    reasonTags.push(`poor_weather_${weather.main.toLowerCase()}`);
  }

  const { factor: crimeFactor, hasSevereCrime } =
    await getHistoricalCrimeFactor(district);

  if (hasSevereCrime || crimeFactor < 50) {
    reasonTags.push("high_historical_crime_rate");
  }

  const { factor: lightingFactor, isPoorrlyLit } =
    await getLightingFactor(sampled);

  if (isPoorrlyLit) reasonTags.push("poor_street_lighting");

  if (govAccident.isHighRisk) reasonTags.push("high_traffic_accident_zone");

  const popularPlacesFactor = getPopularPlacesScore(coords);

  // ── Safe Zone proximity (mock DB — generates + counts, zero async) ──────
  // Step 1: Generate police stations along this route for this request
  const generatedSafeZones = generateSafeZonesAlongRoute(coords);

  // Step 2: Count how many safe zones are near each sampled point
  let totalSafeZones = 0;
  for (const [lat, lng] of sampled) {
    totalSafeZones += countSafeZonesNearby(lat, lng, SAFE_ZONE_RADIUS_M, generatedSafeZones);
  }
  const avgSafeZones = totalSafeZones / sampled.length;
  // Scoring: 2+ zones per sample point = 100, 0 zones = 30 (baseline)
  const safeZoneFactor = Math.min(100, Math.round(30 + avgSafeZones * 35));
  if (safeZoneFactor < 50) reasonTags.push("few_safe_zones_nearby");

  const score = Math.round(
    Math.max(
      0,
      Math.min(
        100,
        safeZoneFactor * WEIGHTS.safeZones +
          popularPlacesFactor * WEIGHTS.popularPlaces +
          reportFactor * WEIGHTS.reportDensity +
          crimeFactor * WEIGHTS.historicalCrime +
          timeFactor * WEIGHTS.timeOfDay +
          weatherFactor * WEIGHTS.weather +
          lightingFactor * WEIGHTS.lighting +
          govAccident.factor * WEIGHTS.govAccidents
      )
    )
  );

  console.log("[scoreRoute]", {
    safeZoneFactor, totalSafeZones, avgSafeZones: +avgSafeZones.toFixed(2),
    popularPlacesFactor, reportFactor, crimeFactor, timeFactor,
    weatherFactor, lightingFactor, govAccidentFactor: govAccident.factor,
    score,
  });

  return { score, reasonTags, generatedSafeZones };
}