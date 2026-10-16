import test from 'node:test';import assert from 'node:assert/strict';
import {publicFacilityCategoryTree} from '../server/facility-categories.mjs';
import {reportPresentation,subtypeChartColumns,subtypeBarsHtml} from '../web/report-view.js';
import {poiIconSvg,originIconSvg} from '../web/poi-icons.js';
const tree=publicFacilityCategoryTree();
function groups(){return reportPresentation({},tree).groups;}
test('25 time bars preserve existing tree order and statuses; display transforms never change evidence or scores',()=>{
 const view=groups(),sub=view[0].subtypes[0];sub.status='reachable';sub.statusText='可达';sub.nearest={name:'测试幼儿园',durationSeconds:552,distanceMeters:650};
 const before=JSON.stringify(view),chart=subtypeChartColumns(view);
 assert.deepEqual(chart.map(g=>g.columns.length),[5,4,4,2,4,6]);
 assert.deepEqual(chart.flatMap(g=>g.columns.map(s=>s.id)),tree.categories.flatMap(g=>g.subtypes.map(s=>s.id)));
 assert.equal(chart[0].columns[0].minutes,9.2);assert.ok(Math.abs(chart[0].columns[0].heightPercent-9.2/15*100)<1e-9);
 assert.equal(chart[0].columns[1].minutes,null);assert.equal(JSON.stringify(view),before);
});
test('absence and unknown are non-duration placeholders; zero and 15-minute costs remain real values',()=>{
 const view=groups(),subs=view[0].subtypes;
 subs[0].status='reachable';subs[0].nearest={durationSeconds:0,distanceMeters:0};
 subs[1].status='reachable';subs[1].nearest={durationSeconds:900};
 subs[2].status='no_reachable_in_declared_search';subs[2].statusText='未发现';subs[2].nearest={durationSeconds:400};
 subs[3].nearest={durationSeconds:600};
 subs[4].status='reachable';subs[4].nearest={durationSeconds:NaN};
 const chart=subtypeChartColumns(view)[0].columns;
 assert.equal(chart[0].minutes,0);assert.equal(chart[1].heightPercent,100);
 assert.equal(chart[2].heightPercent,null);assert.equal(chart[3].heightPercent,null);assert.equal(chart[4].minutes,null);
 assert.match(chart[2].tooltip.note,/本次检索范围/);assert.match(chart[3].tooltip.note,/步行信息暂无/);
 assert.equal(chart[3].tooltip.rows.find(row=>row[0]==='步行时间')[1],'—');
});
test('bar tooltip names are escaped and malformed costs never become fabricated values',()=>{
 const view=groups(),sub=view[0].subtypes[0];sub.status='reachable';sub.nearest={name:'<img src=x onerror="boom">',durationSeconds:450};
 const html=subtypeBarsHtml(view);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img|NaN|Infinity/);
 assert.equal((html.match(/data-subtype-bar=/g)||[]).length,25);
});
test('POI and origin resolve page theme palettes without fixed fills, remote assets or glow filters',()=>{
 const palette={outline:'#f7fcff',glyph:'#ffffff',primary:'#167b9c'},svg=poiIconSvg({iconKey:'education',color:'#649eff',palette,selected:true,hovered:true});
 assert.match(svg,/width="32"/);assert.match(svg,/stroke="currentColor"/);assert.match(svg,/scale\(1.06\)/);
 assert.doesNotMatch(svg,/filter|feGaussianBlur|(?:fill|stroke)="#/);
 const origin=originIconSvg({palette});assert.match(origin,/color:#f7fcff/);assert.match(origin,/color:#167b9c/);
 assert.doesNotMatch(origin,/(?:fill|stroke)="#|https?:\/\/[^w]/);
 const unsafe=poiIconSvg({palette:{outline:'red" onload="boom'},color:'url(https://bad)'});assert.doesNotMatch(unsafe,/onload|https:\/\/bad/);
});
