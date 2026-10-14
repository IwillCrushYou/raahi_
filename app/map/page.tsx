'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useRouteStore } from '@/lib/store';
import { fetchRouteData } from '@/lib/routing';
import LocationAutocomplete from '@/components/UI/LocationAutocomplete';
import type { SuggestionResult } from '@/components/UI/LocationAutocomplete';
import RoutePanel from '@/components/Routing/RoutePanel';
import SOSButton from '@/components/UI/SOSButton';
import ProfileMenu from '@/components/UI/ProfileMenu';
import ReportModal from '@/components/Modals/ReportModal';
import LoginRequiredModal from '@/components/Modals/LoginRequiredModal';
import AnalyticsButton from '@/components/UI/AnalyticsButton';

const Map = dynamic(() => import('@/components/Map/MapCanvas'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#f9fafb]">
      <div className="text-center space-y-3">
        <div className="w-8 h-8 mx-auto border-2 border-[#e5e7eb] border-t-[#2563eb] rounded-full animate-spin" />
        <span className="text-sm font-medium text-[#6b7280] animate-pulse block">
          Initializing Map Engine...
        </span>
      </div>
    </div>
  )
});

export default function MapPage() {
  const router = useRouter();
  const [startQuery, setStartQuery] = useState('');
  const [endQuery, setEndQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  // Pre-resolved coordinates from autocomplete selection
  // When a user picks a suggestion, we store the exact coords to avoid re-geocoding
  const selectedOriginCoords = useRef<{ lat: number; lng: number } | null>(null);
  const selectedDestCoords = useRef<{ lat: number; lng: number } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const setOrigin = useRouteStore((state) => state.setOrigin);
  const setDestination = useRouteStore((state) => state.setDestination);
  const setRoutes = useRouteStore((state) => state.setRoutes);
  const setSafeZones = useRouteStore((state) => state.setSafeZones);
  const setActiveRouteIndex = useRouteStore((state) => state.setActiveRouteIndex);
  const userLocation = useRouteStore((state) => state.userLocation);

  // Proximity bias for autocomplete — use user location or Delhi center
  const proximity: [number, number] = userLocation
    ? [userLocation.lng, userLocation.lat]
    : [77.2090, 28.6139];

  // ── Handle autocomplete suggestion selection ─────────────────────────────
  const handleStartSelect = useCallback((suggestion: SuggestionResult) => {
    selectedOriginCoords.current = {
      lng: suggestion.center[0],
      lat: suggestion.center[1],
    };
  }, []);

  const handleDestSelect = useCallback((suggestion: SuggestionResult) => {
    selectedDestCoords.current = {
      lng: suggestion.center[0],
      lat: suggestion.center[1],
    };
  }, []);

  // Clear pre-resolved coords when user types manually
  const handleStartChange = useCallback((val: string) => {
    setStartQuery(val);
    selectedOriginCoords.current = null; // user is typing, invalidate pre-resolved coords
  }, []);

  const handleDestChange = useCallback((val: string) => {
    setEndQuery(val);
    selectedDestCoords.current = null;
  }, []);

  const handleUseCurrentLocation = useCallback(async () => {
    if (!userLocation) {
      setErrorMsg('Waiting for precise GPS location from your device...');
      return;
    }

    setIsLoading(true);
    setErrorMsg('');
    try {
      const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '';
      const params = new URLSearchParams({
        access_token: MAPBOX_TOKEN,
        types: 'address,poi,neighborhood,locality,place',
        limit: '1',
      });
      // Mapbox reverse geocoding URL format: /geocoding/v5/mapbox.places/{longitude},{latitude}.json
      const res = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${userLocation.lng},${userLocation.lat}.json?${params}`);

      if (!res.ok) throw new Error('Reverse geocoding failed');

      const data = await res.json();
      const feature = data.features?.[0];
      const address = feature?.place_name ?? `${userLocation.lat.toFixed(5)}, ${userLocation.lng.toFixed(5)}`;

      setStartQuery(address);
      selectedOriginCoords.current = { lat: userLocation.lat, lng: userLocation.lng };
    } catch (err) {
      const fallback = `${userLocation.lat.toFixed(5)}, ${userLocation.lng.toFixed(5)}`;
      setStartQuery(fallback);
      selectedOriginCoords.current = { lat: userLocation.lat, lng: userLocation.lng };
    } finally {
      setIsLoading(false);
    }
  }, [userLocation]);

  const handleRouteSearch = async () => {
    if (!startQuery.trim() || !endQuery.trim()) {
      setErrorMsg('Please provide both start and destination locations.');
      return;
    }

    // 1. Cancel any previous in-flight search request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setErrorMsg('');

    // 2. Immediately reset previous routes and safe zone markers so stale data vanishes
    setRoutes([]);
    setSafeZones([]);
    setActiveRouteIndex(0);

    try {
      // 3. Build Origin — use pre-resolved Mapbox coords if available, else Nominatim
      let origin = selectedOriginCoords.current ? { ...selectedOriginCoords.current, address: startQuery } : null;
      if (!origin) {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(startQuery)}`,
          { signal: controller.signal }
        );
        const data = await res.json();
        if (!data || data.length === 0) throw new Error('Could not find start location.');
        origin = {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
          address: data[0].display_name
        };
      }

      // 4. Build Destination — use pre-resolved Mapbox coords if available, else Nominatim
      let dest = selectedDestCoords.current ? { ...selectedDestCoords.current, address: endQuery } : null;
      if (!dest) {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(endQuery)}`,
          { signal: controller.signal }
        );
        const data = await res.json();
        if (!data || data.length === 0) throw new Error('Could not find destination.');
        dest = {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon),
          address: data[0].display_name
        };
      }

      setOrigin(origin);
      setDestination(dest);

      // 5. Score the route and get safety data
      const scoreRes = await fetch('/api/routes/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination: dest }),
        signal: controller.signal,
      });

      if (!scoreRes.ok) {
        throw new Error('Failed to fetch scored routes from safety engine.');
      }

      const scored = await scoreRes.json();

      if (scored?.routes && scored.routes.length > 0) {
        setRoutes(scored.routes);
        setActiveRouteIndex(0);
        // Store safe zones for map markers
        if (scored.safeZones) {
          setSafeZones(scored.safeZones);
        }
      } else {
        setErrorMsg('No routes found between these locations.');
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // Request was aborted by a new search; ignore silently
        return;
      }
      setErrorMsg(err.message || 'Routing failed. Try being more specific with location names.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="flex h-[100dvh] w-screen overflow-hidden bg-[#ffffff] text-[#111827] font-sans flex-col md:flex-row">
      {/* Sidebar Panel */}
      <div className="w-full md:w-96 lg:w-[420px] h-[55vh] md:h-full bg-white border-t md:border-t-0 md:border-r border-[#e5e7eb] flex flex-col shadow-sm z-10 p-6 md:p-8 order-2 md:order-1 shrink-0 lg:rounded-r-2xl">
        {/* Logo + Profile */}
        <div className="hidden md:flex items-center justify-between mb-8">
          <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
            <span className="text-2xl font-extrabold tracking-tight text-[#111827]">Raahi</span>
          </Link>
          <ProfileMenu />
        </div>

        {/* Mobile Grab Handle */}
        <div className="w-12 h-1.5 bg-[#e5e7eb] rounded-full mx-auto mb-6 md:hidden" />

        {/* Search Bar Section — Autocomplete inputs */}
        <div className="space-y-4 mb-4">
          <LocationAutocomplete
            value={startQuery}
            onChange={handleStartChange}
            onSelect={handleStartSelect}
            onEnter={handleRouteSearch}
            label="Start Location"
            icon="start"
            placeholder="Enter start point..."
            showLocateButton
            onLocateClick={handleUseCurrentLocation}
            proximity={proximity}
          />
          <LocationAutocomplete
            value={endQuery}
            onChange={handleDestChange}
            onSelect={handleDestSelect}
            onEnter={handleRouteSearch}
            label="Destination"
            icon="end"
            placeholder="Where to?"
            proximity={proximity}
          />
        </div>

        {/* Error Banner */}
        {errorMsg && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl p-3.5 mb-4 font-medium flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{errorMsg}</span>
            <button
              onClick={() => setErrorMsg('')}
              className="ml-auto text-red-400 hover:text-red-600 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}

        {/* Search Button */}
        <button
          onClick={handleRouteSearch}
          disabled={isLoading}
          className="w-full bg-[#2563eb] hover:bg-[#1d4ed8] disabled:bg-[#93c5fd] disabled:cursor-not-allowed text-white font-medium tracking-normal rounded-xl py-4 transition-all shadow-[0_4px_14px_0_rgba(37,99,235,0.39)] mb-8 flex items-center justify-center gap-2 hover:shadow-[0_6px_20px_rgba(37,99,235,0.23)] active:translate-y-0 text-base"
        >
          {isLoading ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span>Analyzing Routes...</span>
            </>
          ) : (
            <>
              Find Safest Route
              <svg className="w-4 h-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </>
          )}
        </button>

        {/* Route Results Panel */}
        <RoutePanel isLoading={isLoading} />

        {/* Report Button at bottom of sidebar */}
        <button
          onClick={async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
              setIsReportModalOpen(true);
            } else {
              setIsLoginModalOpen(true);
            }
          }}
          className="mt-4 w-full py-3 rounded-xl border border-[#e5e7eb] bg-[#f9fafb] hover:bg-white text-sm font-medium text-[#6b7280] hover:text-[#111827] transition-all flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 3v1.5M3 21v-6m0 0l2.77-.693a9 9 0 016.208.682l.108.054a9 9 0 006.086.71l3.114-.732a48.524 48.524 0 01-.005-10.499l-3.11.732a9 9 0 01-6.085-.711l-.108-.054a9 9 0 00-6.208-.682L3 4.5M3 15V4.5" />
          </svg>
          Report Safety Issue
        </button>
      </div>

      {/* Map Area */}
      <div className="flex-1 w-full h-[45vh] md:h-full relative order-1 md:order-2 bg-[#f9fafb]">
        <Map />

        {/* Floating Profile (mobile only) */}
        <div className="absolute top-6 left-6 md:hidden z-[1000]">
          <ProfileMenu />
        </div>

        {/* Floating Action Buttons — Analytics + SOS */}
        <div className="absolute top-6 right-6 md:top-8 md:right-8 z-[1000] flex items-center gap-3">
          <AnalyticsButton className="w-12 h-12 md:w-14 md:h-14" />
          <SOSButton className="w-12 h-12 md:w-14 md:h-14" />
        </div>
      </div>

      {/* Report Modal */}
      <ReportModal
        isOpen={isReportModalOpen}
        onClose={() => setIsReportModalOpen(false)}
      />

      {/* Login Required Modal */}
      <LoginRequiredModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
      />
    </main>
  );
}
