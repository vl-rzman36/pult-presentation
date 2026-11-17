const { app, BrowserWindow, dialog, ipcMain, screen, protocol } = require('electron');
const { createReadStream, readFileSync } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const QRCode = require('qrcode');
const { WebSocketServer } = require('ws');
const { resolveDisplay } = require('./display-routing.cjs');
const { importPptx } = require('./pptx.cjs');
const { writePackage, readPackage } = require('./event-package.cjs');
let eventSaveQueue = Promise.resolve();
let eventQuitReady = false;
app.on('before-quit', event => {
  if(eventQuitReady) return;
  event.preventDefault();
  Promise.allSettled([eventSaveQueue,displaySaveQueue]).finally(()=>{eventQuitReady=true;app.quit();});
});

let presenter;
let audience;
let testDisplayWindow;
let displayPreference={mode:'auto',reconnect:true};
let audienceTarget=null;
let displayWaiting=false;
let displaySaveQueue=Promise.resolve();
let stage = { mode: 'idle' };
let remoteServer;
let remotePort;
const remoteToken = crypto.randomBytes(18).toString('hex');
const mediaExtensions = new Set(['.mp4', '.webm', '.mov', '.mp3', '.m4a', '.wav', '.ogg']);
const mediaMime = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.ogg': 'audio/ogg' };
const allowedExtensions = new Set(['.pdf', '.pptx', '.png', '.jpg', '.jpeg', '.webp', ...mediaExtensions]);
const mediaPaths = new Map();
const pdfAssetDirs = { wasmUrl: 'wasm', cMapUrl: 'cmaps', standardFontDataUrl: 'standard_fonts' };

protocol.registerSchemesAsPrivileged([{ scheme: 'pult-media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }]);

function createPresenter() {
  presenter = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1050,
    minHeight: 650,
    title: 'Пульт презентаций',
    backgroundColor: '#131b25',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  presenter.removeMenu();
  presenter.webContents.on('console-message', details => {
    if (details.level === 'error') console.error('Presenter:', details.message);
  });
  presenter.webContents.on('did-fail-load', (_event, code, description) => console.error('Presenter load:', code, description));
  presenter.loadFile(path.join(__dirname, 'index.html'));
  presenter.on('closed', () => { presenter = null; audience?.close();testDisplayWindow?.close(); });
}

function displayRoute(preference=displayPreference){return resolveDisplay(screen.getAllDisplays(),screen.getPrimaryDisplay().id,preference);}
function displayInfo(reason=''){
  const route=displayRoute(audienceTarget||displayPreference),preferred=displayRoute();
  return {reason,waiting:displayWaiting,open:Boolean(audience&&!audience.isDestroyed()),targetName:route.missing?(audienceTarget?.label||displayPreference.label||'Отключённый экран'):route.fullscreen?(route.display.label||`Экран ${route.display.id}`):'Отдельное окно',preference:{...displayPreference,id:preferred.display?.id??displayPreference.id},displays:screen.getAllDisplays().map(d=>({id:d.id,label:d.label,width:d.size.width,height:d.size.height,primary:d.id===screen.getPrimaryDisplay().id}))};
}
function notifyDisplay(reason=''){presenter?.webContents.send('display-status',displayInfo(reason));}
function saveDisplayPreference(){
  const data=JSON.stringify(displayPreference);const file=path.join(app.getPath('userData'),'display-preference.json');
  const task=displaySaveQueue.then(async()=>{await fs.mkdir(app.getPath('userData'),{recursive:true});await fs.writeFile(file+'.tmp',data);await fs.rename(file+'.tmp',file);});displaySaveQueue=task.catch(()=>{});return task;
}
function setAudiencePosition(route){
  const current=audience.getBounds(),target=route.display.bounds;
  if(route.fullscreen && audience.isFullScreen() && ['x','y','width','height'].every(key=>current[key]===target[key])){audienceTarget={mode:'display',id:route.display.id,label:route.display.label};return;}
  audience.setFullScreen(false);
  if(route.fullscreen)audience.setBounds(route.display.bounds);
  else{const area=route.display.workArea||route.display.bounds,width=Math.min(1000,area.width),height=Math.min(650,area.height);audience.setBounds({x:area.x+Math.round((area.width-width)/2),y:area.y+Math.round((area.height-height)/2),width,height});}
  if(route.fullscreen)audience.setFullScreen(true);
  audienceTarget=route.fullscreen?{mode:'display',id:route.display.id,label:route.display.label}:{mode:'window'};
}
function syncDisplays(force=false){
  if(!audience||audience.isDestroyed()){notifyDisplay();return;}
  const route=displayRoute(force?displayPreference:audienceTarget||displayPreference);
  if(route.missing){
    const first=!displayWaiting;displayWaiting=true;audience.setFullScreen(false);audience.hide();
    if(stage.mode==='media')stage={...stage,playing:false};audience.webContents.send('stage',stage);
    notifyDisplay(first?'lost':'');return;
  }
  if(displayWaiting&&!force&&displayPreference.reconnect===false){notifyDisplay();return;}
  const restoring=displayWaiting;setAudiencePosition(route);displayWaiting=false;
  audience.showInactive();audience.webContents.send('stage',stage);notifyDisplay(restoring?'restored':'');
}
async function createAudience() {
  if(audience&&!audience.isDestroyed()){syncDisplays(true);return {secondary:displayRoute(audienceTarget).fullscreen,waiting:displayWaiting};}
  const route=displayRoute();if(route.missing)throw new Error('Выбранный экран отключён. Подключите его или выберите другой в меню «Экран».');
  audience=new BrowserWindow({width:1000,height:650,show:false,title:'Экран зрителей',backgroundColor:'#000000',autoHideMenuBar:true,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false,preload:path.join(__dirname,'preload.js')}});
  audience.removeMenu();setAudiencePosition(route);displayWaiting=false;
  audience.webContents.on('console-message',details=>{if(details.level==='error')console.error('Audience:',details.message);});
  audience.webContents.on('did-finish-load',()=>{if(audience){audience.webContents.send('stage',stage);if(!displayWaiting)audience.showInactive();}});
  audience.on('closed',()=>{audience=null;audienceTarget=null;displayWaiting=false;presenter?.webContents.send('audience-closed');notifyDisplay();});
  audience.loadFile(path.join(__dirname,'audience.html'));notifyDisplay();
  return {secondary:route.fullscreen,waiting:false};
}

function localAddresses() {
  const found = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const entry of interfaces || []) {
      if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address);
    }
  }
  return found.sort((a, b) => addressRank(a) - addressRank(b));
}

function addressRank(ip) {
  const p = ip.split('.').map(Number);
  if (p[0] === 192 && p[1] === 168) return 0;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return 1;
  if (p[0] === 10) return 2;
  return 3;
}

async function startRemote() {
  const remoteHtml = await fs.readFile(path.join(__dirname, 'remote.html'));
  const remoteJs = await fs.readFile(path.join(__dirname, 'remote.js'));
  remoteServer = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.searchParams.get('token') !== remoteToken) { response.writeHead(403).end(); return; }
    if (url.pathname === '/') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(remoteHtml); return; }
    if (url.pathname === '/remote.js') { response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' }).end(remoteJs); return; }
    response.writeHead(404).end();
  });
  const sockets = new WebSocketServer({ noServer: true });
  remoteServer.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname !== '/control' || url.searchParams.get('token') !== remoteToken) { socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws));
  });
  sockets.on('connection', ws => ws.on('message', raw => {
    try {
      const { action } = JSON.parse(String(raw));
      if (['prev', 'next', 'show', 'placeholder'].includes(action)) presenter?.webContents.send('remote-action', action);
    } catch { /* Ignore malformed remote commands. */ }
  }));
  await new Promise((resolve, reject) => {
    remoteServer.once('error', reject);
    remoteServer.listen(0, '0.0.0.0', resolve);
  });
  remotePort = remoteServer.address().port;
}

app.whenReady().then(async () => {
  protocol.handle('pult-media', async request => {
    const url = new URL(request.url);
    const id = url.pathname.slice(1);
    const mediaPath = url.host === 'file' ? mediaPaths.get(id) : null;
    if (!mediaPath) return new Response('Файл не найден', { status: 404 });
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Метод не поддерживается', { status: 405 });
    try {
      const size = (await fs.stat(mediaPath)).size;
      const range = request.headers.get('range');
      let start = 0, end = size - 1, partial = false;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range);
        if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        if (match[1]) {
          start = Number(match[1]);
          if (match[2]) end = Number(match[2]);
        } else start = Math.max(0, size - Number(match[2]));
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
        end = Math.min(end, size - 1);
        partial = true;
      }
      const headers = {
        'Content-Type': mediaMime[path.extname(mediaPath).toLowerCase()] || 'application/octet-stream',
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        'Cache-Control': 'no-store',
      };
      if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      const body = request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(mediaPath, { start, end }));
      return new Response(body, { status: partial ? 206 : 200, headers });
    } catch { return new Response('Файл недоступен', { status: 404 }); }
  });
  try{const saved=JSON.parse(readFileSync(path.join(app.getPath('userData'),'display-preference.json'),'utf8'));if(['auto','window','display'].includes(saved.mode))displayPreference=saved;}catch{}
  createPresenter();
  for(const event of ['display-added','display-removed','display-metrics-changed'])screen.on(event,()=>syncDisplays());
  try { await startRemote(); } catch (error) { console.error('Remote server:', error); }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createPresenter(); });
});
app.on('window-all-closed', () => { remoteServer?.close(); if (process.platform !== 'darwin') app.quit(); });

ipcMain.handle('open-files', async () => {
  const result = await dialog.showOpenDialog(presenter, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Презентации и видео', extensions: ['pdf', 'pptx', 'png', 'jpg', 'jpeg', 'webp', 'mp4', 'webm', 'mov'] }],
  });
  return result.canceled ? [] : result.filePaths;
});
ipcMain.handle('export-event', async (_event, event) => {
  const name=String(event?.name || 'Мероприятие').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');
  const result=await dialog.showSaveDialog(presenter,{title:'Собрать мероприятие на флешку',defaultPath:name+'.pult',filters:[{name:'Пакет мероприятия',extensions:['pult']}]});
  if(result.canceled || !result.filePath) return null;
  const destination=path.extname(result.filePath).toLowerCase()==='.pult'?result.filePath:result.filePath+'.pult';
  const summary=await writePackage(destination,event,path.join(app.getPath('userData'),'pptx-cache'));
  return {...summary,path:destination};
});
ipcMain.handle('load-events', async () => {
  try {return JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'events.json'),'utf8'));}
  catch(error) {if(error.code==='ENOENT') return null;throw new Error('Не удалось прочитать сохранённые мероприятия. Файл оставлен без изменений.');}
});
ipcMain.handle('save-events', (_event, data) => {
  if(data?.version!==1 || !Array.isArray(data.events)) throw new Error('Неверный формат мероприятий');
  const content=JSON.stringify(data);
  const task=eventSaveQueue.then(async()=>{
    const target=path.join(app.getPath('userData'),'events.json');
    const temp=target+'.tmp';
    await fs.mkdir(app.getPath('userData'),{recursive:true});
    await fs.writeFile(temp,content,'utf8');
    await fs.rename(temp,target);
  });
  eventSaveQueue=task.catch(()=>{});
  return task;
});
ipcMain.handle('import-event', async () => {
  const result=await dialog.showOpenDialog(presenter,{title:'Открыть пакет мероприятия',properties:['openFile'],filters:[{name:'Пакет мероприятия',extensions:['pult']}]});
  if(result.canceled) return null;
  return readPackage(result.filePaths[0],path.join(app.getPath('userData'),'imported-events'));
});
ipcMain.handle('open-audio-files', async () => {
  const result = await dialog.showOpenDialog(presenter, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Аудиофайлы', extensions: ['mp3', 'm4a', 'wav', 'ogg'] }],
  });
  return result.canceled ? [] : result.filePaths;
});
ipcMain.handle('read-file', async (_event, filePath) => {
  if (typeof filePath !== 'string' || !allowedExtensions.has(path.extname(filePath).toLowerCase())) throw new Error('Неподдерживаемый файл');
  const type = path.extname(filePath).toLowerCase();
  if (type === '.pptx') {
    const bytes = await importPptx(filePath, path.join(app.getPath('userData'), 'pptx-cache'));
    return { name: path.basename(filePath), type: '.pdf', sourceType: '.pptx', bytes };
  }
  if (mediaExtensions.has(type)) {
    await fs.access(filePath);
    const id = crypto.randomUUID();
    mediaPaths.set(id, filePath);
    return { name: path.basename(filePath), type, mediaUrl: `pult-media://file/${id}` };
  }
  const bytes = await fs.readFile(filePath);
  return { name: path.basename(filePath), type, bytes };
});
ipcMain.handle('release-media', (_event, mediaUrl) => {
  try { mediaPaths.delete(new URL(mediaUrl).pathname.slice(1)); } catch { /* Ignore stale media URLs. */ }
});
ipcMain.handle('read-pdf-asset', async (_event, kind, filename) => {
  const directory = pdfAssetDirs[kind];
  if (!directory || typeof filename !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(filename)) throw new Error('Недопустимый ресурс PDF');
  return fs.readFile(path.join(__dirname, 'node_modules', 'pdfjs-dist', directory, filename));
});
ipcMain.handle('start-show', () => createAudience());
ipcMain.handle('close-show', () => {
  if (!audience || audience.isDestroyed()) return false;
  audience.close();
  return true;
});
ipcMain.on('stage-update', (_event, nextStage) => {
  if (!nextStage || !['idle', 'slide', 'placeholder', 'qr', 'media'].includes(nextStage.mode)) return;
  stage = displayWaiting && nextStage.mode==='media' ? {...nextStage,playing:false} : nextStage;
  audience?.webContents.send('stage', stage);
});
ipcMain.handle('choose-backdrop', async () => {
  const result = await dialog.showOpenDialog(presenter, { properties: ['openFile'], filters: [{ name: 'Изображение', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
  if (result.canceled) return null;
  const filePath = result.filePaths[0];
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return `data:${mime};base64,${(await fs.readFile(filePath)).toString('base64')}`;
});
ipcMain.handle('make-qr', async (_event, value) => {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Ссылка слишком длинная');
  return QRCode.toDataURL(value, { width: 420, margin: 2, color: { dark: '#132231', light: '#FFFFFF' } });
});
ipcMain.handle('remote-info', async () => {
  if (!remotePort) return { urls: [], qr: null };
  const urls = localAddresses().map(ip => `http://${ip}:${remotePort}/?token=${remoteToken}`);
  return { urls, qr: urls[0] ? await QRCode.toDataURL(urls[0], { width: 420, margin: 2 }) : null };
});

ipcMain.handle('preflight', async (_event, files) => {
  if(!Array.isArray(files)||files.length>10000)throw new Error('Слишком много материалов для проверки');
  const results=[];
  for(const file of files){
    const target=file.preparedPath || file.path;
    if(typeof target!=='string'||!allowedExtensions.has(path.extname(target).toLowerCase())){results.push({ok:false,message:'Неподдерживаемый файл'});continue;}
    try{await fs.access(target);const stat=await fs.stat(target);results.push(stat.isFile()&&stat.size>0?{ok:true}:{ok:false,message:'Файл пуст или недоступен'});}
    catch{results.push({ok:false,message:'Файл не найден или нет доступа. Укажите его расположение.'});}
  }
  return {files:results,target:{missing:displayRoute().missing,name:displayInfo().targetName,fullscreen:displayRoute().fullscreen},displays:screen.getAllDisplays().map(d=>({id:d.id,label:d.label,width:d.size.width,height:d.size.height}))};
});
ipcMain.handle('test-display',()=>{
  if(audience&&!audience.isDestroyed())throw new Error('Сначала закройте экран зрителей');
  if(testDisplayWindow&&!testDisplayWindow.isDestroyed()){testDisplayWindow.focus();return;}
  const route=displayRoute();if(route.missing)throw new Error('Выбранный экран отключён');const display=route.display;
  testDisplayWindow=new BrowserWindow({...display.bounds,fullscreen:true,frame:false,backgroundColor:'#202329',webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
  testDisplayWindow.loadFile(path.join(__dirname,'test-screen.html'));testDisplayWindow.on('closed',()=>{testDisplayWindow=null;});
});

ipcMain.handle('display-info',()=>displayInfo());
ipcMain.handle('choose-display',async(_event,preference)=>{
  if(!preference||!['auto','window','display'].includes(preference.mode))throw new Error('Выберите экран');
  const next={mode:preference.mode,id:preference.id,label:String(preference.label||'').slice(0,200),reconnect:preference.reconnect!==false};
  if(next.mode==='display'&&displayRoute(next).missing)throw new Error('Этот экран сейчас отключён. Подключите его или выберите другой.');
  const previous=displayPreference;displayPreference=next;try{await saveDisplayPreference();}catch(error){displayPreference=previous;throw error;}
  if(testDisplayWindow&&!testDisplayWindow.isDestroyed())testDisplayWindow.close();
  syncDisplays(true);return displayInfo();
});
