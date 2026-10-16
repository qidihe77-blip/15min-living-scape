// Provider step geometry only. Disconnected steps stay disconnected.
export function validRoutePoint(point) {
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)
    && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
}
export function parseBaiduStepGeometry(steps) {
  if (!Array.isArray(steps) || !steps.length) return { geometry: null, geometryStatus: 'missing_path' };
  const lines = [];
  for (const step of steps) {
    if (typeof step?.path !== 'string' || !step.path.trim()) return { geometry: null, geometryStatus: 'missing_path' };
    const pairs = step.path.trim().replace(/;$/, '').split(';').map((pair) => pair.split(',').map((n) => n.trim()));
    if (pairs.some((pair) => pair.length !== 2 || pair.some((n) => !n)
      || !validRoutePoint(pair.map(Number)))) return { geometry: null, geometryStatus: 'invalid_path' };
    const points = pairs.map((pair) => pair.map(Number)).filter((p, i, list) => !i
      || p[0] !== list[i - 1][0] || p[1] !== list[i - 1][1]);
    if (points.length < 2) return { geometry: null, geometryStatus: 'invalid_path' };
    const previous = lines.at(-1);
    if (previous && previous.at(-1)[0] === points[0][0] && previous.at(-1)[1] === points[0][1]) previous.push(...points.slice(1));
    else lines.push(points);
  }
  return { geometry: { type: lines.length === 1 ? 'LineString' : 'MultiLineString',
    coordinates: lines.length === 1 ? lines[0] : lines }, geometryStatus: 'provider_path',
    geometryCompleteness:lines.length===1?'continuous_provider_steps':'disconnected_provider_steps' };
}
