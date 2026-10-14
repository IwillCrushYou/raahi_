// ✅ MAPBOX CONVERSION — Full rewrite from react-leaflet to Mapbox GL JS
'use client';

import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useRouteStore } from '@/lib/store';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useGeolocation } from '@/hooks/useGeolocation';
import { LocateFixed } from 'lucide-react';
import { filterAndSpacePOIs, type POICategoryKey, POI_CONFIG } from '@/lib/poiConfig';

// ✅ MAPBOX CONVERSION — Token from environment variable, not hardcoded
mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';

// ── Source/Layer ID helpers ──────────────────────────────────────────────────
const sourceId = (i: number) => `route-source-${i}`;
const baseLayerId = (i: number) => `route-layer-${i}-base`;
const dashLayerId = (i: number) => `route-layer-${i}-dash`;

// ── Marker DOM element factories ─────────────────────────────────────────────
// These replicate the exact same visual design as the old L.divIcon() templates

function createSafeZoneMarkerEl(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = 'background-color:#ffffff;width:24px;height:24px;border-radius:50%;border:2px solid #e5e7eb;box-shadow:0 4px 12px rgba(0,0,0,0.05);display:flex;align-items:center;justify-content:center;cursor:pointer;';
  const dot = document.createElement('div');
  dot.style.cssText = 'background-color:#059669;width:10px;height:10px;border-radius:50%;';
  el.appendChild(dot);
  return el;
}

function createHazardMarkerEl(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = 'background-color:#ffffff;width:24px;height:24px;border-radius:50%;border:2px solid #e5e7eb;box-shadow:0 4px 12px rgba(0,0,0,0.05);display:flex;align-items:center;justify-content:center;cursor:pointer;';
  const dot = document.createElement('div');
  dot.style.cssText = 'background-color:#f59e0b;width:10px;height:10px;border-radius:50%;';
  el.appendChild(dot);
  return el;
}

function createLiveLocationMarkerEl(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = 'position:relative;width:20px;height:20px;display:flex;align-items:center;justify-content:center;';

  // Pulsing ring
  const ping = document.createElement('div');
  ping.style.cssText = 'position:absolute;inset:0;background-color:rgba(59,130,246,0.4);border-radius:50%;';
  ping.classList.add('mapbox-ping-animation');
  el.appendChild(ping);

  // Core dot
  const core = document.createElement('div');
  core.style.cssText = 'position:absolute;width:12px;height:12px;background-color:#2563eb;border:2px solid #ffffff;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,0.25);z-index:10;';
  el.appendChild(core);

  return el;
}

function createStartPointMarkerEl(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = 'background-color:#ffffff;width:28px;height:28px;border-radius:50%;border:2px solid #e5e7eb;box-shadow:0 4px 15px rgba(0,0,0,0.08);display:flex;align-items:center;justify-content:center;cursor:pointer;';
  const dot = document.createElement('div');
  dot.style.cssText = 'background-color:#2563eb;width:12px;height:12px;border-radius:50%;';
  el.appendChild(dot);
  return el;
}

function createEndPointMarkerEl(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = 'background-color:#111827;width:28px;height:28px;border-radius:50%;border:2px solid #ffffff;box-shadow:0 4px 15px rgba(0,0,0,0.12);display:flex;align-items:center;justify-content:center;cursor:pointer;';
  const dot = document.createElement('div');
  dot.style.cssText = 'background-color:#ffffff;width:8px;height:8px;border-radius:2px;';
  el.appendChild(dot);
  return el;
}

// ── Popup HTML factories ─────────────────────────────────────────────────────

function createPopupHTML(label: string, content: string, labelColor: string = '#94a3b8'): string {
  return `<div style="padding:2px 4px;">
    <span style="color:${labelColor};font-size:10px;font-weight:700;display:block;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px;">${label}</span>
    <span style="color:#1e293b;font-weight:600;font-size:14px;display:block;max-width:200px;line-height:1.3;">${content}</span>
  </div>`;
}

export default function MapCanvas() {
  const origin = useRouteStore((state) => state.origin);
  const destination = useRouteStore((state) => state.destination);
  const routes = useRouteStore((state) => state.routes);
  const activeRouteIndex = useRouteStore((state) => state.activeRouteIndex);
  const userLocation = useRouteStore((state) => state.userLocation);
  const safeZones = useRouteStore((state) => state.safeZones);

  // Mount the geolocation listener
  useGeolocation();

  // ── Refs ──────────────────────────────────────────────────────────────────
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const mapLoaded = useRef(false);
  const hasInitialPanned = useRef(false);

  // Marker refs for cleanup
  const userMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const originMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const destMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const safeZoneMarkersRef = useRef<mapboxgl.Marker[]>([]);

  // Track how many route layers currently exist for stale removal
  const prevRouteCount = useRef(0);

  // ✅ MAPBOX CONVERSION — WebGL support check state
  const [webglSupported, setWebglSupported] = useState(true);

  // Category visibility toggles for the Nearby legend
  const [activeCategories, setActiveCategories] = useState<Record<POICategoryKey, boolean>>({
    police_station: true,
    hospital: true,
    fire_station: true,
    transit: true,
  });

  // ── whenMapReady() helper ─────────────────────────────────────────────────
  // ✅ MAPBOX CONVERSION — gates all source/layer calls behind style load
  const whenMapReady = useCallback((fn: (map: mapboxgl.Map) => void) => {
    const map = mapRef.current;
    if (!map) return;

    if (mapLoaded.current && map.isStyleLoaded()) {
      fn(map);
    } else {
      map.once('idle', () => fn(map));
    }
  }, []);

  // ── Map initialization ────────────────────────────────────────────────────
  // ✅ MAPBOX CONVERSION — replaces <MapContainer>, <TileLayer>, <ZoomControl>
  useEffect(() => {
    // ✅ MAPBOX CONVERSION — StrictMode double-mount guard
    if (mapRef.current) return;
    if (!mapContainerRef.current) return;

    // ✅ MAPBOX CONVERSION — WebGL support check with fallback UI
    if (!mapboxgl.supported()) {
      setWebglSupported(false);
      return;
    }

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/streets-v12', // ✅ MAPBOX CONVERSION — replaces CARTO tile layer
      center: [77.2090, 28.6139], // [lng, lat] — Mapbox uses lng,lat order
      zoom: 12,
      attributionControl: true, // ✅ MAPBOX CONVERSION — Mapbox ToS requires attribution
    });

    // ✅ MAPBOX CONVERSION — replaces <ZoomControl position="bottomright" />
    map.addControl(new mapboxgl.NavigationControl(), 'bottom-right');

    // ✅ MAPBOX CONVERSION — GeolocateControl for UI locate button (trackUserLocation
    // is false because live tracking is handled by Zustand + useGeolocation hook)
    map.addControl(
      new mapboxgl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: false,
        showUserHeading: true,
      }),
      'bottom-right'
    );

    // ✅ MAPBOX CONVERSION — map.on('load') gate for sources/layers
    map.on('load', () => {
      mapLoaded.current = true;
    });

    mapRef.current = map;

    // ✅ MAPBOX CONVERSION — cleanup for React StrictMode (effects run twice in dev)
    return () => {
      mapLoaded.current = false;
      hasInitialPanned.current = false;

      // Clean up all markers
      userMarkerRef.current?.remove();
      userMarkerRef.current = null;
      originMarkerRef.current?.remove();
      originMarkerRef.current = null;
      destMarkerRef.current?.remove();
      destMarkerRef.current = null;

      // Clean up safe zone markers
      for (const m of safeZoneMarkersRef.current) m.remove();
      safeZoneMarkersRef.current = [];

      prevRouteCount.current = 0;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── User location marker ──────────────────────────────────────────────────
  // ✅ MAPBOX CONVERSION — replaces <Marker icon={liveLocationIcon}> + <Popup>
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    // Always remove old marker first
    userMarkerRef.current?.remove();
    userMarkerRef.current = null;

    if (userLocation) {
      const popup = new mapboxgl.Popup({
        offset: 12,
        closeButton: false,
        className: 'raahi-popup',
      }).setHTML(createPopupHTML('Live', 'Your exact position', '#2563eb'));

      const marker = new mapboxgl.Marker({ element: createLiveLocationMarkerEl() })
        .setLngLat([userLocation.lng, userLocation.lat])
        .setPopup(popup)
        .addTo(map);

      userMarkerRef.current = marker;
    }
  }, [userLocation]);

  // ── Origin marker ─────────────────────────────────────────────────────────
  // ✅ MAPBOX CONVERSION — replaces <Marker icon={startPointIcon}> + <Popup>
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    // Always remove old marker first
    originMarkerRef.current?.remove();
    originMarkerRef.current = null;

    if (origin) {
      const popup = new mapboxgl.Popup({
        offset: 14,
        closeButton: false,
        className: 'raahi-popup',
      }).setHTML(createPopupHTML('Start', origin.address));

      const marker = new mapboxgl.Marker({ element: createStartPointMarkerEl() })
        .setLngLat([origin.lng, origin.lat])
        .setPopup(popup)
        .addTo(map);

      originMarkerRef.current = marker;
    }
  }, [origin]);

  // ── Destination marker ─────────────────────────────────────────────────────
  // ✅ MAPBOX CONVERSION — replaces <Marker icon={endPointIcon}> + <Popup>
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    // Always remove old marker first
    destMarkerRef.current?.remove();
    destMarkerRef.current = null;

    if (destination) {
      const popup = new mapboxgl.Popup({
        offset: 14,
        closeButton: false,
        className: 'raahi-popup',
      }).setHTML(createPopupHTML('Destination', destination.address));

      const marker = new mapboxgl.Marker({ element: createEndPointMarkerEl() })
        .setLngLat([destination.lng, destination.lat])
        .setPopup(popup)
        .addTo(map);

      destMarkerRef.current = marker;
    }
  }, [destination]);

  // ── Route polylines ────────────────────────────────────────────────────────
  // ✅ MAPBOX CONVERSION — replaces <Polyline> components with GeoJSON sources
  // + dual-layer (base + dash) architecture per route
  useEffect(() => {
    if (!mapRef.current) return;

    whenMapReady((map) => {
      // Determine render order: alternatives first, then active, safest on top
      const sortedRoutes = routes
        .map((route, originalIndex) => ({ route, originalIndex }))
        .sort((a, b) => {
          if (a.route.isSafest) return 1;
          if (b.route.isSafest) return -1;
          if (a.originalIndex === activeRouteIndex) return 1;
          if (b.originalIndex === activeRouteIndex) return -1;
          return 0;
        });

      // Update or create layers for each route
      sortedRoutes.forEach(({ route, originalIndex }, renderIdx) => {
        const sId = sourceId(renderIdx);
        const baseId = baseLayerId(renderIdx);
        const dashId = dashLayerId(renderIdx);
        const isActive = originalIndex === activeRouteIndex;

        // Color priority: safest → green, active → blue, alt → grey
        let color = '#9ca3af'; // grey for alternatives
        let width = 3;
        let isDashed = true;

        if (isActive) {
          color = '#2563eb'; // blue for user-selected
          width = 6;
          isDashed = false;
        }
        if (route.isSafest) {
          color = '#16a34a'; // green always wins for safest
          width = 6;
          isDashed = false;
        }

        // Route coordinates are [lat, lng] from store — Mapbox needs [lng, lat]
        const geojson: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: route.coordinates.map(([lat, lng]) => [lng, lat]),
            },
          }],
        };

        // ✅ MAPBOX CONVERSION — add-or-update pattern (first render vs subsequent)
        const existingSource = map.getSource(sId);
        if (existingSource) {
          // Source exists — update data + paint properties
          (existingSource as mapboxgl.GeoJSONSource).setData(geojson);
          map.setPaintProperty(baseId, 'line-color', color);
          map.setPaintProperty(baseId, 'line-width', width);
          map.setPaintProperty(baseId, 'line-opacity', 0.9);

          // Manage dash overlay layer
          if (isDashed) {
            if (!map.getLayer(dashId)) {
              map.addLayer({
                id: dashId,
                type: 'line',
                source: sId,
                layout: { 'line-cap': 'round', 'line-join': 'round' },
                paint: {
                  'line-color': color,
                  'line-width': width,
                  'line-opacity': 0.9,
                  'line-dasharray': [8, 8],
                },
              });
            } else {
              map.setPaintProperty(dashId, 'line-color', color);
              map.setPaintProperty(dashId, 'line-width', width);
            }
          } else {
            // Active/safest — remove dash layer if it exists
            if (map.getLayer(dashId)) map.removeLayer(dashId);
          }
        } else {
          // First time — add source + base layer
          map.addSource(sId, { type: 'geojson', data: geojson });
          map.addLayer({
            id: baseId,
            type: 'line',
            source: sId,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: {
              'line-color': color,
              'line-width': width,
              'line-opacity': 0.9,
            },
          });

          // Add dash overlay only for alternatives
          if (isDashed) {
            map.addLayer({
              id: dashId,
              type: 'line',
              source: sId,
              layout: { 'line-cap': 'round', 'line-join': 'round' },
              paint: {
                'line-color': color,
                'line-width': width,
                'line-opacity': 0.9,
                'line-dasharray': [8, 8],
              },
            });
          }
        }
      });

      // ✅ MAPBOX CONVERSION — remove stale route layers when route count decreases
      for (let i = routes.length; i < prevRouteCount.current; i++) {
        if (map.getLayer(dashLayerId(i))) map.removeLayer(dashLayerId(i));
        if (map.getLayer(baseLayerId(i))) map.removeLayer(baseLayerId(i));
        if (map.getSource(sourceId(i))) map.removeSource(sourceId(i));
      }
      prevRouteCount.current = routes.length;
    });
  }, [routes, activeRouteIndex, whenMapReady]);

  // ── Bounds management ──────────────────────────────────────────────────────
  // ✅ MAPBOX CONVERSION — replaces MapBoundsManager component (useMap + L.latLngBounds)
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    const timer = setTimeout(() => {
      if (routes.length > 0 && routes[activeRouteIndex]?.coordinates?.length > 0) {
        // Fit to route coordinates
        const bounds = new mapboxgl.LngLatBounds();
        routes[activeRouteIndex].coordinates.forEach(([lat, lng]) => {
          bounds.extend([lng, lat]);
        });
        // ✅ MAPBOX CONVERSION — asymmetric padding accounts for sidebar/route panel
        map.fitBounds(bounds, {
          padding: { top: 80, bottom: 320, left: 40, right: 40 },
          maxZoom: 16,
          duration: 800,
        });
      } else if (origin && destination) {
        // Fit to origin + destination
        const bounds = new mapboxgl.LngLatBounds();
        bounds.extend([origin.lng, origin.lat]);
        bounds.extend([destination.lng, destination.lat]);
        map.fitBounds(bounds, {
          padding: { top: 80, bottom: 320, left: 40, right: 40 },
          maxZoom: 16,
          duration: 800,
        });
      } else if (origin) {
        map.flyTo({ center: [origin.lng, origin.lat], zoom: 14, duration: 1500 });
      } else if (userLocation && !hasInitialPanned.current) {
        // First boot with geolocation — fly to user
        map.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 14, duration: 1500 });
        hasInitialPanned.current = true;
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [origin, destination, routes, activeRouteIndex, userLocation]);

  // ── Safe Zone markers (police stations, hospitals, etc.) ────────────────
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;

    // Explicitly remove previous safe zone markers before creating new ones
    for (const m of safeZoneMarkersRef.current) m.remove();
    safeZoneMarkersRef.current = [];

    if (safeZones.length === 0) return;

    // Active route coordinates (or first route if index out of bounds)
    const activeRouteCoords = routes[activeRouteIndex]?.coordinates;

    // Filter, space out, and cap POIs along the active route
    const displayZones = filterAndSpacePOIs(
      safeZones,
      activeRouteCoords,
      activeCategories,
      POI_CONFIG
    );

    for (const zone of displayZones) {
      // Subtle color by type
      const dotColor =
        zone.type === 'police_station' ? '#3b82f6' :
        zone.type === 'hospital' ? '#ef4444' :
        zone.type === 'fire_station' ? '#f59e0b' :
        '#059669';

      const typeEmoji =
        zone.type === 'police_station' ? '🚔' :
        zone.type === 'hospital' ? '🏥' :
        zone.type === 'fire_station' ? '🚒' :
        zone.type === 'railway_station' ? '🚉' : '🚏';

      const typeTitle =
        zone.type === 'police_station' ? 'Police Station' :
        zone.type === 'hospital' ? 'Hospital' :
        zone.type === 'fire_station' ? 'Fire Station' :
        'Transit';

      // Tiny 10px dot — subtle filled circle with slight shadow
      const el = document.createElement('div');
      el.style.cssText = `width:10px;height:10px;border-radius:50%;background:${dotColor};box-shadow:0 1px 4px rgba(0,0,0,0.25);cursor:pointer;transition:transform 0.15s ease;`;
      el.title = `${typeEmoji} ${zone.name}`;
      el.onmouseenter = () => { el.style.transform = 'scale(1.35)'; };
      el.onmouseleave = () => { el.style.transform = 'scale(1)'; };

      const popup = new mapboxgl.Popup({
        offset: 8,
        closeButton: false,
        className: 'raahi-popup',
      }).setHTML(createPopupHTML(typeTitle, zone.name, dotColor));

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([zone.lng, zone.lat])
        .setPopup(popup)
        .addTo(map);

      safeZoneMarkersRef.current.push(marker);
    }
  }, [safeZones, routes, activeRouteIndex, activeCategories]);

  // ── Locate Me handler ──────────────────────────────────────────────────────
  const handleLocateMe = useCallback(() => {
    if (!mapRef.current || !userLocation) return;
    mapRef.current.flyTo({ center: [userLocation.lng, userLocation.lat], zoom: 16, duration: 1000 });
  }, [userLocation]);

  // ── WebGL fallback UI ─────────────────────────────────────────────────────
  // ✅ MAPBOX CONVERSION — graceful degradation when WebGL is not available
  if (!webglSupported) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-zinc-50 text-zinc-600">
        <div className="text-center space-y-3 max-w-sm px-6">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-zinc-100 border border-zinc-200 flex items-center justify-center">
            <svg className="w-7 h-7 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-zinc-800">WebGL Not Available</h3>
          <p className="text-sm leading-relaxed">
            Your browser doesn&apos;t support WebGL, which is required for the interactive map.
            Try updating your browser or enabling hardware acceleration.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative z-0 bg-[#f9fafb]">
      {/* ✅ MAPBOX CONVERSION — replaces <MapContainer> */}
      <div
        ref={mapContainerRef}
        style={{ height: '100%', width: '100%' }}
      />

      {/* ✅ MAPBOX CONVERSION — Locate Me button (replaces LocateControl component) */}
      {userLocation && (
        <button
          onClick={handleLocateMe}
          className="absolute bottom-28 right-3 z-[1000] w-10 h-10 bg-white rounded-xl shadow-[0_2px_10px_rgba(0,0,0,0.1)] border border-gray-200 flex items-center justify-center text-gray-700 hover:text-blue-600 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all active:scale-95"
          title="Locate Me"
        >
          <LocateFixed className="w-5 h-5" />
        </button>
      )}

      {/* Safe Zone Legend with Interactive Category Toggles */}
      {safeZones.length > 0 && (
        <div className="absolute bottom-4 left-3 z-[1000] bg-white/95 backdrop-blur-md rounded-xl shadow-md border border-gray-200/80 px-3 py-2.5 text-[11px] space-y-1.5 select-none transition-all">
          <span className="font-bold text-[#374151] uppercase tracking-wider block text-[10px] mb-1">Nearby</span>
          <button
            type="button"
            onClick={() => setActiveCategories((prev) => ({ ...prev, police_station: !prev.police_station }))}
            className={`flex items-center gap-1.5 w-full text-left transition-opacity hover:opacity-100 ${activeCategories.police_station ? 'opacity-100 font-medium text-gray-800' : 'opacity-40 text-gray-400 line-through'}`}
            title="Click to toggle Police Stations"
          >
            <span className="w-2 h-2 rounded-full bg-[#3b82f6] shrink-0 inline-block" />Police Station
          </button>
          <button
            type="button"
            onClick={() => setActiveCategories((prev) => ({ ...prev, hospital: !prev.hospital }))}
            className={`flex items-center gap-1.5 w-full text-left transition-opacity hover:opacity-100 ${activeCategories.hospital ? 'opacity-100 font-medium text-gray-800' : 'opacity-40 text-gray-400 line-through'}`}
            title="Click to toggle Hospitals"
          >
            <span className="w-2 h-2 rounded-full bg-[#ef4444] shrink-0 inline-block" />Hospital
          </button>
          <button
            type="button"
            onClick={() => setActiveCategories((prev) => ({ ...prev, fire_station: !prev.fire_station }))}
            className={`flex items-center gap-1.5 w-full text-left transition-opacity hover:opacity-100 ${activeCategories.fire_station ? 'opacity-100 font-medium text-gray-800' : 'opacity-40 text-gray-400 line-through'}`}
            title="Click to toggle Fire Stations"
          >
            <span className="w-2 h-2 rounded-full bg-[#f59e0b] shrink-0 inline-block" />Fire Station
          </button>
          <button
            type="button"
            onClick={() => setActiveCategories((prev) => ({ ...prev, transit: !prev.transit }))}
            className={`flex items-center gap-1.5 w-full text-left transition-opacity hover:opacity-100 ${activeCategories.transit ? 'opacity-100 font-medium text-gray-800' : 'opacity-40 text-gray-400 line-through'}`}
            title="Click to toggle Transit"
          >
            <span className="w-2 h-2 rounded-full bg-[#059669] shrink-0 inline-block" />Transit
          </button>
        </div>
      )}
    </div>
  );
}
