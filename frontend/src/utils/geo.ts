/**
 * 经纬度距离计算与网格视图坐标换算。
 */

export interface GeoPoint {
  longitude: number;
  latitude: number;
}

export interface GeoBounds {
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
}

const EARTH_RADIUS_KM = 6371;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** 两点球面距离（km） */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 计算包含全部点的经纬度包围盒；单点或跨度极小时给出最小跨度，避免退化。
 */
export function boundsOf(points: GeoPoint[], minSpan = 0.6): GeoBounds {
  if (!points.length) {
    return { minLng: 120.5, maxLng: 122.5, minLat: 27.5, maxLat: 30.5 };
  }
  let minLng = Number.POSITIVE_INFINITY;
  let maxLng = Number.NEGATIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const p of points) {
    minLng = Math.min(minLng, p.longitude);
    maxLng = Math.max(maxLng, p.longitude);
    minLat = Math.min(minLat, p.latitude);
    maxLat = Math.max(maxLat, p.latitude);
  }
  const grow = (min: number, max: number): [number, number] => {
    const span = max - min;
    if (span >= minSpan) {
      const pad = span * 0.12;
      return [min - pad, max + pad];
    }
    const center = (min + max) / 2;
    return [center - minSpan / 2, center + minSpan / 2];
  };
  const [lng0, lng1] = grow(minLng, maxLng);
  const [lat0, lat1] = grow(minLat, maxLat);
  return { minLng: lng0, maxLng: lng1, minLat: lat0, maxLat: lat1 };
}

/**
 * 经纬度 → SVG 网格视图坐标（纬度越大越靠上，故 y 轴取反）。
 */
export function projectToGrid(
  point: GeoPoint,
  bounds: GeoBounds,
  size: { width: number; height: number },
  padding = 28,
): { x: number; y: number } {
  const spanLng = Math.max(bounds.maxLng - bounds.minLng, 0.0001);
  const spanLat = Math.max(bounds.maxLat - bounds.minLat, 0.0001);
  const innerW = Math.max(size.width - padding * 2, 1);
  const innerH = Math.max(size.height - padding * 2, 1);
  const x = padding + ((point.longitude - bounds.minLng) / spanLng) * innerW;
  const y = padding + (1 - (point.latitude - bounds.minLat) / spanLat) * innerH;
  return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
}

/** 网格视图背景：等经纬度分割线端点 */
export function gridLines(bounds: GeoBounds, cols = 6, rows = 4): Array<{ x1: number; y1: number; x2: number; y2: number }> {
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const size = { width: 720, height: 360 };
  for (let i = 0; i <= cols; i++) {
    const lng = bounds.minLng + ((bounds.maxLng - bounds.minLng) * i) / cols;
    const p1 = projectToGrid({ longitude: lng, latitude: bounds.minLat }, bounds, size, 0);
    const p2 = projectToGrid({ longitude: lng, latitude: bounds.maxLat }, bounds, size, 0);
    lines.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
  }
  for (let j = 0; j <= rows; j++) {
    const lat = bounds.minLat + ((bounds.maxLat - bounds.minLat) * j) / rows;
    const p1 = projectToGrid({ longitude: bounds.minLng, latitude: lat }, bounds, size, 0);
    const p2 = projectToGrid({ longitude: bounds.maxLng, latitude: lat }, bounds, size, 0);
    lines.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
  }
  return lines;
}
