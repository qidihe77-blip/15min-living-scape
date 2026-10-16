// Changing the study location starts a new selection, including its walking origin.
export function resetWalkingOrigin(state){
 state.walkingOrigin=null;state.pickingWalkingOrigin=false;state.originDragAnalyzed=false;
}
