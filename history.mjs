// Navigation and playback positions are not edits to the event.
export function editSignature(state) {
  const value=structuredClone(state);
  for(const file of value.files||[]){delete file.page;delete file.time;}
  if(value.music){delete value.music.current;delete value.music.position;delete value.music.selectedPlaylistId;}
  return JSON.stringify(value);
}
export function createHistory({capture,apply,onChange=()=>{},limit=50}) {
  let present=null,past=[],future=[],busy=false,lastKey=null,lastAt=0;
  const notify=()=>onChange({undo:past.length>0,redo:future.length>0,busy});
  function reset(){present=structuredClone(capture());past=[];future=[];lastKey=null;notify();}
  function observe(key=null){
    if(busy)return;
    const next=structuredClone(capture());
    if(present && editSignature(next)!==editSignature(present)){
      const now=Date.now();
      if(!key || key!==lastKey || now-lastAt>1000){past.push(present);if(past.length>limit)past.shift();}
      future=[];lastKey=key;lastAt=now;
    }
    present=next;notify();
  }
  async function travel(backward){
    if(busy)return false;
    const source=backward?past:future,dest=backward?future:past;
    if(!source.length)return false;
    const target=source[source.length-1],old=structuredClone(capture());
    busy=true;notify();
    try{await apply(structuredClone(target));source.pop();dest.push(old);present=structuredClone(capture());lastKey=null;return true;}
    finally{busy=false;notify();}
  }
  return {reset,observe,undo:()=>travel(true),redo:()=>travel(false),get busy(){return busy;}};
}
