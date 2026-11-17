export function createInterface($) {
  const key='pult.interface.v1';
  const labels={notes:'Заметки ведущего',output:'Монитор экрана зрителей',next:'Предпросмотр следующего слайда',thumbnails:'Лента страниц',timer:'Таймер',music:'Музыкальный плеер',qr:'QR-код материалов',remote:'Пульт на телефоне',prepare:'Режим подготовки'};
  const full=Object.fromEntries(Object.keys(labels).map(k=>[k,true]));
  const simple={...full,notes:false,next:false,thumbnails:false,timer:false,qr:false,remote:false,prepare:false};
  let state={mode:'full',...full};
  try{const saved=JSON.parse(localStorage.getItem(key)||'{}');state.mode=saved.mode==='simple'?'simple':'full';for(const k of Object.keys(labels))if(typeof saved[k]==='boolean')state[k]=saved[k];}catch{}
  const list=$('interface-options');
  for(const [id,label] of Object.entries(labels)){
    const row=document.createElement('label');row.className='setting-option';
    const input=document.createElement('input');input.type='checkbox';input.id='ui-'+id;
    const text=document.createElement('span');text.textContent=label;row.append(input,text);list.append(row);
    input.addEventListener('change',()=>{state[id]=input.checked;draw();});
  }
  function draw(){
    document.body.classList.toggle('simple-interface',state.mode==='simple');
    document.body.classList.toggle('no-details',!state.notes&&!state.output&&!state.next);
    for(const k of Object.keys(labels)){document.body.classList.toggle('hide-'+k,!state[k]);$('ui-'+k).checked=state[k];}
    $('interface-mode').value=state.mode;
    // Hidden controls must never leave music playing without an accessible pause.
    if(!state.music)$('presentations-tab').click();
    localStorage.setItem(key,JSON.stringify(state));
    window.dispatchEvent(new Event('pult-interface-changed'));
  }
  $('interface-mode').addEventListener('change',()=>{const mode=$('interface-mode').value;state={mode,...(mode==='simple'?simple:full)};draw();});
  $('interface-reset').addEventListener('click',()=>{state={mode:'full',...full};draw();});
  $('settings-btn').addEventListener('click',()=>$('settings-dialog').showModal());
  draw();return {visible:k=>state[k]};
}
