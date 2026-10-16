import{FACILITY_ICONS}from'./poi-icons.js';
// Presentation assets only. IDs follow the existing v8 classification; no new categories.
export const SUBTYPE_GLYPHS=Object.freeze({
 kindergarten:'<circle cx="12" cy="6.5" r="3.4"/><path d="M6 19v-3.5a6 6 0 0 1 12 0V19H6Zm2 1h3v3H8zm5 0h3v3h-3Z"/>',
 primary_school:'<path fill-rule="evenodd" d="M2 10 12 3l10 7v12H2V10Zm5 2v3h3v-3H7Zm7 0v3h3v-3h-3Zm-4 5v5h4v-5h-4Z"/><path d="M11 1h2v4h-2z"/>',
 secondary_school:'<path fill-rule="evenodd" d="M2 5c4-1.6 7-.8 10 1.2C15 4.2 18 3.4 22 5v16c-3.7-1.6-7-.7-10 1-3-1.7-6.3-2.6-10-1V5Zm9 3v11h2V8h-2ZM5 9v1.7l4 1.2v-1.7L5 9Zm10 1.2v1.7l4-1.2V9l-4 1.2Zm-10 4v1.7l4 1.2v-1.7l-4-1.2Zm10 1.2v1.7l4-1.2v-1.7l-4 1.2Z"/>',
 hospital:'<path fill-rule="evenodd" d="M6 2h12v5h4v16H2V7h4V2Zm5 2v2H9v2h2v2h2V8h2V6h-2V4h-2ZM5 12v2h3v-2H5Zm11 0v2h3v-2h-3ZM5 17v2h3v-2H5Zm11 0v2h3v-2h-3Zm-6-5v11h4V12h-4Z"/>',
 community_clinic:'<path d="m1 10 11-8 11 8-2 2-9-6-9 6-2-2Z"/><path fill-rule="evenodd" d="M4 12 12 7l8 5v10H4V12Zm7-1v3H8v2h3v3h2v-3h3v-2h-3v-3h-2Z"/>',
 pharmacy:'<path fill-rule="evenodd" d="M3.7 11.4 11.4 3.7a6.3 6.3 0 0 1 8.9 8.9l-7.7 7.7a6.3 6.3 0 0 1-8.9-8.9Zm3.7-3.7-1.7 1.7 8.9 8.9 1.7-1.7-8.9-8.9Z"/>',
 market:'<path d="M4 9h16v3H4z"/><path fill-rule="evenodd" d="M3 14h18v8H3v-8Zm3 2v4h2v-4H6Zm5 0v4h2v-4h-2Zm5 0v4h2v-4h-2Z"/><circle cx="7" cy="6" r="3"/><path d="M12 8c-1-5 1-7 3-7 0 3 1 3 2 1 3 3 3 5 0 6h-5Z"/>',
 supermarket:'<path d="M1 3h4l2 3h15l-3 11H7L4 6H1V3Z"/><circle cx="9" cy="21" r="2"/><circle cx="18" cy="21" r="2"/>',
 convenience_store:FACILITY_ICONS.commerce,
 shopping_mall:'<path fill-rule="evenodd" d="M7 7V5a5 5 0 0 1 10 0v2h3l2 16H2L4 7h3Zm2 0h6V5a3 3 0 0 0-6 0v2Z"/>',
 bus_stop:FACILITY_ICONS.transport,
 metro_station:'<path fill-rule="evenodd" d="M7 1h10a4 4 0 0 1 4 4v11a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V5a4 4 0 0 1 4-4ZM6 6v6h12V6H6Zm.5 9v2h3v-2h-3Zm8 0v2h3v-2h-3Z"/><path d="m6 19 3 1-3 4H2l4-5Zm12 0 4 5h-4l-3-4 3-1Z"/>',
 residential_eldercare:'<path d="m1 9 11-7 11 7-2 3-9-6-9 6-2-3Z"/><path fill-rule="evenodd" d="M4 12 12 7l8 5v11H4V12Zm8 8 4-4c3-3-1-6-4-3-3-3-7 0-4 3l4 4Z"/>',
 day_care:FACILITY_ICONS.eldercare,
 senior_activity:'<circle cx="12" cy="5" r="3"/><circle cx="4" cy="9" r="2.5"/><circle cx="20" cy="9" r="2.5"/><path d="M7 21v-8a5 5 0 0 1 10 0v8H7Zm-6-1v-5a3 3 0 0 1 4-2v7H1Zm18 0v-7a3 3 0 0 1 4 2v5h-4Z"/>',
 park_green:FACILITY_ICONS.leisure,
 sports_venue:'<path d="M1 8h3v8H1V8Zm4-3h4v14H5V5Zm4 5h6v4H9v-4Zm6-5h4v14h-4V5Zm5 3h3v8h-3V8Z"/>',
 culture_venue:'<path d="m2 8 10-6 10 6H2Z"/><path d="M2 20h20v3H2zm3-10h3v8H5zm5.5 0h3v8h-3zm5.5 0h3v8h-3z"/>',
});
export const SPECIALTY_COLORS=Object.freeze({market:'#EA8E34',pharmacy:'#08A887',primary_school:'#416DE1'});
export function subtypeIconImage(id,color='#fff'){const face=SUBTYPE_GLYPHS[id];if(!face)return null;const fill=/^#[\da-f]{3,8}$/i.test(color)?color:'#fff';return'data:image/svg+xml;charset=UTF-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><g data-subtype-face="'+id+'" fill="'+fill+'" stroke="none">'+face+'</g></svg>');}
const markerImages=new Map();
// Cards/legends use the unmodified transparent glyph. Only the map draws a
// separate circular frame, rasterized for WebGL texture-atlas compatibility.
export function specialtyMarkerImage(id,color=SPECIALTY_COLORS[id],opacity=1){
 const fill=/^#[\da-f]{3,8}$/i.test(color)?color:'#718B9E',key=[id,fill,opacity].join(':');if(markerImages.has(key))return markerImages.get(key);
 const face=SUBTYPE_GLYPHS[id]??'',svg='<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90" viewBox="0 0 30 30" opacity="'+opacity+'"><circle cx="15" cy="15" r="13.8" fill="#FFFFFF" stroke="'+fill+'" stroke-width="1.2"/><g transform="translate(6 6) scale(.75)" fill="'+fill+'" stroke="none">'+face+'</g></svg>';
 let url='data:image/svg+xml;charset=UTF-8,'+encodeURIComponent(svg);
 if(globalThis.document&&globalThis.Path2D&&globalThis.DOMParser){const canvas=document.createElement('canvas');canvas.width=90;canvas.height=90;const c=canvas.getContext('2d');if(c){c.scale(3,3);c.globalAlpha=opacity;c.fillStyle='#FFFFFF';c.strokeStyle=fill;c.lineWidth=1.2;c.beginPath();c.arc(15,15,13.8,0,Math.PI*2);c.fill();c.stroke();c.translate(6,6);c.scale(.75,.75);c.fillStyle=fill;const root=new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg">'+face+'</svg>','image/svg+xml');for(const n of root.documentElement.children){if(n.tagName==='path')c.fill(new Path2D(n.getAttribute('d')),n.getAttribute('fill-rule')==='evenodd'?'evenodd':'nonzero');else if(n.tagName==='circle'){c.beginPath();c.arc(Number(n.getAttribute('cx')),Number(n.getAttribute('cy')),Number(n.getAttribute('r')),0,Math.PI*2);c.fill();}}url=canvas.toDataURL('image/png');}}
 if(markerImages.size>=64)markerImages.delete(markerImages.keys().next().value);markerImages.set(key,url);return url;
}
