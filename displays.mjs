export function createDisplays({$,bridge,onStatus}){
  let status;
  function draw(next){
    status=next;const select=$('display-select'),chosen=select.value;
    select.replaceChildren();
    const add=(value,label)=>{const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);};
    add('auto','Автоматически — внешний экран');add('window','Отдельное окно на основном экране');
    for(const display of status.displays)add(String(display.id),`${display.label || 'Экран '+display.id} · ${display.width} × ${display.height}${display.primary?' · основной':''}`);
    const pref=status.preference,value=pref.mode==='display'?String(pref.id):pref.mode;
    if(pref.mode==='display'&&!status.displays.some(d=>String(d.id)===value))add(value,`${pref.label||'Сохранённый экран'} · отключён`);
    select.value=$('screen-dialog').open && [...select.options].some(o=>o.value===chosen)?chosen:value;
    $('display-reconnect').checked=pref.reconnect!==false;
    $('display-status').textContent=status.waiting?'Экран отключён. Показ сохранён, ожидаем подключения.':status.open?`Показ: ${status.targetName}`:`Выбран: ${status.targetName}`;
    $('screen-route-label').textContent=status.waiting?'Экран отключён':status.open?status.targetName:'Экран';
    $('screen-route-btn').classList.toggle('screen-warning',status.waiting);
    onStatus(status);
  }
  const refresh=async()=>{try{draw(await bridge.displayInfo());}catch(e){$('display-status').textContent=e.message;}};
  $('screen-route-btn').addEventListener('click',async()=>{await refresh();$('screen-dialog').showModal();});
  $('display-refresh').addEventListener('click',refresh);
  $('display-apply').addEventListener('click',async()=>{
    const value=$('display-select').value;const display=status.displays.find(d=>String(d.id)===value);
    const preference={mode:['auto','window'].includes(value)?value:'display',id:display?.id??value,label:display?.label||status.preference.label||'',reconnect:$('display-reconnect').checked};
    $('display-apply').disabled=true;
    try{draw(await bridge.chooseDisplay(preference));$('display-status').textContent=status.waiting?'Ожидаем подключения выбранного экрана.':'Экран выбран. Настройка сохранена.';}
    catch(e){$('display-status').textContent=e.message;}
    finally{$('display-apply').disabled=false;}
  });
  $('display-test').addEventListener('click',async()=>{try{await bridge.testDisplay();}catch(e){$('display-status').textContent=e.message;}});
  bridge.onDisplayStatus(draw);void refresh();
}
