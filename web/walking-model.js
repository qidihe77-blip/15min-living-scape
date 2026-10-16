export const WALKING80_MODEL='walking80-v1';
export const BAIDU_TIME_MODEL='baidu-duration-v1';
export function walkingModel(id=BAIDU_TIME_MODEL){
 if(![WALKING80_MODEL,BAIDU_TIME_MODEL].includes(id))throw new TypeError('Unknown walking model.');
 return id===WALKING80_MODEL?{id,speedMetersPerMinute:80,distanceLimitMeters:1200,thresholdSeconds:900,durationMeaning:'estimate_from_provider_walking_distance'}
  :{id,thresholdSeconds:900,durationMeaning:'provider_returned_duration'};
}
export function modelRoute(route,id){
 if(id!==WALKING80_MODEL)return route;
 const valid=route?.routeStatus==='ok'&&Number.isFinite(route.distanceMeters)&&route.distanceMeters>=0&&Number.isFinite(route.durationSeconds)&&route.durationSeconds>=0;
 return{...route,walkingModelId:id,modelDurationSeconds:valid?route.distanceMeters*60/80:null};
}
// Raw provider seconds always remain in durationSeconds. Never substitute estimates there.
export function decisionSeconds(route,expectedModel=route?.walkingModelId??BAIDU_TIME_MODEL){
 if(!route||!Number.isFinite(route.durationSeconds)||route.durationSeconds<0)return null;
 if(expectedModel===BAIDU_TIME_MODEL)return route.durationSeconds;
 if(expectedModel!==WALKING80_MODEL||route.walkingModelId!==expectedModel||!Number.isFinite(route.distanceMeters)||route.distanceMeters<0)return null;
 const expected=route.distanceMeters*60/80;
 return Number.isFinite(route.modelDurationSeconds)&&Math.abs(route.modelDurationSeconds-expected)<1e-6?route.modelDurationSeconds:null;
}
export function withinWalkingLimit(route){const t=decisionSeconds(route);return t!==null&&t<=900;}
export function walkingTimeLabel(route){return route?.walkingModelId===WALKING80_MODEL?'80m/min估算':'百度返回';}
