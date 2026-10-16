import{displayGeometry}from'./display-policy.js';
const frame=document.querySelector('#application-frame');
const target=new URL(location.href);target.searchParams.set('layout-frame','1');
frame.src=target.href;
function resize(){
  const mobile=matchMedia('(pointer:coarse)').matches&&matchMedia('(max-width:767px)').matches;
  const g=displayGeometry(document.documentElement.clientWidth,document.documentElement.clientHeight,mobile);
  // Native zoom rerasterizes glyphs and updates the child's devicePixelRatio.
  // Transforming the whole frame composites an already rendered page, softening text.
  Object.assign(frame.style,{width:g.width+'px',height:g.height+'px',left:g.left+'px',top:g.top+'px',zoom:String(g.scale),transform:'none'});
  window.lifeCircleDisplay=g;
}
resize();addEventListener('resize',resize);visualViewport?.addEventListener('resize',resize);
new ResizeObserver(resize).observe(document.documentElement);
addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.type!=='life-circle-location')return;
  const url=new URL(event.data.url,location.href);if(url.origin!==location.origin)return;
  url.searchParams.delete('layout-frame');history.replaceState(null,'',url);
  if(typeof event.data.title==='string')document.title=event.data.title;
});
