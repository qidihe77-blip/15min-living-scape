// Polygon membership names a display state; only bound Walking costs confirm access.
export function facilityAccessState({hasRange,inside,classified,validRoute,reachable}){
 const accessState=!validRoute||!classified?'pending_verification':!hasRange?'pending_range_membership':reachable?inside?'inside_reachable':'outside_reachable':inside?'inside_over_threshold':'outside_over_threshold';
 const accessStateText={inside_reachable:'圈内可达',inside_over_threshold:'圈内超时',outside_reachable:'圈外可达',outside_over_threshold:'圈外超时',pending_verification:'步行数据未知',pending_range_membership:'边界未知'}[accessState];
 return{accessState,accessStateText};
}
