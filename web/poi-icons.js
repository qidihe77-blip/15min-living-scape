// Original project SVG strokes, extended locally; no third-party icon fetches.
export const POI_GLYPHS = Object.freeze({
  education: '<path d="m3 9 9-5 9 5-9 5-9-5Z"/><path d="M7 12v5c3 3 7 3 10 0v-5m4-3v7"/>',
  school: '<path d="M4 21V8l8-5 8 5v13H4Zm5 0v-6h6v6M8 9h1m6 0h1M8 12h1m6 0h1"/>',
  childcare: '<circle cx="12" cy="8" r="4"/><path d="M6 21v-3a6 6 0 0 1 12 0v3M10 9h4"/>',
  medical: '<path d="M12 4v16M4 12h16"/>',
  hospital: '<path d="M4 21V8h16v13H4ZM8 8V3h8v5M12 10v6m-3-3h6M10 21v-3h4v3"/>',
  pharmacy: '<path d="m7 17 10-10a4.2 4.2 0 0 0-6-6L1 11a4.2 4.2 0 0 0 6 6Z" transform="translate(3 3)"/><path d="m8 8 8 8"/>',
  commerce: '<path d="M4 9h16l-1 11H5L4 9ZM3 9l3-5h12l3 5M9 13v4m6-4v4"/>',
  market: '<path d="M3 10h18L18 4H6l-3 6Zm2 0v11h14V10M8 21v-6h8v6"/>',
  shop: '<path d="m3 5 2 2 2 10h12l2-8H6M9 21h.01M18 21h.01"/>',
  mall: '<path d="M4 21V5h16v16H4ZM8 8h1m6 0h1M8 12h1m6 0h1M9 21v-5h6v5"/>',
  transport: '<path d="M5 18V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v12H5ZM5 11h14M8 15h.01m8 0h.01M7 18v3m10-3v3"/>',
  bus: '<path d="M5 18V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v12H5ZM5 11h14M8 15h.01m8 0h.01M7 18v3m10-3v3"/>',
  metro: '<rect x="6" y="3" width="12" height="15" rx="4"/><path d="M6 10h12M9 14h.01m6 0h.01M8 18l-3 4m11-4 3 4M7 21h10"/>',
  eldercare: '<circle cx="12" cy="6" r="3"/><path d="M7 17v-2a5 5 0 0 1 10 0v2M3 14v4l5 3h8l5-3v-4M3 17l5 1m13-1-5 1"/>',
  leisure: '<path d="m12 3 7 8h-4l5 6h-6v4h-4v-4H4l5-6H5l7-8Z"/>',
  park: '<path d="m12 3 7 8h-4l5 6h-6v4h-4v-4H4l5-6H5l7-8Z"/>',
  square: '<path d="M3 20h18M6 20l2-9h8l2 9M12 3v8m-4-6 4 3 4-3"/>',
  sports: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M6 5c8 4 8 10 0 14m12-14c-8 4-8 10 0 14"/>',
  fitness: '<path d="M3 9v6m3-9v12m0-6h12m0-6v12m3-9v6"/>',
  culture: '<path d="M3 20h18M5 20V9h14v11M3 9h18L12 4 3 9ZM8 13v3m4-3v3m4-3v3"/>',
  library: '<path d="M3 5c4-2 7-1 9 1 2-2 5-3 9-1v15c-4-2-7-1-9 1-2-2-5-3-9-1V5Zm9 1v15"/>',
});
export function poiGlyph(iconKey, fallback = 'medical') {
  return POI_GLYPHS[iconKey] ?? POI_GLYPHS[fallback] ?? POI_GLYPHS.medical;
}
// Shared filled silhouettes, following the supplied cap/health/store/bus/tree reference.
// These are icon assets, not a second facility classification or color mapping.
export const FACILITY_ICONS = Object.freeze({
  education:'<path d="M2 9 12 4l10 5-10 5L2 9Z"/><path d="M6 13.3 12 16l6-2.7v4.5c-3.8 2.9-8.2 2.9-12 0v-4.5Z"/><path d="M20 10h1.5v6H20z"/><circle cx="20.75" cy="17" r="1.3"/>',
  medical:'<path fill-rule="evenodd" d="M12 21 3.7 13C-2 6.9 5.4.1 12 6.4 18.6.1 26 6.9 20.3 13L12 21Zm-1.3-12v3H7.5v2.6h3.2v3h2.6v-3h3.2V12h-3.2V9h-2.6Z"/>',
  commerce:'<path d="M3 9 6 3h12l3 6H3Z"/><path fill-rule="evenodd" d="M4 11h16v10H4V11Zm3 2v5h6v-5H7Zm8 0v8h3v-8h-3Z"/>',
  transport:'<path fill-rule="evenodd" d="M7 2h10a3 3 0 0 1 3 3v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a3 3 0 0 1 3-3Zm1 2v1h8V4H8Zm-1 3v7h10V7H7Zm-.5 9v2h3v-2h-3Zm8 0v2h3v-2h-3Z"/><path d="M5 20h4v2H5zm10 0h4v2h-4zM2 7h2v5H2zm18 0h2v5h-2z"/>',
  eldercare:'<circle cx="12" cy="5.5" r="3"/><path d="M7.5 15v-2.3a4.5 4.5 0 0 1 9 0V15h-9Z"/><path d="M2 12.5c1.2-.6 2.5 0 2.8 1.3l.7 3.3L10 19v2l-6.5-2.8L2 12.5Zm20 0c-1.2-.6-2.5 0-2.8 1.3l-.7 3.3L14 19v2l6.5-2.8 1.5-5.7ZM7 16h3v2H7zm7 0h3v2h-3z"/>',
  leisure:'<path d="m12 2 5.5 7h-3L20 17H4l5.5-8h-3L12 2Z"/><path d="M10 18h4v4h-4z"/>',
});
export function facilityGlyph(iconKey,fallback='medical') {
  const key=Object.hasOwn(FACILITY_ICONS,iconKey)?iconKey:Object.hasOwn(FACILITY_ICONS,fallback)?fallback:'medical';
  return '<g class="facility-face" data-facility-face="'+key+'" fill="currentColor" stroke="none">'+FACILITY_ICONS[key]+'</g>';
}
const svgColor = (value, fallback='currentColor') => typeof value==='string' && /^(?:#[\da-f]{3,8}|(?:rgb|rgba|color)\([\da-z.,%\s/+\-]+\)|transparent|currentColor)$/i.test(value.trim()) ? value.trim() : fallback;
// An SVG used as an Icon image cannot inherit page CSS. Its colors are resolved
// from the page's theme tokens by the caller, then supplied as currentColor.
export function poiIconSvg({iconKey,fallback,color='currentColor',status='unknown',important=true,selected=false,hovered=false,outside=false,dotDiameter=9,palette={}}) {
  const foreground=svgColor(color),outline=svgColor(palette.outline),glyph=svgColor(palette.glyph),opacity=status==='unknown'?.84:1;
  if(!important&&!selected){
    const diameter=Number.isFinite(dotDiameter)?Math.max(7,Math.min(10,dotDiameter)):9;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" data-marker-kind="dot" style="color:${foreground}"><g transform="translate(9 9) scale(${hovered?1.07:1}) translate(-9 -9)"><circle cx="9" cy="9" r="${diameter/2+2}" fill="currentColor" opacity=".05"/><circle cx="9" cy="9" r="${diameter/2}" fill="currentColor" opacity="${opacity}"/><circle cx="9" cy="9" r="${diameter/2}" style="color:${outline}" fill="none" stroke="currentColor" stroke-width=".6" opacity=".8"/></g></svg>`;
  }
  const scale=hovered?1.06:selected?1.035:1;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 36 36" data-marker-kind="feature" style="color:${foreground}"><style>.shape{transform-origin:18px 18px;transform:scale(${scale});transition:transform 200ms ease}@media(prefers-reduced-motion:reduce){.shape{transform:none;transition:none}}</style>`
    +(selected||outside?`<circle cx="18" cy="18" r="17.4" ${outside?'data-range-state="outside_reachable" stroke-dasharray="2 2" ':''}style="color:${outside?foreground:outline}" fill="none" stroke="currentColor" stroke-width=".8"/>`:'')
    +`<g class="shape"><circle cx="18" cy="18" r="16.9" fill="currentColor" opacity=".06"/><circle cx="18" cy="18" r="15.8" fill="currentColor" opacity="${opacity}"/><circle cx="18" cy="18" r="15.8" style="color:${outline}" fill="none" stroke="currentColor" stroke-width="1"/><g transform="translate(7.5 7.5) scale(.875)" style="color:${glyph}">${facilityGlyph(iconKey,fallback)}</g></g></svg>`;
}
export function originIconSvg({palette={}}={}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 30 38" style="color:${svgColor(palette.primary)}"><defs><linearGradient id="lake" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#38bcd1"/><stop offset="1" stop-color="#088fae"/></linearGradient><linearGradient id="lake-edge" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#BEF8FF"/><stop offset=".45" stop-color="#4ACDDF"/><stop offset="1" stop-color="#59BAE6"/></linearGradient><filter id="lake-glow" x="-35%" y="-25%" width="170%" height="155%"><feGaussianBlur stdDeviation="1.25"/></filter></defs><path d="M15 3a11 11 0 0 0-11 11c0 8 11 20 11 20s11-12 11-20A11 11 0 0 0 15 3Z" fill="none" stroke="url(#lake-edge)" stroke-width="4" opacity=".72" filter="url(#lake-glow)"/><path d="M15 3a11 11 0 0 0-11 11c0 8 11 20 11 20s11-12 11-20A11 11 0 0 0 15 3Z" fill="url(#lake)" stroke="url(#lake-edge)" stroke-width="1.5"/><path d="M15 3a11 11 0 0 0-11 11c0 8 11 20 11 20s11-12 11-20A11 11 0 0 0 15 3Z" fill="none" style="color:${svgColor(palette.outline)}" stroke="currentColor" stroke-width=".65" opacity=".8"/><circle cx="15" cy="14" r="4" style="color:${svgColor(palette.glyph)}" fill="currentColor"/></svg>`;
}
