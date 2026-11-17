function resolveDisplay(displays, primaryId, preference={mode:'auto'}) {
  const primary=displays.find(d=>d.id===primaryId)||displays[0];
  if(preference.mode==='window')return {display:primary,fullscreen:false,missing:false};
  if(preference.mode==='display'){
    let display=displays.find(d=>String(d.id)===String(preference.id));
    if(!display && preference.label){const matches=displays.filter(d=>d.label===preference.label);if(matches.length===1)display=matches[0];}
    return {display,fullscreen:true,missing:!display};
  }
  const external=displays.find(d=>d.id!==primaryId);
  return {display:external||primary,fullscreen:Boolean(external),missing:false};
}
module.exports={resolveDisplay};
