// ─── POI Display Configuration & Spatial Filter ─────────────────────────────

export interface POIConfig {
  MAX_POIS_PER_CATEGORY: number;
  MAX_TOTAL_POIS: number;
  MIN_SPACING_KM: number;
  MAX_DISTANCE_FROM_ROUTE_KM: number;
}

export const POI_CONFIG: POIConfig = {
  MAX_POIS_PER_CATEGORY: 5,
  MAX_TOTAL_POIS: 20,
  MIN_SPACING_KM: 3,          // Minimum distance between POIs of the same category
  MAX_DISTANCE_FROM_ROUTE_KM: 5, // Maximum perpendicular distance from the active route
};

export type POICategoryKey = 'police_station' | 'hospital' | 'fire_station' | 'transit';

export function getPOICategory(type: string): POICategoryKey {
  if (type === 'police_station') return 'police_station';
  if (type === 'hospital') return 'hospital';
  if (type === 'fire_station') return 'fire_station';
  return 'transit'; // railway_station, bus_stand, etc.
}

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

/**
 * Computes minimum distance in meters from a point to a route polyline.
 * Uses sampled points along the route for sub-millisecond execution.
 */
export function minDistanceToRoute(
  lat: number,
  lng: number,
  routeCoords: [number, number][]
): { minDistanceM: number; closestIndex: number } {
  if (routeCoords.length === 0) return { minDistanceM: Infinity, closestIndex: -1 };

  let minDistanceM = Infinity;
  let closestIndex = 0;

  // Step through coordinates. For long routes, sample to keep it very fast
  const step = routeCoords.length > 300 ? Math.ceil(routeCoords.length / 300) : 1;

  for (let i = 0; i < routeCoords.length; i += step) {
    const [rLat, rLng] = routeCoords[i];
    const d = haversineMeters(lat, lng, rLat, rLng);
    if (d < minDistanceM) {
      minDistanceM = d;
      closestIndex = i;
    }
  }

  return { minDistanceM, closestIndex };
}

/**
 * Filter, space out, and cap POIs along the active route:
 * 1. Keep only POIs within MAX_DISTANCE_FROM_ROUTE_KM of the route
 * 2. Order POIs along the route's progression
 * 3. Enforce MIN_SPACING_KM between POIs in the same category
 * 4. Cap at MAX_POIS_PER_CATEGORY per category and MAX_TOTAL_POIS total
 */
export function filterAndSpacePOIs<T extends { lat: number; lng: number; type: string }>(
  pois: T[],
  routeCoords: [number, number][] | undefined,
  activeCategories?: Record<POICategoryKey, boolean>,
  config: POIConfig = POI_CONFIG
): T[] {
  if (!pois || pois.length === 0) return [];
  if (!routeCoords || routeCoords.length === 0) {
    // If no route coords, just cap per category
    const byCategory: Record<string, T[]> = {};
    for (const poi of pois) {
      const cat = getPOICategory(poi.type);
      if (activeCategories && activeCategories[cat] === false) continue;
      if (!byCategory[cat]) byCategory[cat] = [];
      if (byCategory[cat].length < config.MAX_POIS_PER_CATEGORY) {
        byCategory[cat].push(poi);
      }
    }
    return Object.values(byCategory).flat().slice(0, config.MAX_TOTAL_POIS);
  }

  const maxDistM = config.MAX_DISTANCE_FROM_ROUTE_KM * 1000;
  const minSpacingM = config.MIN_SPACING_KM * 1000;

  // 1. Calculate distance to route and closest route index for each POI
  const candidates: { poi: T; minDistanceM: number; closestIndex: number; cat: POICategoryKey }[] = [];

  for (const poi of pois) {
    const cat = getPOICategory(poi.type);
    if (activeCategories && activeCategories[cat] === false) continue;

    const { minDistanceM, closestIndex } = minDistanceToRoute(poi.lat, poi.lng, routeCoords);
    if (minDistanceM <= maxDistM) {
      candidates.push({ poi, minDistanceM, closestIndex, cat });
    }
  }

  // 2. Sort by route progression (closestIndex) so they are naturally ordered along the route
  candidates.sort((a, b) => a.closestIndex - b.closestIndex);

  // 3. Select spaced-out POIs per category
  const selectedByCategory: Record<POICategoryKey, T[]> = {
    police_station: [],
    hospital: [],
    fire_station: [],
    transit: [],
  };

  for (const item of candidates) {
    const catList = selectedByCategory[item.cat];
    if (catList.length >= config.MAX_POIS_PER_CATEGORY) continue;

    // Check spacing against already selected POIs in this category
    const isTooClose = catList.some(
      (existing) => haversineMeters(item.poi.lat, item.poi.lng, existing.lat, existing.lng) < minSpacingM
    );

    if (!isTooClose) {
      catList.push(item.poi);
    }
  }

  // 4. Combine all selected POIs, capped at MAX_TOTAL_POIS
  const combined: T[] = [];
  const categories: POICategoryKey[] = ['police_station', 'hospital', 'fire_station', 'transit'];

  // Interleave categories to ensure diverse representation up to MAX_TOTAL_POIS
  let added = true;
  let idx = 0;
  while (added && combined.length < config.MAX_TOTAL_POIS) {
    added = false;
    for (const cat of categories) {
      if (idx < selectedByCategory[cat].length && combined.length < config.MAX_TOTAL_POIS) {
        combined.push(selectedByCategory[cat][idx]);
        added = true;
      }
    }
    idx++;
  }

  return combined;
}
