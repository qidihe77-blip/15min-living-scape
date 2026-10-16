// Query hits and location qualifiers are not proof of the POI's own function.
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const locationQualifier=/(?:大道|大街|路|街|巷|弄|胡同|交叉口|路口|\d+号|分店|店|营业厅|办公区|校区|地铁站|地铁口|车站|附近|对面|旁)/;
export function facilitySubjectName(value){
 let text=String(value??'').normalize('NFKC');
 // Keep a functional alias such as（图书馆）, remove branch/address qualifiers.
 for(let pass=0;pass<4;pass++){const next=text.replace(/\(([^()]*)\)|【([^【】]*)】|\[([^\[\]]*)\]/g,(whole,...parts)=>locationQualifier.test(parts.slice(0,3).find(p=>p!==undefined)??'')?' ':whole);if(next===text)break;text=next;}
 return text;
}
function ownTerm(value,term){
 const text=facilitySubjectName(value),road=new RegExp(escape(term)+'[东西南北中一二三四五六七八九十0-9]{0,3}(?:大道|大街|公路|道路|街道|路|街|巷|弄|胡同)','g');
 return text.replace(road,' ').includes(term);
}
export function facilityNameProof(names,terms){
 const matches=terms.filter(term=>names.some(n=>ownTerm(n,term)));
 return{matches,incidentalMatches:terms.filter(term=>!matches.includes(term)&&names.some(n=>String(n).includes(term)))};
}
export function leisureTagMatches(tags,terms){
 const tokens=tags.flatMap(t=>String(t).normalize('NFKC').split(/[;；,，、>|/]/)).map(s=>s.trim()).filter(Boolean);
 return terms.filter(term=>tokens.some(token=>ownTerm(token,term)&&(token.endsWith(term)||new RegExp('^'+escape(term)+'(?:景区|场地|场所|设施)$').test(token))));
}
export function conflictingLeisureKind(tags){
 return tags.some(t=>/购物|零售|商店|便利店|超市|百货|药店|药房|医院|诊所|银行|金融|营业厅|电信|通讯|培训机构|培训中心|培训学校|幼儿园|小学|中学|高等院校|大学|职业教育|餐饮|美食|咖啡|茶座|酒店|宾馆|房地产|住宅|公司企业|交通设施|公交|地铁站|道路|交叉口|路口|路名|地址信息|出入口|停车场|足浴|足疗|美容|美发|汽车服务|家居建材|快递/.test(String(t)));
}
