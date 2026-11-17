export function createPreflight({$,bridge,capture,inspect,repair,canRun,isLive}) {
  let sequence=0,running=false,context=null;
  function row(title,detail,state,action){
    const item=document.createElement('div');item.className='check-row';item.dataset.state=state;
    const status=document.createElement('span');status.className='check-status';status.textContent={ok:'✓',error:'!',warning:'!',pending:'…'}[state];
    const copy=document.createElement('div');copy.className='check-copy';const name=document.createElement('strong');name.textContent=title;const text=document.createElement('small');text.textContent=detail;copy.append(name,text);item.append(status,copy);
    if(action){const button=document.createElement('button');button.className='btn btn--compact';button.textContent='Найти файл';button.addEventListener('click',async()=>{button.disabled=true;try{await action();await run();}catch(error){text.textContent=error.message;}finally{button.disabled=false;}});item.append(button);}
    $('preflight-list').append(item);
  }
  async function run(){
    if(!canRun())return;
    const token=++sequence;running=true;$('preflight-rerun').disabled=true;$('preflight-list').replaceChildren();$('preflight-summary').textContent='Проверяю материалы…';$('sound-confirm').checked=false;$('screen-confirm').checked=false;
    let problems=0;
    try{
      const state=capture();
      const files=[...(state.files||[]).map(f=>({...f,kind:'material'})),...(state.music?.playlists||[]).flatMap(list=>list.tracks.map(t=>({...t,kind:'audio',playlistId:list.id})))];
      if(!state.files?.length){row('Сценарий пуст','Добавьте презентацию, изображение или видео.','warning');problems++;}
      const result=await bridge.preflight(files.map(f=>({id:f.id,path:f.path,preparedPath:f.preparedPath})));
      if(token!==sequence)return;
      row('Экран зрителей',result.displays.length>1?`Обнаружено экранов: ${result.displays.length}. Проверьте тестовую картинку на нужном экране.`:'Найден один экран. Для отдельного показа подключите проектор или монитор.',result.displays.length>1?'ok':'warning');
      if(result.displays.length<2)problems++;
      for(let i=0;i<files.length;i++){
        if(token!==sequence)return;
        const file=files[i],available=result.files[i];
        $('preflight-summary').textContent=`Проверяю материалы: ${i+1} из ${files.length}`;
        if(!available.ok){problems++;row(file.name||file.path.split(/[\\/]/).pop(),available.message,'error',()=>repair(file));continue;}
        try{
          const detail=await inspect(file);
          if(token!==sequence)return;
          row(file.name||file.path.split(/[\\/]/).pop(),detail,'ok');
        }catch(error){if(token!==sequence)return;problems++;row(file.name||'Материал',error.message,'error',()=>repair(file));}
      }
      if(token===sequence)$('preflight-summary').textContent=problems?`Требуют внимания: ${problems}`:'Автоматическая проверка пройдена';
    }catch(error){if(token===sequence){row('Проверка не завершена',error.message,'error');$('preflight-summary').textContent='Не удалось завершить проверку';}}
    finally{if(token===sequence){running=false;$('preflight-rerun').disabled=false;}}
  }
  $('preflight-btn').addEventListener('click',()=>{if(!canRun())return;$('preflight-dialog').showModal();void run();});
  $('preflight-rerun').addEventListener('click',()=>void run());
  $('preflight-dialog').addEventListener('close',()=>{sequence++;running=false;$('preflight-rerun').disabled=false;context?.close();context=null;});
  $('test-screen').addEventListener('click',async()=>{
    if(isLive()){$('preflight-manual-status').textContent='Сначала закройте экран зрителей, чтобы тест не мешал показу.';return;}
    try{await bridge.testDisplay();$('preflight-manual-status').textContent='На внешнем экране показана тестовая картинка. Закрыть её — Esc или щелчок.';}catch(error){$('preflight-manual-status').textContent=error.message;}
  });
  $('test-sound').addEventListener('click',async()=>{
    try{
      if(context)await context.close();context=new AudioContext();await context.resume();
      const tone=context.createOscillator(),gain=context.createGain(),start=context.currentTime;
      tone.frequency.value=440;gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(.12,start+.1);gain.gain.setValueAtTime(.12,start+.6);gain.gain.linearRampToValueAtTime(0,start+.9);
      tone.connect(gain);gain.connect(context.destination);tone.start();tone.stop(start+1);
      $('preflight-manual-status').textContent='Проверьте, что сигнал слышен в колонках зала, и поставьте отметку ниже.';
    }catch(error){$('preflight-manual-status').textContent='Не удалось воспроизвести тестовый сигнал: '+error.message;}
  });
  return {get running(){return running;}};
}
