import * as pdfjs from './node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import { createMusicController } from './music.mjs';
import { createTimer } from './timer.mjs';
import { createEvents } from './events.mjs';
import { createHistory, editSignature } from './history.mjs';
import { createInterface } from './interface.mjs';
import { createPreflight } from './preflight.mjs';
import { createDisplays } from './displays.mjs';
import { organizeDesk } from './desk-layout.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).toString();

const $ = id => document.getElementById(id);
const docs = [];
let sections = [];
let currentSectionId = null;
let events;
let history;
let editingSectionId = null;
let draggedItem = null;
let selectedId = null;
let activeId = null;
let detachedActive = null;
let audienceOpen = false;
let displayDisconnected = false;
let placeholderOn = false;
let qrOn = false;
let stageImage = null;
let materialsQr = null;
let renderSequence = 0;
let thumbObserver = null;
let thumbDocId = null;
let displayedDocId = null;
let mediaDocId = null;
let lastMediaSync = 0;
let preparing = false;
let activePage = null;
let publishSequence = 0;
let restoring = true;
let notesDocId = null;
let advancing = false;
let editingVideoId = null;
const timer = createTimer($);
let placeholder = { color: '#334b73', text: 'Скоро продолжим', backdrop: null };

const stateKey = 'pult.presentation.state.v1';
class LocalPdfAssets {
  async fetch({ kind, filename }) {
    return new Uint8Array(await window.presentation.readPdfAsset(kind, filename));
  }
}
function savedState() { try { return JSON.parse(localStorage.getItem(stateKey) || '{}'); } catch { return {}; } }
function snapshot() {
  let musicState={};try{musicState=JSON.parse(localStorage.getItem('pult.music.state.v1')||'{}');}catch{}
  return { files:docs.map(d=>({id:d.id,path:d.path,name:d.name,page:d.page,time:d.mediaState?.time||0,sectionId:d.sectionId,notes:d.notes||'',preparedPath:d.preparedPath||null,sourceType:d.sourceType,videoOptions:d.videoOptions})),sections:structuredClone(sections),placeholder:structuredClone(placeholder),materialsLink:$('materials-link').value,music:musicState,timerLimit:Number($('timer-limit').value)||0 };
}
function persist(historyKey=null) {
  if(restoring)return;
  // Keep legacy session readable by the previous app; the complete event lives on disk.
  const state=snapshot();
  localStorage.setItem(stateKey,JSON.stringify({files:state.files,placeholder:state.placeholder,materialsLink:state.materialsLink}));
  history?.observe(typeof historyKey==='string'?historyKey:null);
  events?.changed();
}
function selected() { return docs.find(d => d.id === selectedId) || null; }
function active() { return docs.find(d => d.id === activeId) || (detachedActive?.id===activeId ? detachedActive : null); }
function setMessage(message) { $('message').textContent = message; }
const music = createMusicController({ bridge: window.presentation, $, setMessage, isVideoPlaying: () => !$('video-player').paused });
function initSidebar() {
  const key = 'pult.sidebar.state.v1';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(key) || '{}'); } catch { /* Use default width. */ }
  const workspace = document.querySelector('.workspace');
  const handle = $('sidebar-resize');
  const expand = $('sidebar-expand');
  let width = Number(saved.width) || (window.innerWidth <= 1250 ? 220 : 272);
  let normalWidth = Number(saved.normalWidth) || width;
  let tab = saved.tab === 'music' ? 'music' : 'presentations';
  const maxWidth = () => Math.min(600, Math.max(195, window.innerWidth - (window.innerWidth <= 1250 ? 630 : 700)));
  const save = () => localStorage.setItem(key, JSON.stringify({ width, normalWidth, tab }));
  function setWidth(value, persist = true) {
    width = Math.max(195, Math.min(maxWidth(), Math.round(value)));
    document.documentElement.style.setProperty('--library-width', `${width}px`);
    expand.title = width > normalWidth + 20 ? 'Сузить панель' : 'Расширить панель';
    expand.setAttribute('aria-label', expand.title);
    if (persist) save();
  }
  function showTab(next) {
    tab = next;
    $('presentations-panel').hidden = next !== 'presentations';
    $('music-panel').hidden = next !== 'music';
    for (const [id, value] of [['presentations-tab', 'presentations'], ['music-tab', 'music']]) {
      const button = $(id);
      button.classList.toggle('active', value === next);
      button.setAttribute('aria-selected', String(value === next));
    }
    save();
  }
  $('presentations-tab').addEventListener('click', () => showTab('presentations'));
  $('music-tab').addEventListener('click', () => showTab('music'));
  expand.addEventListener('click', () => {
    const target = Math.min(520, maxWidth());
    if (width >= target - 8 && normalWidth < width) setWidth(normalWidth);
    else { normalWidth = width; setWidth(target); }
  });
  let startX = 0, startWidth = 0, dragging = false;
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragging = true;
    startX = event.clientX; startWidth = width;
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('dragging'); workspace.classList.add('resizing');
  });
  window.addEventListener('pointermove', event => {
    if (!dragging) return;
    setWidth(startWidth + event.clientX - startX, false);
  });
  function endResize() {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging'); workspace.classList.remove('resizing');
    normalWidth = width; save();
  }
  window.addEventListener('pointerup', endResize);
  window.addEventListener('pointercancel', endResize);
  handle.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    setWidth(width + (event.key === 'ArrowRight' ? 20 : -20));
    normalWidth = width; save();
  });
  window.addEventListener('resize', () => setWidth(width));
  setWidth(width, false); showTab(tab);
}
initSidebar();
const interfaceSettings=createInterface($);
organizeDesk($);
createDisplays({$,bridge:window.presentation,onStatus:status=>{
  const lost=!displayDisconnected&&status.waiting;displayDisconnected=status.waiting;
  if(lost){music.stop();pauseCurrentMedia();timer.pause();setMessage('Экран отключён. Видео и музыка на паузе. Подключите экран или выберите другой.');}
  if(status.reason==='restored')setMessage('Экран подключён, показ восстановлен. Видео и музыку можно продолжить вручную.');
  updateOutput();
}});
window.addEventListener('pult-interface-changed',()=>{
  if(!interfaceSettings.visible('music'))music.stop();
});
function videoOptions(value = {}) {
  return { autoplay: Boolean(value.autoplay), loop: Boolean(value.loop), volume: Number.isFinite(value.volume) ? Math.max(0,Math.min(1,value.volume)) : 1, end: ['hold','placeholder','next'].includes(value.end) ? value.end : 'hold' };
}
function scenario() { return sections.flatMap(section => docs.filter(doc => doc.sectionId === section.id)); }
function following(doc = selected()) { const list=scenario(); const index=list.indexOf(doc); return index < 0 ? null : list[index+1] || null; }
async function nextMaterial({ live = audienceOpen && !preparing && selectedId === activeId } = {}) {
  if(advancing || restoring || document.body.classList.contains('event-busy'))return;
  const next=following();
  if(!next){setMessage('Сценарий завершён');return;}
  if(next.missing){setMessage(`Следующий материал «${next.name}» не найден. Восстановите файл или выберите другой материал.`);return;}
  advancing=true;
  try {
    pauseCurrentMedia(); selectedId=next.id; currentSectionId=next.sectionId;
    next.page=1;if(next.mediaState)next.mediaState.time=0;
    persist(); await refresh();
    if(live && audienceOpen && selectedId===next.id)await showSelected();
  } finally { advancing=false; updateHeader(selected()); }
}
$('next-material').addEventListener('click',()=>void nextMaterial());
$('video-settings').addEventListener('click',()=>{
  const doc=selected();if(doc?.kind!=='video')return;
  editingVideoId=doc.id; const options=doc.videoOptions;
  $('video-settings-name').textContent=doc.name;
  $('video-autoplay').checked=options.autoplay;$('video-repeat').checked=options.loop;
  $('video-volume').value=String(Math.round(options.volume*100));$('video-end').value=options.end;
  $('video-end').disabled=options.loop;$('video-dialog').showModal();
});
$('video-repeat').addEventListener('change',()=>{$('video-end').disabled=$('video-repeat').checked;});
$('video-form').addEventListener('submit',event=>{
  event.preventDefault();const doc=docs.find(d=>d.id===editingVideoId);if(!doc)return;
  doc.videoOptions=videoOptions({autoplay:$('video-autoplay').checked,loop:$('video-repeat').checked,volume:Number($('video-volume').value)/100,end:$('video-end').value});
  if(mediaDocId===doc.id){videoPlayer.volume=doc.videoOptions.volume;videoPlayer.loop=doc.videoOptions.loop;}
  persist();$('video-dialog').close();setMessage('Настройки видео сохранены');
});
function extension(path) { return path.slice(path.lastIndexOf('.')).toLowerCase(); }
function mimeFor(ext) { return ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'; }
function kindFor(ext) { return ['.mp4', '.webm', '.mov'].includes(ext) ? 'video' : ['.mp3', '.m4a', '.wav', '.ogg'].includes(ext) ? 'audio' : ext === '.pdf' ? 'pdf' : 'image'; }
function mediaPlayer() { return $('video-player'); }
function fileSummary(doc) { if(doc.missing)return 'Файл недоступен'; return doc.kind === 'video' ? 'Видео' : `${doc.page} / ${doc.pages}`; }
function bufferToDataUrl(bytes, mime) {
  const blob = new Blob([bytes], { type: mime });
  return URL.createObjectURL(blob);
}

async function loadFile(filePath, savedPage = 1, savedTime = 0, saved = {}) {
  if (kindFor(extension(filePath)) === 'audio') throw new Error('Аудио добавляется через кнопку «Музыка»');
  const file = await window.presentation.readFile(saved.preparedPath || filePath);
  const doc = { id: crypto.randomUUID(), path: filePath, name: file.name, page: 1, pages: 1, type: file.type, kind: kindFor(file.type), pdf: null, imageUrl: null, mediaUrl: file.mediaUrl || null, mediaState: { time: Math.max(0, Number(savedTime) || 0), playing: false }, renderCache: new Map() };
  doc.id=saved.id || doc.id; doc.name=saved.name || doc.name; doc.notes=saved.notes || ''; doc.sectionId=sections.some(s=>s.id===saved.sectionId)?saved.sectionId:(currentSectionId || sections[0]?.id); doc.preparedPath=saved.preparedPath || null;
  doc.videoOptions = videoOptions(saved.videoOptions);
  doc.sourceType = saved.sourceType || file.sourceType || file.type;
  if (file.type === '.pdf') {
    const bytes = new Uint8Array(file.bytes);
    const task = pdfjs.getDocument({
      data: bytes,
      wasmUrl: 'local/wasm/',
      cMapUrl: 'local/cmaps/',
      standardFontDataUrl: 'local/standard_fonts/',
      BinaryDataFactory: LocalPdfAssets,
      useWorkerFetch: false,
    });
    doc.pdf = await task.promise;
    doc.pages = doc.pdf.numPages;
  } else if (doc.kind === 'image') doc.imageUrl = bufferToDataUrl(file.bytes, mimeFor(file.type));
  doc.page = Math.max(1, Math.min(doc.pages, Number(savedPage) || 1));
  docs.push(doc);
  if (!selectedId) selectedId = doc.id;
  if (!activeId) activeId = doc.id;
  persist();
  drawLibrary();
  return doc;
}

async function openFiles() {
  if(restoring || document.body.classList.contains('event-busy'))return;
  const paths = await window.presentation.openFiles();
  for (const filePath of paths) {
    try {
      if (extension(filePath) === '.pptx') setMessage('Подготавливаю PPTX… Первый импорт может занять некоторое время.');
      const doc = await loadFile(filePath); selectedId = doc.id;
      setMessage(doc.sourceType === '.pptx' ? `${doc.name} открыт · слайды без анимаций и встроенного видео` : `${doc.name} открыт`);
    }
    catch (error) { setMessage(`Не удалось открыть ${filePath}: ${error.message}`); }
  }
  drawLibrary();
  await refresh();
}

async function renderPage(doc, pageNumber, maxWidth, maxHeight) {
  if (!doc) return null;
  if (doc.imageUrl) return doc.imageUrl;
  const key = `${pageNumber}:${maxWidth}x${maxHeight}`;
  if (doc.renderCache.has(key)) {
    const cached = doc.renderCache.get(key);
    doc.renderCache.delete(key);
    doc.renderCache.set(key, cached);
    return cached;
  }
  const result = (async () => {
    const page = await doc.pdf.getPage(pageNumber);
    const original = page.getViewport({ scale: 1 });
    const scale = Math.min(maxWidth / original.width, maxHeight / original.height);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const renderTask = page.render({ canvas, canvasContext: canvas.getContext('2d', { alpha: false }), viewport, intent: 'print' });
    await renderTask.promise;
    page.cleanup();
    return canvas.toDataURL('image/png');
  })();
  doc.renderCache.set(key, result);
  if (doc.renderCache.size > 12) doc.renderCache.delete(doc.renderCache.keys().next().value);
  try { return await result; }
  catch (error) { doc.renderCache.delete(key); throw error; }
}

function decodeImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = resolve;
    image.onerror = () => reject(new Error('Изображение не загрузилось'));
    image.src = url;
  });
}

function syncMedia(player, force = false) {
  const doc = docs.find(item => item.id === mediaDocId) || (detachedActive?.id===mediaDocId?detachedActive:null);
  if (!doc || doc.kind !== 'video' || mediaPlayer() !== player) return;
  doc.mediaState.time = Number.isFinite(player.currentTime) ? player.currentTime : 0;
  doc.mediaState.playing = !player.paused && !player.ended;
  if (!force && Date.now() - lastMediaSync < 800) return;
  lastMediaSync = Date.now();
  persist();
  if (activeId === doc.id && !placeholderOn && !qrOn) setStage();
}

const videoPlayer = $('video-player');
for (const eventName of ['play', 'pause', 'seeked', 'ratechange', 'ended']) videoPlayer.addEventListener(eventName, () => {
  if(eventName==='play'&&displayDisconnected&&activeId===mediaDocId){videoPlayer.pause();return;}
  if (eventName === 'play') music.pauseForVideo();
  if (eventName === 'pause' || eventName === 'ended') music.resumeFromVideo();
  syncMedia(videoPlayer, true);
  if(eventName==='ended') {
    const doc=docs.find(d=>d.id===mediaDocId);
    if(!doc || doc.id!==activeId || doc.id!==selectedId || !audienceOpen || preparing || placeholderOn || qrOn || doc.videoOptions.loop)return;
    if(doc.videoOptions.end==='placeholder'){placeholderOn=true;setStage();}
    if(doc.videoOptions.end==='next')void nextMaterial({live:true});
  }
});
videoPlayer.addEventListener('timeupdate', () => syncMedia(videoPlayer));
videoPlayer.addEventListener('error', () => {
  if (mediaDocId && videoPlayer.error) setMessage('Не удалось воспроизвести видео. Попробуйте MP4 или WebM.');
});

function pauseCurrentMedia() {
  if (!mediaDocId) return;
  const doc = docs.find(item => item.id === mediaDocId) || (detachedActive?.id===mediaDocId?detachedActive:null);
  if (doc) mediaPlayer().pause();
}

function showMedia(doc) {
  if (mediaDocId !== doc.id) {
    pauseCurrentMedia();
    mediaDocId = doc.id;
    const player = mediaPlayer();
    player.src = doc.mediaUrl;
    player.load();
    player.addEventListener('loadedmetadata', () => {
      if (mediaDocId === doc.id && doc.mediaState.time > 0) player.currentTime = Math.min(doc.mediaState.time, player.duration || doc.mediaState.time);
    }, { once: true });
  }
  mediaPlayer().volume=doc.videoOptions.volume;
  mediaPlayer().loop=doc.videoOptions.loop;
  $('current-image').hidden = true;
  $('current-empty').hidden = true;
  $('media-stage').hidden = false;
  $('video-player').hidden = false;
}

function updateOutput() {
  const doc = active();
  const image = $('output-image');
  const text = $('output-text');
  const monitor = $('output-monitor');
  monitor.style.backgroundColor = placeholderOn && audienceOpen ? placeholder.color : '';
  monitor.style.backgroundImage = '';
  image.hidden = true; text.hidden = false;
  $('output-badge').textContent = audienceOpen ? 'Открыт' : 'Закрыт';
  $('output-badge').classList.toggle('live', audienceOpen);
  let label = !audienceOpen ? 'Экран не открыт' : qrOn ? 'QR-код' : placeholderOn ? 'Заглушка' : doc?.kind === 'video' ? 'Видео' : stageImage ? 'Слайд' : 'Нет материала';
  text.textContent = label;
  if (audienceOpen && placeholderOn && !qrOn) {
    text.textContent = placeholder.text || 'Заглушка';
    if (placeholder.backdrop) monitor.style.backgroundImage = `url("${placeholder.backdrop}")`;
  } else if (audienceOpen && (qrOn ? materialsQr : doc?.kind !== 'video' && stageImage)) {
    image.src = qrOn ? materialsQr : stageImage; image.hidden = false; text.hidden = true;
  }
  $('output-caption').textContent = !audienceOpen ? 'Материалы видны только вам' : qrOn || placeholderOn ? label : doc ? `${doc.name}${doc.kind === 'video' ? (doc.mediaState.playing ? ' · воспроизведение' : ' · пауза') : ` · ${activePage || doc.page} / ${doc.pages}`}` : 'Выберите материал и нажмите «Показать зрителям»';
  $('show-status').classList.toggle('live', audienceOpen);
  $('show-status').querySelector('span:last-child').textContent = audienceOpen ? `Экран зрителей · ${label.toLowerCase()}` : 'Экран зрителей закрыт';
  if(displayDisconnected && audienceOpen){$('output-badge').textContent='Отключён';$('output-caption').textContent='Показ сохранён · ожидаем подключения экрана';$('show-status').querySelector('span:last-child').textContent='Экран отключён · пауза';}

}
function setStage() {
  if (qrOn && materialsQr) window.presentation.sendStage({ mode: 'qr', qr: materialsQr, label: 'Материалы выступления' });
  else if (placeholderOn) window.presentation.sendStage({ mode: 'placeholder', ...placeholder });
  else if (active()?.mediaUrl) {
    const doc = active();
    window.presentation.sendStage({ mode: 'media', url: doc.mediaUrl, kind: doc.kind, name: doc.name, time: doc.mediaState.time, playing: doc.mediaState.playing });
  }
  else if (stageImage) window.presentation.sendStage({ mode: 'slide', image: stageImage });
  else window.presentation.sendStage({ mode: 'idle' });
  updateOutput();
  $('placeholder-btn').classList.toggle('active', placeholderOn);
  $('placeholder-toggle').textContent = placeholderOn ? 'Убрать заглушку' : 'Показать заглушку';
  $('show-qr').hidden = qrOn;
  $('hide-qr').hidden = !qrOn;
}

function renderThumbs(doc) {
  const strip = $('thumb-strip');
  const isMedia = Boolean(doc?.mediaUrl || doc?.missing || doc?.pages===1);
  $('thumb-header').hidden = isMedia;
  strip.hidden = isMedia;
  if (isMedia) {
    thumbObserver?.disconnect();
    strip.replaceChildren();
    thumbDocId = null;
    return;
  }
  if (doc && thumbDocId === doc.id) {
    strip.querySelector('.thumbnail.active')?.classList.remove('active');
    strip.children[doc.page - 1]?.classList.add('active');
    return;
  }
  thumbObserver?.disconnect();
  strip.replaceChildren();
  thumbDocId = doc?.id || null;
  if (!doc) return;
  const observer = thumbObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      observer.unobserve(entry.target);
      const button = entry.target;
      const n = Number(button.dataset.page);
      void renderPage(doc, n, 180, 110).then(url => {
        if (thumbDocId === doc.id && button.isConnected) button.querySelector('img').src = url;
      }).catch(() => { /* A broken thumbnail should not stop the show. */ });
    }
  }, { root: strip, rootMargin: '0px 250px' });
  for (let n = 1; n <= doc.pages; n++) {
    const button = document.createElement('button');
    button.className = `control-surface thumbnail${n === doc.page ? ' active' : ''}`;
    button.type = 'button';
    button.title = `Страница ${n}`;
    button.dataset.page = String(n);
    const img = document.createElement('img');
    img.alt = '';
    const label = document.createElement('span');
    label.textContent = String(n);
    button.append(img, label);
    button.addEventListener('click', () => { doc.page = n; persist(); refresh(); });
    strip.append(button);
    observer.observe(button);
  }
  const current = strip.children[doc.page - 1];
  if (current) {
    const left = current.offsetLeft - strip.offsetLeft;
    const right = left + current.clientWidth;
    if (left < strip.scrollLeft) strip.scrollLeft = left;
    else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth;
  }
}

$('thumb-strip').addEventListener('wheel', event => {
  const strip = event.currentTarget;
  if (strip.scrollWidth <= strip.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  event.preventDefault();
  strip.scrollLeft += event.deltaY;
}, { passive: false });

function makeButton(text, label, action) {
  const button=document.createElement('button');button.type='button';button.className='btn btn--icon btn--compact btn--ghost';button.textContent=text;button.title=label;button.setAttribute('aria-label',label);button.addEventListener('click',action);return button;
}
function dragHandle(node, type, id) {
  const handle=makeButton('⋮⋮','Перетащить; Alt + стрелки вверх/вниз — изменить порядок',()=>{});
  handle.classList.add('scenario-handle');handle.draggable=true;
  handle.addEventListener('dragstart',event=>{draggedItem={type,id};event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',id);node.classList.add('dragging');});
  handle.addEventListener('dragend',()=>{draggedItem=null;document.querySelectorAll('.drop-before,.drop-after,.dragging').forEach(el=>el.classList.remove('drop-before','drop-after','dragging'));});
  handle.addEventListener('keydown',event=>{if(!event.altKey||!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();const array=type==='section'?sections:docs;const index=array.findIndex(x=>x.id===id);const other=index+(event.key==='ArrowDown'?1:-1);if(other<0||other>=array.length)return;if(type==='file')array[index].sectionId=array[other].sectionId;[array[index],array[other]]=[array[other],array[index]];persist();drawLibrary();});
  node.append(handle);
}
function dropTarget(node, type, id) {
  node.addEventListener('dragover',event=>{if(!draggedItem)return;event.preventDefault();event.dataTransfer.dropEffect='move';node.classList.toggle('drop-before',event.clientY<node.getBoundingClientRect().top+node.clientHeight/2);node.classList.toggle('drop-after',!node.classList.contains('drop-before'));});
  node.addEventListener('dragleave',()=>node.classList.remove('drop-before','drop-after'));
  node.addEventListener('drop',event=>{
    if(!draggedItem)return;event.preventDefault();
    const source=draggedItem;draggedItem=null;
    const after=event.clientY>=node.getBoundingClientRect().top+node.clientHeight/2;
    if(source.type==='section'){
      if(type!=='section'||source.id===id){drawLibrary();return;}
      const from=sections.findIndex(s=>s.id===source.id);const [section]=sections.splice(from,1);const to=sections.findIndex(s=>s.id===id);sections.splice(to+(after?1:0),0,section);
    }else{
      if(type==='file'&&source.id===id){drawLibrary();return;}
      const from=docs.findIndex(d=>d.id===source.id);if(from<0)return;const [doc]=docs.splice(from,1);
      if(type==='section'){doc.sectionId=id;const last=docs.map(d=>d.sectionId).lastIndexOf(id);docs.splice(last<0?docs.length:last+1,0,doc);}
      else{const to=docs.findIndex(d=>d.id===id);doc.sectionId=docs[to].sectionId;docs.splice(to+(after?1:0),0,doc);}
    }
    persist();drawLibrary();setMessage('Порядок сценария сохранён');
  });
}
function drawLibrary() {
  const list=$('file-list');list.replaceChildren();
  $('library-empty').hidden=docs.length>0;
  $('file-count').textContent=`Материалов: ${docs.length}`;
  $('section-select').replaceChildren();
  if(!sections.some(s=>s.id===currentSectionId))currentSectionId=sections[0]?.id;
  for(const section of sections){
    const option=document.createElement('option');option.value=section.id;option.textContent=section.name;$('section-select').append(option);
    const header=document.createElement('div');header.className='scenario-section';header.dataset.sectionId=section.id;dragHandle(header,'section',section.id);
    const title=document.createElement('button');title.className='section-title control-surface';title.textContent=section.name;title.title=section.notes||'Изменить название и заметки раздела';title.addEventListener('click',()=>openSection(section));header.append(title);dropTarget(header,'section',section.id);list.append(header);
    if(section.notes){const note=document.createElement('p');note.className='section-note';note.textContent=section.notes;list.append(note);}
    for(const doc of docs.filter(d=>d.sectionId===section.id)){
      const row=document.createElement('div');row.className='file-row';row.dataset.id=doc.id;dragHandle(row,'file',doc.id);
      const item=document.createElement('button');item.type='button';item.className='control-surface file-card';item.title=doc.name;
      const title=document.createElement('span');title.className='file-name';title.textContent=doc.name;
      const meta=document.createElement('span');meta.className='file-meta';
      const pages=document.createElement('span');pages.className='file-pages';
      const status=document.createElement('span');status.className='onair-chip';meta.append(pages,status);item.append(title,meta);
      item.addEventListener('click',()=>{selectedId=doc.id;currentSectionId=doc.sectionId;$('section-select').value=currentSectionId;void refresh();});
      const remove=makeButton('×',`Убрать ${doc.name} из сценария`,()=>removeFile(doc.id));remove.classList.add('remove-file','btn--danger');row.append(item);
      if(doc.missing){const repair=makeButton('↗','Найти файл',()=>void repairFile(doc).catch(e=>setMessage(e.message)));row.append(repair);}
      row.append(remove);dropTarget(row,'file',doc.id);list.append(row);
    }
  }
  $('section-select').value=currentSectionId;updateLibrary();
}
function openSection(section=null){editingSectionId=section?.id||null;$('section-name').value=section?.name||'';$('section-notes').value=section?.notes||'';$('section-delete').hidden=!section||sections.length<2;$('section-dialog-title').textContent=section?'Изменить раздел':'Новый раздел';$('section-dialog').showModal();$('section-name').focus();}
$('section-add').addEventListener('click',()=>openSection());
$('section-select').addEventListener('change',()=>{currentSectionId=$('section-select').value;});
$('section-form').addEventListener('submit',event=>{event.preventDefault();const name=$('section-name').value.trim();if(!name)return;let section=sections.find(s=>s.id===editingSectionId);if(!section){section={id:crypto.randomUUID()};sections.push(section);}section.name=name;section.notes=$('section-notes').value;currentSectionId=section.id;persist();drawLibrary();$('section-dialog').close();});
$('section-delete').addEventListener('click',()=>{if(sections.length<2)return;const target=sections.find(s=>s.id!==editingSectionId);for(const doc of docs)if(doc.sectionId===editingSectionId)doc.sectionId=target.id;sections=sections.filter(s=>s.id!==editingSectionId);currentSectionId=target.id;persist();drawLibrary();$('section-dialog').close();});

function updateLibrary() {
  for (const row of $('file-list').children) {
    const doc = docs.find(item => item.id === row.dataset.id);
    if (!doc) continue;
    const button = row.querySelector('.file-card');
    button.classList.toggle('selected', selectedId === doc.id);
    button.classList.toggle('active', activeId === doc.id);
    row.querySelector('.file-pages').textContent = fileSummary(doc);
    row.querySelector('.onair-chip').textContent = audienceOpen && activeId === doc.id ? 'В показе' : '';
    row.hidden = !$('file-search').value.trim() ? false : !doc.name.toLocaleLowerCase().includes($('file-search').value.trim().toLocaleLowerCase());
  }
}

function removeFile(id) {
  publishSequence++;
  const index = docs.findIndex(doc => doc.id === id);
  if (index < 0) return;
  const [doc] = docs.splice(index, 1);
  if (mediaDocId === id) {
    const player = mediaPlayer();
    player.pause(); player.removeAttribute('src'); player.load();
    mediaDocId = null;
  }
  if (doc.mediaUrl) void window.presentation.releaseMedia(doc.mediaUrl);
  if (doc.imageUrl) URL.revokeObjectURL(doc.imageUrl);
  doc.renderCache.clear();
  if (selectedId === id) selectedId = docs[Math.min(index, docs.length - 1)]?.id || null;
  if (activeId === id) {
    activeId = null; stageImage = null; placeholderOn = false; qrOn = false; setStage();
  }
  persist(); drawLibrary(); refresh();
  setMessage(`${doc.name} убран из списка`);
}

function updateHeader(doc) {
  const preview = Boolean(doc && (preparing || doc.id !== activeId));
  $('current-file').textContent = doc?.name || 'Ваше выступление';
  $('page-indicator').textContent = doc ? fileSummary(doc) : '— / —';
  $('page-indicator').disabled = !doc || doc.missing || doc.kind === 'video';
  $('view-mode').textContent = !audienceOpen ? 'Рабочий экран · видите только вы' : preview ? 'Подготовка · показ не меняется' : 'Управление показом';
  $('view-mode').className = `on-air-label${preview ? ' preview' : audienceOpen ? ' live' : ''}`;
  $('preview-box').hidden = true;
  $('prepare-btn').classList.toggle('active', preparing);
  $('prepare-btn').disabled = !doc || doc.kind === 'video';
  $('prepare-btn').setAttribute('aria-pressed', String(preparing));
  $('prepare-hint').textContent = preparing || (doc && doc.id !== activeId) ? 'Экран зрителей остаётся прежним' : audienceOpen ? 'Перелистывание меняет показ' : 'Подготовьте материалы перед выступлением';
  if (doc?.kind === 'video') $('prepare-hint').textContent = 'Видео управляется кнопками под изображением';
  $('take-btn').disabled = !doc || doc.missing;
  $('close-show-btn').hidden = !audienceOpen;
  $('start-btn').hidden = audienceOpen;
  $('notes').disabled = !doc;
  if (notesDocId !== (doc?.id || null)) {
    notesDocId = doc?.id || null;
    $('notes').value = doc?.notes || '';
  }
  $('prev-btn').disabled = !doc || doc.page <= 1;
  const next=following(doc);
  $('next-btn').disabled = !doc || doc.missing || (doc.page >= doc.pages && !next);
  $('next-btn').querySelector('span').textContent=doc && doc.page>=doc.pages && next ? 'К следующему' : 'Далее';
  $('next-material').disabled=!next || advancing;
  $('next-material').hidden=!next || Boolean(doc && doc.page>=doc.pages);
  $('next-material-name').textContent=next ? next.name : 'Конец сценария';
  document.querySelector('.scenario-next').hidden=!next && doc?.kind!=='video';
  document.body.classList.toggle('no-next-slide',!doc || doc.kind==='video' || doc.page>=doc.pages);
  $('next-material').title=next ? `Следующий материал: ${next.name}` : 'Конец сценария';
  $('video-settings').hidden=doc?.kind!=='video';
  updateOutput();
}

async function refresh() {
  const doc = selected();
  const seq = ++renderSequence;
  publishSequence++;
  updateLibrary(); updateHeader(doc); renderThumbs(doc);
  if (!doc || doc.missing) { pauseCurrentMedia(); displayedDocId = null; $('media-stage').hidden = true; $('current-image').hidden = true; $('current-empty').hidden = false; $('next-image').hidden = true; $('next-empty').hidden = false; $('next-number').textContent = '—'; return; }
  if (doc.mediaUrl) {
    showMedia(doc);
    $('next-image').hidden = true; $('next-empty').hidden = false; $('next-number').textContent = '—';
    if (activeId === doc.id) setStage();
    return;
  }
  pauseCurrentMedia();
  $('media-stage').hidden = true;
  $('current-empty').hidden = true;
  if (displayedDocId && displayedDocId !== doc.id) $('current-image').hidden = true;
  if (doc.page < doc.pages) {
    $('next-number').textContent = `${doc.page + 1} / ${doc.pages}`;
    $('next-empty').hidden = true;
  } else { $('next-number').textContent = '—'; $('next-image').hidden = true; $('next-empty').hidden = false; }
  try {
    const image = await renderPage(doc, doc.page, 1920, 1080);
    await decodeImage(image);
    if (seq !== renderSequence) return;
    $('current-image').src = image; $('current-image').hidden = false; displayedDocId = doc.id;
    if (doc.id === activeId && !preparing) { stageImage = image; activePage = doc.page; setStage(); }
  } catch (error) { if(seq===renderSequence)setMessage(`Ошибка отображения: ${error.message}`); }
  if (seq !== renderSequence) return;
  if (doc.page < doc.pages) {
    try { const next = await renderPage(doc, doc.page + 1, 620, 400); await decodeImage(next); if (seq === renderSequence) { $('next-image').src = next; $('next-image').hidden = false; } }
    catch { if (seq === renderSequence) { $('next-image').hidden = true; $('next-empty').hidden = false; } }
  }
}

async function changePage(delta) {
  const doc = selected(); if (!doc) return;
  if(delta>0 && doc.page>=doc.pages){await nextMaterial();return;}
  const next = Math.max(1, Math.min(doc.pages, doc.page + delta));
  if (next === doc.page) return;
  doc.page = next; persist(); await refresh();
}
async function showSelected() {
  const doc = selected(); if (!doc || doc.missing) return;
  const sequence = ++publishSequence;
  const page = doc.page;
  let image = null;
  try { if (!doc.mediaUrl) image = await renderPage(doc, page, 1920, 1080); }
  catch (error) { setMessage(`Не удалось подготовить слайд: ${error.message}`); return; }
  if (sequence !== publishSequence || selectedId !== doc.id || doc.page !== page) return;
  if(detachedActive && detachedActive!==doc){releaseDoc(detachedActive);detachedActive=null;}
  activeId = doc.id; activePage = page; stageImage = image;
  preparing = false; placeholderOn = false; qrOn = false;
  setStage();
  if (!audienceOpen) await startShow();
  if(doc.kind==='video' && doc.videoOptions.autoplay && audienceOpen && !displayDisconnected && selectedId===doc.id && activeId===doc.id){
    if(videoPlayer.ended)videoPlayer.currentTime=0;
    try{await videoPlayer.play();}catch{setMessage('Нажмите ▶ под видео, чтобы начать воспроизведение');}
  }
  updateHeader(selected()); updateLibrary();
  setMessage(`${doc.name}${doc.kind === 'video' ? '' : `, страница ${page}`} — на экране зрителей`);
}
async function startShow() {
  let result;try{result=await window.presentation.startShow();}catch(error){setMessage(error.message);return;}
  if(result.waiting){setMessage('Выбранный экран отключён.');return;}
  audienceOpen = true;
  timer.start();
  $('start-btn').textContent = 'Открыть экран зрителей';
  updateHeader(selected()); updateLibrary();
  setStage();
  setMessage(result.secondary?'Показ открыт на выбранном экране.':'Показ открыт в отдельном окне. Экран можно выбрать кнопкой «Экран».');
}
function togglePlaceholder() { placeholderOn = !placeholderOn; if (placeholderOn) pauseCurrentMedia(); qrOn = false; setStage(); setMessage(placeholderOn ? 'Заглушка на проекторе' : 'Показ возвращён'); }
function closeDialog(id) { $(id).close(); }
function isTyping(event) { return Boolean(event.target.closest?.('input, textarea, select, video, audio, [contenteditable=true], [role=separator]')); }

$('open-btn').addEventListener('click', openFiles);
$('library-add').addEventListener('click', openFiles);
$('empty-open').addEventListener('click', openFiles);
$('prev-btn').addEventListener('click', () => changePage(-1));
$('next-btn').addEventListener('click', () => changePage(1));
$('show-btn').addEventListener('click', showSelected);
$('take-btn').addEventListener('click', showSelected);
$('prepare-btn').addEventListener('click', () => { preparing = !preparing; publishSequence++; updateHeader(selected()); if (!preparing) setMessage('Подготовка завершена. Следующее перелистывание изменит показ.'); });
$('file-search').addEventListener('input', updateLibrary);
$('help-btn').addEventListener('click', () => $('help-dialog').showModal());
$('page-indicator').addEventListener('click', () => { const doc = selected(); if (!doc) return; $('page-input').max = doc.pages; $('page-input').value = doc.page; $('page-dialog').showModal(); $('page-input').select(); });
$('page-form').addEventListener('submit', event => { event.preventDefault(); const doc = selected(); if (!doc) return; doc.page = Math.max(1, Math.min(doc.pages, Math.floor(Number($('page-input').value) || 1))); persist(); $('page-dialog').close(); void refresh(); });
$('start-btn').addEventListener('click', startShow);
$('close-show-btn').addEventListener('click', async () => {
  await window.presentation.closeShow();
});
$('placeholder-btn').addEventListener('click', togglePlaceholder);
$('placeholder-settings').addEventListener('click', () => $('placeholder-dialog').showModal());
$('notes').addEventListener('input', () => { const doc = selected(); if (doc) { doc.notes=$('notes').value; persist('notes:'+doc.id); $('notes-state').textContent = 'Заметки сохранены'; } });

document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => closeDialog(button.dataset.close)));
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

$('placeholder-color').addEventListener('input', () => { placeholder.color = $('placeholder-color').value; persist(); if (placeholderOn) setStage(); });
$('placeholder-text').addEventListener('input', () => { placeholder.text = $('placeholder-text').value; persist(); if (placeholderOn) setStage(); });
$('placeholder-toggle').addEventListener('click', () => { togglePlaceholder(); $('placeholder-dialog').close(); });
$('backdrop-btn').addEventListener('click', async () => { const image = await window.presentation.chooseBackdrop(); if (!image) return; placeholder.backdrop = await resizeImage(image); $('backdrop-state').textContent = 'Используется своё изображение'; persist(); if (placeholderOn) setStage(); });
$('clear-backdrop-btn').addEventListener('click', () => { placeholder.backdrop = null; $('backdrop-state').textContent = 'Сейчас используется цвет фона'; persist(); if (placeholderOn) setStage(); });

async function resizeImage(dataUrl) {
  const image = new Image(); image.src = dataUrl; await image.decode();
  const scale = Math.min(1, 1920 / image.width, 1080 / image.height);
  const canvas = document.createElement('canvas'); canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.84);
}

$('qr-btn').addEventListener('click', () => $('qr-dialog').showModal());
$('generate-qr').addEventListener('click', async () => {
  try {
    const link = $('materials-link').value.trim(); const url = new URL(link);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Нужна ссылка http или https');
    materialsQr = await window.presentation.makeQr(link);
    $('materials-qr').src = materialsQr; $('materials-qr').hidden = false; $('qr-empty').hidden = true; $('show-qr').disabled = false; persist();
  } catch (error) { $('qr-empty').textContent = `Проверьте ссылку: ${error.message}`; $('qr-empty').hidden = false; $('materials-qr').hidden = true; }
});
$('show-qr').addEventListener('click', async () => { if (!materialsQr) return; if (!audienceOpen) await startShow(); pauseCurrentMedia(); qrOn = true; placeholderOn = false; setStage(); $('qr-dialog').close(); });
$('hide-qr').addEventListener('click', () => { qrOn = false; setStage(); $('qr-dialog').close(); });

$('remote-btn').addEventListener('click', async () => {
  $('remote-dialog').showModal();
  const info = await window.presentation.remoteInfo();
  if (info.qr) { $('remote-qr').src = info.qr; $('remote-qr').hidden = false; $('remote-unavailable').hidden = true; }
  else $('remote-unavailable').textContent = 'Локальный адрес не найден. Подключите ноутбук к Wi-Fi.';
  $('remote-urls').replaceChildren();
  for (const url of info.urls) { const code = document.createElement('code'); code.textContent = url; $('remote-urls').append(code); }
});

window.presentation.onRemoteAction(action => {
  if(restoring||history?.busy||document.body.classList.contains('event-busy'))return;
  if (action === 'prev') changePage(-1);
  else if (action === 'next') changePage(1);
  else if (action === 'show') showSelected();
  else if (action === 'placeholder') togglePlaceholder();
});
window.presentation.onAudienceClosed(() => { audienceOpen = false; pauseCurrentMedia(); timer.pause(); updateHeader(selected()); updateLibrary(); setMessage('Экран зрителей закрыт.'); });
document.addEventListener('keydown', event => {
  if (restoring || history?.busy || document.body.classList.contains('event-busy') || document.querySelector('dialog[open]') || isTyping(event)) return;
  if((event.ctrlKey||event.metaKey) && ['z','я','y','н'].includes(event.key.toLowerCase())){event.preventDefault();void travelHistory(event.shiftKey||['y','н'].includes(event.key.toLowerCase()));return;}
  if (event.target.closest?.('button') && ['Enter', ' '].includes(event.key)) return;
  if (event.key === 'ArrowLeft') { event.preventDefault(); changePage(-1); }
  if (event.key === 'ArrowRight' || event.key === ' ') { event.preventDefault(); changePage(1); }
  if (['b', 'и'].includes(event.key.toLowerCase())) { event.preventDefault(); togglePlaceholder(); }
  if (event.key === 'Enter') { event.preventDefault(); showSelected(); }
  if (event.key === 'F5') { event.preventDefault(); startShow(); }
});

async function repairFile(doc){
  const paths=await window.presentation.openFiles();if(!paths.length)return;
  const index=docs.indexOf(doc);if(index<0)return;
  restoring=true;
  try{
    const replacement=await loadFile(paths[0],doc.page,doc.mediaState?.time,{...doc,path:paths[0],name:null,preparedPath:null});
    docs.splice(docs.indexOf(replacement),1);docs[index]=replacement;
    if(mediaDocId===doc.id){pauseCurrentMedia();mediaDocId=null;}
    releaseDoc(doc);
  }finally{restoring=false;}
  persist();drawLibrary();await refresh();
}
function releaseDoc(doc){
  if(doc.imageUrl)URL.revokeObjectURL(doc.imageUrl);
  if(doc.mediaUrl)void window.presentation.releaseMedia(doc.mediaUrl);
  doc.renderCache?.clear();if(doc.pdf)void doc.pdf.loadingTask.destroy().catch(()=>{});
}
async function restoreEdits(saved){
  const before=snapshot(),old=docs.slice(),chosen=selectedId,outputDoc=active();
  if(detachedActive&&!old.includes(detachedActive))old.push(detachedActive);
  const previousPreparing=preparing;
  restoring=true;renderSequence++;publishSequence++;
  document.body.classList.add('history-busy');
  try{
    sections=structuredClone(saved.sections);
    const rebuilt=[];
    for(const item of saved.files){
      let doc=old.find(d=>d.id===item.id && d.path===item.path && d.preparedPath===(item.preparedPath||null));
      if(doc){doc.name=item.name;doc.notes=item.notes;doc.sectionId=item.sectionId;doc.videoOptions=videoOptions(item.videoOptions);}
      else{
        try{doc=await loadFile(item.path,item.page,item.time,item);}
        catch{doc={...item,missing:true,kind:'missing',pages:1,page:item.page||1,renderCache:new Map()};}
      }
      rebuilt.push(doc);
    }
    for(const doc of old)if(!rebuilt.includes(doc)){
      if(doc===outputDoc && audienceOpen){detachedActive=doc;continue;}
      if(mediaDocId===doc.id){pauseCurrentMedia();mediaDocId=null;}
      releaseDoc(doc);
    }
    docs.splice(0,docs.length,...rebuilt);
    if(rebuilt.includes(detachedActive))detachedActive=null;
    if(!active()){activeId=null;preparing=true;}
    selectedId=docs.some(d=>d.id===chosen)?chosen:docs[0]?.id||null;
    if(editSignature({music:before.music})!==editSignature({music:saved.music}))await music.applyEdits(saved.music||{});
    placeholder=structuredClone(saved.placeholder);$('placeholder-color').value=placeholder.color;$('placeholder-text').value=placeholder.text;
    $('materials-link').value=saved.materialsLink||'';
    if(before.materialsLink!==saved.materialsLink){materialsQr=null;$('materials-qr').hidden=true;$('show-qr').disabled=true;}
    if(before.timerLimit!==saved.timerLimit)timer.load(saved.timerLimit);
    notesDocId=null;drawLibrary();
    // An edit undo must never switch the slide currently seen by the audience.
    preparing=true;await refresh();preparing=previousPreparing;updateHeader(selected());
  }finally{restoring=false;document.body.classList.remove('history-busy');}
  persist();
}
async function travelHistory(redo=false){
  if(restoring || advancing || document.body.classList.contains('event-busy'))return;
  try{const changed=await (redo?history.redo():history.undo());if(changed)setMessage(redo?'Изменение повторено':'Изменение отменено');}
  catch(error){setMessage('Не удалось отменить изменение: '+error.message);}
}
$('undo-btn').addEventListener('click',()=>void travelHistory());
$('redo-btn').addEventListener('click',()=>void travelHistory(true));
function probeMedia(url,kind){
  return new Promise((resolve,reject)=>{
    const element=document.createElement(kind==='audio'?'audio':'video');element.preload='metadata';
    const cleanup=()=>{element.onloadedmetadata=null;element.onerror=null;clearTimeout(timeout);element.removeAttribute('src');element.load();};
    const timeout=setTimeout(()=>{cleanup();reject(Error('Файл доступен, но не удалось загрузить метаданные за 8 секунд. Проверьте формат на репетиции.'));},8000);
    element.onloadedmetadata=()=>{element.onloadedmetadata=null;element.onerror=null;cleanup();resolve('Файл доступен, метаданные загружены.');};
    element.onerror=()=>{element.onloadedmetadata=null;element.onerror=null;cleanup();reject(Error('Не удалось прочитать медиафайл. Проверьте формат или замените файл.'));};
    element.src=url;element.load();
  });
}
createPreflight({$,bridge:window.presentation,capture:snapshot,isLive:()=>audienceOpen,
  canRun:()=>{if(restoring||history?.busy||advancing||document.body.classList.contains('event-busy'))return false;if(audienceOpen){setMessage('Для проверки перед стартом сначала закройте экран зрителей.');return false;}return true;},
  repair:file=>file.kind==='audio'?music.repairTrack(file.id):repairFile(docs.find(d=>d.id===file.id)),
  inspect:async file=>{
    const fresh=await window.presentation.readFile(file.preparedPath||file.path);
    if(fresh.mediaUrl){try{return await probeMedia(fresh.mediaUrl,file.kind==='audio'?'audio':'video');}finally{await window.presentation.releaseMedia(fresh.mediaUrl);}}
    if(fresh.type==='.pdf'){
      const task=pdfjs.getDocument({data:new Uint8Array(fresh.bytes),wasmUrl:'local/wasm/',cMapUrl:'local/cmaps/',standardFontDataUrl:'local/standard_fonts/',BinaryDataFactory:LocalPdfAssets,useWorkerFetch:false});
      try{const pdf=await task.promise,page=await pdf.getPage(1),original=page.getViewport({scale:1});const viewport=page.getViewport({scale:Math.min(640/original.width,360/original.height)});const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.ceil(viewport.width));canvas.height=Math.max(1,Math.ceil(viewport.height));await page.render({canvas,canvasContext:canvas.getContext('2d'),viewport,intent:'print'}).promise;return `Подготовлено страниц: ${pdf.numPages}. Первый слайд отображается.`;}finally{await task.destroy();}
    }
    const url=bufferToDataUrl(fresh.bytes,mimeFor(fresh.type));try{await decodeImage(url);return 'Изображение загружено.';}finally{URL.revokeObjectURL(url);}
  }
});
function legacyState(){
  const saved=savedState();
  for(const file of saved.files || [])file.notes=localStorage.getItem(`pult.notes.${file.path}`)||'';
  try{saved.music=JSON.parse(localStorage.getItem('pult.music.state.v1')||'{}');}catch{saved.music={};}
  saved.timerLimit=Number(localStorage.getItem('pult.timer.limit'))||0;
  return saved;
}
async function applyEvent(saved) {
  restoring=true;renderSequence++;publishSequence++;thumbObserver?.disconnect();
  music.stop();
  pauseCurrentMedia();
  if(detachedActive){releaseDoc(detachedActive);detachedActive=null;}
  $('video-player').removeAttribute('src');$('video-player').load();mediaDocId=null;
  for(const doc of docs){if(doc.imageUrl)URL.revokeObjectURL(doc.imageUrl);if(doc.mediaUrl)void window.presentation.releaseMedia(doc.mediaUrl);doc.renderCache.clear();if(doc.pdf)await doc.pdf.loadingTask.destroy().catch(()=>{});}
  docs.length=0;selectedId=null;activeId=null;stageImage=null;activePage=null;displayedDocId=null;notesDocId=null;thumbDocId=null;preparing=false;qrOn=false;materialsQr=null;placeholderOn=false;
  $('notes').value='';$('file-search').value='';$('materials-qr').hidden=true;$('show-qr').disabled=true;$('qr-empty').hidden=false;
  sections=Array.isArray(saved.sections)&&saved.sections.length?structuredClone(saved.sections):[{id:crypto.randomUUID(),name:'Основная часть',notes:''}];currentSectionId=sections[0].id;
  placeholder={color:'#334b73',text:'Скоро продолжим',backdrop:null,...saved.placeholder};
  $('placeholder-color').value=placeholder.color;$('placeholder-text').value=placeholder.text;
  $('materials-link').value=saved.materialsLink||'';
  $('backdrop-state').textContent=placeholder.backdrop?'Используется своё изображение':'Сейчас используется цвет фона';
  timer.load(saved.timerLimit||0);
  await music.restore(saved.music||{});
  const oldAudio=[];
  for(const item of saved.files||[]){
    if(kindFor(extension(item.path))==='audio'){oldAudio.push(item.path);continue;}
    try{await loadFile(item.path,item.page,item.time,item);}
    catch {docs.push({...item,id:item.id||crypto.randomUUID(),name:item.name||item.path.split(/[\\/]/).pop(),sectionId:sections.some(s=>s.id===item.sectionId)?item.sectionId:sections[0].id,missing:true,kind:'missing',pages:1,page:item.page||1,renderCache:new Map()});}
  }
  if(oldAudio.length)await music.addPaths(oldAudio,{silent:true});
  selectedId=docs.find(d=>!d.missing)?.id||docs[0]?.id||null;
  activeId=selectedId;
  restoring=false;drawLibrary();setStage();await refresh();
  history?.reset();
  if(docs.some(d=>d.missing))setMessage('Некоторые файлы не найдены. Нажмите ↗ рядом с материалом, чтобы найти его.');
}
history=createHistory({capture:snapshot,apply:restoreEdits,onChange:state=>{
  $('undo-btn').disabled=!state.undo||state.busy;$('redo-btn').disabled=!state.redo||state.busy;
  $('history-status').textContent=state.busy?'Восстанавливаю изменение…':'Ctrl+Z — отменить · Ctrl+Shift+Z — повторить';
}});
window.addEventListener('pult-music-changed',()=>{if(!restoring)history.observe();});
events=createEvents({$,bridge:window.presentation,snapshot,apply:applyEvent,legacy:legacyState,canSwitch:()=>{if(history.busy||restoring)return false;if(audienceOpen){setMessage('Для смены мероприятия сначала закройте экран зрителей.');return false;}return true;},setMessage});
$('timer-limit').addEventListener('change',persist);
void events.initialize().catch(error=>{setMessage(error.message);$('event-status').textContent='Ошибка загрузки';});
