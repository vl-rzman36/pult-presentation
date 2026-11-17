export function createEvents({$, bridge, snapshot, apply, legacy, canSwitch, setMessage}) {
  let data={version:1,selectedId:null,events:[]};
  let ready=false, busy=false;
  function report(message){setMessage(message);$('event-operation').textContent=message;}
  const selected=()=>data.events.find(e=>e.id===data.selectedId);
  function draw() {
    const select=$('event-select'); select.replaceChildren();
    for(const event of data.events){const option=document.createElement('option');option.value=event.id;option.textContent=event.name;select.append(option);}
    select.value=data.selectedId || '';
    $('event-name').value=selected()?.name || '';
    $('event-delete').disabled=data.events.length<2;
  }
  function capture() {if(ready&&!busy&&selected())selected().state=snapshot();}
  async function save() {
    if(!ready||busy)return;
    capture();
    try{await bridge.saveEvents(data);$('event-status').textContent='Сохранено';}
    catch(error){$('event-status').textContent='Ошибка сохранения';report(error.message);throw error;}
  }
  function changed(){void save().catch(()=>{});}
  async function run(task){
    if(busy)return;
    const previous=structuredClone(data);
    busy=true;$('event-select').disabled=true;document.body.classList.add('event-busy');
    const surfaces=[document.querySelector('.app-shell'),...document.querySelectorAll('dialog')];
    for(const surface of surfaces)surface.inert=true;
    try{await task();}
    catch(error){
      if(data.selectedId!==previous.selectedId){data=previous;try{await apply(structuredClone(selected().state));}catch{ready=false;}}
      report(error.message);
    }
    finally{busy=false;for(const surface of surfaces)surface.inert=false;document.body.classList.remove('event-busy');$('event-select').disabled=false;draw();}
  }
  async function switchTo(id) {
    if(!canSwitch()){draw();return;}
    await save();
    await run(async()=>{const target=data.events.find(e=>e.id===id);if(!target)return;data.selectedId=id;await apply(structuredClone(target.state));target.state=snapshot();await bridge.saveEvents(data);report(`Мероприятие «${target.name}» открыто`);});
  }
  $('event-select').addEventListener('change',event=>{void switchTo(event.target.value).catch(e=>report(e.message));});
  $('event-manage').addEventListener('click',()=>{$('event-name').value=selected()?.name || '';$('events-dialog').showModal();});
  $('event-new').addEventListener('click',async()=>{
    if(!canSwitch())return;
    const name=$('event-name').value.trim();if(!name){report('Введите название мероприятия');return;}
    try{await save();}catch{return;}
    await run(async()=>{const event={id:crypto.randomUUID(),name,state:{files:[],sections:[],music:{playlists:[]},materialsLink:'',timerLimit:0}};data.events.push(event);data.selectedId=event.id;await apply(structuredClone(event.state));event.state=snapshot();await bridge.saveEvents(data);$('events-dialog').close();report(`Создано мероприятие «${name}»`);});
  });
  $('event-copy').addEventListener('click',async()=>{
    if(!canSwitch())return;
    try{await save();}catch{return;}
    await run(async()=>{const original=selected();const event={id:crypto.randomUUID(),name:($('event-name').value.trim()||original.name)+' — копия',state:structuredClone(original.state)};data.events.push(event);data.selectedId=event.id;await apply(structuredClone(event.state));event.state=snapshot();await bridge.saveEvents(data);$('events-dialog').close();report('Копия мероприятия сохранена');});
  });
  $('event-rename').addEventListener('click',()=>{const name=$('event-name').value.trim();if(!name)return;selected().name=name;changed();draw();$('events-dialog').close();});
  $('event-delete').addEventListener('click',()=>{if(data.events.length>1&&canSwitch()){$('delete-event-name').textContent=selected().name;$('delete-event-dialog').showModal();}});
  $('event-delete-confirm').addEventListener('click',async()=>{
    if(!canSwitch()||data.events.length<2)return;
    await run(async()=>{data.events=data.events.filter(e=>e.id!==data.selectedId);data.selectedId=data.events[0].id;await apply(structuredClone(data.events[0].state));data.events[0].state=snapshot();await bridge.saveEvents(data);$('delete-event-dialog').close();$('events-dialog').close();report('Мероприятие удалено из списка. Исходные файлы сохранены.');});
  });
  $('event-export').addEventListener('click',async()=>{
    if(!canSwitch())return;
    try{await save();}catch{return;}
    await run(async()=>{report('Собираю пакет: материалы, музыка и подготовленные слайды PPTX…');const result=await bridge.exportEvent(structuredClone(selected()));report(result?`Пакет сохранён: ${result.path} · файлов: ${result.files}`:'Сохранение пакета отменено');});
  });
  $('event-import').addEventListener('click',async()=>{
    if(!canSwitch())return;
    try{await save();}catch{return;}
    await run(async()=>{report('Открываю и проверяю пакет…');const event=await bridge.importEvent();if(!event){report('Открытие пакета отменено');return;}event.id=crypto.randomUUID();if(data.events.some(e=>e.name===event.name))event.name+=' — импорт';data.events.push(event);data.selectedId=event.id;await apply(structuredClone(event.state));event.state=snapshot();await bridge.saveEvents(data);$('events-dialog').close();report('Мероприятие импортировано. Флешку можно отключить.');});
  });
  window.addEventListener('pult-music-changed',changed);
  return {changed,save,async initialize(){
    const stored=await bridge.loadEvents();
    if(stored){if(stored.version!==1||!Array.isArray(stored.events)||!stored.events.length)throw Error('Не удалось прочитать мероприятия');data=stored;}
    else {const event={id:crypto.randomUUID(),name:'Моё первое мероприятие',state:legacy()};data.events=[event];data.selectedId=event.id;}
    if(!selected())data.selectedId=data.events[0].id;
    busy=true;try{await apply(structuredClone(selected().state));}finally{busy=false;}
    ready=true;draw();await save();
  }};
}
