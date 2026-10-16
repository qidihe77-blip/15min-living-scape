// Keep logical Marker sizes/anchors; provide a larger SVG image to the SDK texture atlas.
export function retinaSvg(svg,dpr=1){
 const ratio=Math.max(2,Math.min(4,Math.ceil(Number.isFinite(dpr)?dpr:1)));
 return svg.replace(/(<svg\b[^>]*\bwidth=")(\d+)(")/,(_m,a,n,b)=>a+Number(n)*ratio+b)
  .replace(/(<svg\b[^>]*\bheight=")(\d+)(")/,(_m,a,n,b)=>a+Number(n)*ratio+b);
}
