export function organizeDesk($){
  const tools=$('tools-dialog');
  const menuButton=$('tools-btn');
  menuButton.addEventListener('click',()=>{menuButton.setAttribute('aria-expanded','true');tools.showModal();});
  tools.addEventListener('close',()=>menuButton.setAttribute('aria-expanded','false'));
  tools.addEventListener('click',event=>{const button=event.target.closest('button');if(button && !button.hasAttribute('data-close'))tools.close();},{capture:true});
  const pane=document.querySelector('.details-pane');
  const tabs=document.createElement('div');tabs.className='details-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Правая панель');
  const output=document.createElement('div');output.id='output-panel';output.className='detail-content';output.setAttribute('role','tabpanel');output.setAttribute('aria-labelledby','output-tab');
  const notes=document.createElement('div');notes.id='notes-panel';notes.className='detail-content notes-content';notes.setAttribute('role','tabpanel');notes.setAttribute('aria-labelledby','notes-tab');
  for(const selector of ['.output-heading','#output-monitor','#output-caption','.details-top','.next-stage'])output.append(pane.querySelector(selector));
  for(const selector of ['.notes-heading','#notes','.details-foot'])notes.append(pane.querySelector(selector));
  let active='output';
  for(const [id,label] of [['output','Показ'],['notes','Заметки']]){
    const button=document.createElement('button');button.id=id+'-tab';button.type='button';button.className='detail-tab control-surface';button.textContent=label;button.setAttribute('role','tab');button.setAttribute('aria-controls',id+'-panel');button.addEventListener('click',()=>{active=id;draw();});
    button.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();event.stopPropagation();active=active==='output'?'notes':'output';draw();$(active+'-tab').focus();}});tabs.append(button);
  }
  pane.prepend(tabs,output,notes);
  function draw(){
    const hasOutput=!document.body.classList.contains('hide-output')||!document.body.classList.contains('hide-next');
    const hasNotes=!document.body.classList.contains('hide-notes');
    if(active==='notes'&&!hasNotes)active='output';if(active==='output'&&!hasOutput&&hasNotes)active='notes';
    $('output-tab').hidden=!hasOutput;$('notes-tab').hidden=!hasNotes;
    for(const id of ['output','notes']){$(id+'-panel').hidden=active!==id;$(id+'-tab').setAttribute('aria-selected',String(active===id));$(id+'-tab').tabIndex=active===id?0:-1;}
  }
  window.addEventListener('pult-interface-changed',draw);draw();
}
