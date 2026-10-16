// Curved shared edges have zero mean horizontal displacement. Each filled
// segment therefore keeps the same area as its exact percentage-width box.
export function gapStackShapes(fractions,width,height){
 const values=fractions.map(v=>Math.max(0,Number(v)||0)),total=values.reduce((a,b)=>a+b,0);
 if(!(total>0&&width>0&&height>0))return[];
 const edges=[{x:0,bend:0}];let x=0;
 for(let i=0;i<values.length;i++){x+=values[i]/total*width;edges.push({x:i===values.length-1?width:x,bend:i===values.length-1?0:Math.min(height*.22,values[i]/total*width/4,values[i+1]/total*width/4)});}
 return values.map((v,i)=>{const l=edges[i],r=edges[i+1],top=e=>e.x-e.bend,control=e=>e.x+2*e.bend;
  return{left:l,right:r,area:v/total*width*height,path:`M${top(l)} 0H${top(r)}Q${control(r)} ${height/2} ${top(r)} ${height}H${top(l)}Q${control(l)} ${height/2} ${top(l)} 0Z`};
 });
}
