// The same-origin frame keeps SDK hit testing, chart tooltips and drag coordinates native.
if(parent!==window&&new URL(location.href).searchParams.get('layout-frame')==='1'){
  const notify=()=>parent.postMessage({type:'life-circle-location',url:location.href,title:document.title},location.origin);
  for(const method of['replaceState','pushState']){const original=history[method].bind(history);history[method]=(...args)=>{const result=original(...args);notify();return result;};}
  addEventListener('popstate',notify);addEventListener('load',notify);
  // Internal page navigation stays in this frame rather than nesting another shell.
  document.addEventListener('click',event=>{const a=event.target.closest?.('a[href]');if(!a||a.target||a.hasAttribute('download'))return;const u=new URL(a.href,location.href);if(u.origin===location.origin&&['/','/console.html','/index.html','/inspection.html'].includes(u.pathname)){u.searchParams.set('layout-frame','1');a.href=u.href;}});
}
