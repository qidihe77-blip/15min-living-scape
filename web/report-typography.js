export const TYPE = Object.freeze({
  family: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
  core: 32, module: 20, category: 18, body: 14, auxiliary: 13,
  coreWeight: 700, headingWeight: 600, bodyWeight: 500, auxiliaryWeight: 400, lineHeight: 1.45
});
// Module roles follow the user's A41 table. DOM and ECharts share these values.
export const FONT = Object.freeze({
  headerBrand:30,headerInfo:18,inputTitle:20,inputText:18,action:18,
  priorityCategory:15,priorityHint:12,priorityReset:13,
  legendTitle:18,legendLabel:15,legendRestore:16,heatTitle:16,heatText:14,
  mapCoordinate:12,mapAttribution:11,mapOutside:15,
  scoreMetric:20,scoreGrade:20,scoreBody:16,scoreAuxiliary:13,
  detailCategory:18,detailMetric:18,detailHint:15,detailSubtype:16,detailBody:14,detailAuxiliary:13,
  sunburstCategory:16,sunburstLabel:14,chartTooltip:13,radarCategory:16,radarLegend:12,
  specialtyCategory:18,specialtyMetric:20,specialtyBody:15,specialtyAuxiliary:15,specialtyPoi:12,
  popupTitle:16,popupCategory:13,popupBody:13,popupMetric:15,popupLabel:13,stateTitle:20,stateMetric:20,stateBody:15
});
export function installReportTypography(root=document.documentElement) {
  for(const key of ['core','module','category','body','auxiliary']) root.style.setProperty('--report-font-'+key, TYPE[key]+'px');
  root.style.setProperty('--report-font-family', TYPE.family);
  root.style.setProperty('--report-line-height', String(TYPE.lineHeight));
  for(const [key,size] of Object.entries(FONT))root.style.setProperty('--font-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),size+'px');
}
export const auxiliaryText = {fontFamily:TYPE.family,fontSize:TYPE.auxiliary,fontWeight:TYPE.auxiliaryWeight,lineHeight:TYPE.auxiliary*TYPE.lineHeight};
export const dataText = {fontFamily:TYPE.family,fontSize:TYPE.body,fontWeight:TYPE.bodyWeight,lineHeight:TYPE.body*TYPE.lineHeight};
export const categoryText = {fontFamily:TYPE.family,fontSize:TYPE.category,fontWeight:TYPE.headingWeight,lineHeight:TYPE.category*TYPE.lineHeight};
export const compactLegendText = {...auxiliaryText,fontSize:FONT.radarLegend,lineHeight:FONT.radarLegend*TYPE.lineHeight};
export const sunburstCategoryText = {...categoryText,fontSize:FONT.sunburstCategory,lineHeight:FONT.sunburstCategory*TYPE.lineHeight};
export const radarCategoryText = {...dataText,fontSize:FONT.radarCategory,lineHeight:FONT.radarCategory*TYPE.lineHeight};
export function mountTopTypography(){
 const node=document.querySelector('.analysis-time time');if(!node)return;
 const update=()=>{const font=getComputedStyle(node),root=document.documentElement;for(const[key,value]of[['--top-info-size',font.fontSize],['--top-info-family',font.fontFamily]])if(root.style.getPropertyValue(key)!==value)root.style.setProperty(key,value);};
 const observer=new ResizeObserver(update);observer.observe(node);window.addEventListener('resize',update);document.fonts.ready.then(update);update();window.addEventListener('pagehide',()=>{observer.disconnect();window.removeEventListener('resize',update);},{once:true});
}
