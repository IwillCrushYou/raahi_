// 🔒 BACKEND/DB — DO NOT MODIFY (flagged for future work)
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getRoutesFromCoordinates } from "@/lib/routing";
import { scoreRoute } from "@/lib/safetyEngine";
import { getSafeZonesNearRoute, type MockSafeZone } from "@/mockDB/db";
import type { ScoredRoute } from "@/types";

const LatLngSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const ScoreRequestSchema = z.object({
  origin: LatLngSchema,
  destination: LatLngSchema,
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const parsed = ScoreRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { origin, destination } = parsed.data;

    const routes = await getRoutesFromCoordinates(origin, destination);

    const allGeneratedZones: MockSafeZone[] = [];

    const scored = await Promise.all(
      routes.map(async (route, idx) => {
        const { score, reasonTags, generatedSafeZones } = await scoreRoute({
          coords: route.coordinates,
          time: new Date(),
        });

        if (generatedSafeZones && generatedSafeZones.length > 0) {
          allGeneratedZones.push(...generatedSafeZones);
        }

        return {
          coordinates: route.coordinates,
          duration: route.duration,
          distance: route.distance,
          isFastest: idx === 0, 
          isSafest: false,      
          safetyScore: score,
          reasonTags,
          geometry: {
            type: "LineString" as const,
            coordinates: route.coordinates.map(([lat, lng]) => [lng, lat])
          },
        };
      })
    );

    scored.sort((a, b) => b.safetyScore - a.safetyScore);
    if (scored.length > 0) scored[0].isSafest = true;

    // Filter to only safe zones (seed + generated for these routes) within ~5 km of the scored routes
    const routesCoords = scored.map((r) => r.coordinates);
    const nearSafeZones = getSafeZonesNearRoute(routesCoords, allGeneratedZones, 5000);

    const safeZones = nearSafeZones.map((z) => ({
      id: z.id,
      name: z.name,
      type: z.type,
      lat: z.lat,
      lng: z.lng,
    }));

    return NextResponse.json({ routes: scored, safeZones });
  } catch (error) {
    console.error("[POST /api/routes/score]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
