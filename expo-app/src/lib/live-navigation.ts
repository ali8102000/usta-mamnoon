// أدوات الملاحة المشتركة في تطبيقات ممنون الأربعة.
// لا يحتوي هذا الملف على أي مفتاح Google؛ جميع طلبات الطرق تمر عبر maps-proxy.

export type LatLng = { latitude: number; longitude: number };
export type RouteStep = {
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
  maneuver?: string;
};

export type RouteResult = {
  distanceKm: number;
  durationMin: number;
  routeSource?: string;
  routePoints: LatLng[];
  routeSteps: RouteStep[];
};

export function decodeGooglePolyline(encoded: string): LatLng[] {
  const points: LatLng[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  // Google encodes latitude and longitude as signed delta values.
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < encoded.length);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

export function haversineMeters(a: LatLng, b: LatLng): number {
  const rad = (v: number) => (v * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function routeFromProxy(payload: any): RouteResult {
  // maps-proxy يعيد routePoints بصيغة {lat,lng} وrouteSteps من Google.
  const routePoints: LatLng[] = Array.isArray(payload?.routePoints)
    ? payload.routePoints
        .filter((p: any) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
        .map((p: any) => ({ latitude: Number(p.lat), longitude: Number(p.lng) }))
    : typeof payload?.encodedPolyline === "string"
      ? decodeGooglePolyline(payload.encodedPolyline)
      : [];

  const routeSteps: RouteStep[] = Array.isArray(payload?.routeSteps)
    ? payload.routeSteps.map((s: any) => ({
        instruction: String(s.instruction ?? ""),
        distanceMeters: Number(s.distanceMeters ?? 0),
        durationSeconds: Number(s.durationSeconds ?? 0),
        maneuver: s.maneuver ? String(s.maneuver) : undefined,
      }))
    : [];

  return {
    distanceKm: Number(payload?.distanceKm ?? 0),
    durationMin: Number(payload?.durationMin ?? 0),
    routeSource: payload?.routeSource,
    routePoints,
    routeSteps,
  };
}
