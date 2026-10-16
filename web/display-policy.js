// Preserve the desktop design width and scale both axes equally. Height follows
// the browser content area, which excludes tabs, address bars and the taskbar.
export const DESKTOP_CANVAS=Object.freeze({width:1920,height:1080});
export function displayGeometry(width,height,mobile=false){
  const w=Math.max(1,width),h=Math.max(1,height),scale=mobile?1:w/DESKTOP_CANVAS.width;
  return{width:mobile?w:DESKTOP_CANVAS.width,height:h/scale,scale,left:0,top:0,mobile};
}
