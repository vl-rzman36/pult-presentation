const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const { pipeline } = require('node:stream/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const { importPptx } = require('./pptx.cjs');
const MAGIC = Buffer.from('PULTPKG1');
const extensions = new Set(['.pdf','.pptx','.png','.jpg','.jpeg','.webp','.mp4','.webm','.mov','.mp3','.m4a','.wav','.ogg']);
const MAX_MANIFEST = 32 * 1024 * 1024;

async function hashFile(file) { const hash=crypto.createHash('sha256'); for await(const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
function validateEvent(event) {
  if (!event || typeof event.name !== 'string' || !event.state || !Array.isArray(event.state.files) || !Array.isArray(event.state.sections)) throw new Error('Неверный формат мероприятия');
  if (event.name.length > 120 || event.state.files.length > 10000 || event.state.sections.length > 1000) throw new Error('Слишком большое мероприятие');
  for (const file of event.state.files) if (!file || typeof file.path !== 'string' || (file.preparedPath != null && typeof file.preparedPath !== 'string')) throw new Error('Неверный материал');
  for (const section of event.state.sections) if (!section || typeof section.id !== 'string' || typeof section.name !== 'string') throw new Error('Неверный раздел');
  const music=event.state.music;
  if (music && !Array.isArray(music.playlists)) throw new Error('Неверный список плейлистов');
  for(const list of music?.playlists || []) {
    if (!Array.isArray(list.tracks)) throw new Error('Неверный плейлист');
    for(const track of list.tracks) if(typeof track.path !== 'string') throw new Error('Неверный аудиофайл');
  }
}
function references(event) {
  const refs=[];
  for(const file of event.state.files) { refs.push([file,'path']); if(file.preparedPath) refs.push([file,'preparedPath']); }
  for(const list of event.state.music?.playlists || []) for(const track of list.tracks) refs.push([track,'path']);
  return refs;
}
async function writePackage(destination, source, cacheRoot) {
  const event=structuredClone(source); validateEvent(event);
  const staging=await fs.mkdtemp(path.join(os.tmpdir(),'pult-export-'));
  const temporary=destination+'.'+crypto.randomUUID()+'.tmp';
  try {
    for(const file of event.state.files) {
      if(path.extname(file.path).toLowerCase()==='.pptx' && !file.preparedPath) {
        const pdf=await importPptx(file.path,cacheRoot);
        file.preparedPath=path.join(staging,crypto.randomUUID()+'.pdf');
        await fs.writeFile(file.preparedPath,pdf);
      }
    }
    const assets=[], mapped=new Map();
    for(const [object,key] of references(event)) {
      const original=object[key];
      if(!mapped.has(original)) {
        const ext=path.extname(original).toLowerCase();
        if(!extensions.has(ext)) throw new Error('Неподдерживаемый тип файла: '+path.basename(original));
        const id=`asset-${assets.length}${ext}`;
        const snapshot=path.join(staging,id);
        try { await fs.copyFile(original,snapshot); } catch { throw new Error('Файл не найден или недоступен: '+path.basename(original)); }
        const size=(await fs.stat(snapshot)).size;
        if(!size) throw new Error('Пустой файл: '+path.basename(original));
        assets.push({id,name:path.basename(original),size,sha256:await hashFile(snapshot)});
        mapped.set(original,id);
      }
      object[key]=mapped.get(original);
    }
    const manifest=Buffer.from(JSON.stringify({format:'pult-event',version:1,event,assets}));
    if(manifest.length>MAX_MANIFEST) throw new Error('Слишком много заметок или слишком большой фон');
    const header=Buffer.alloc(12);MAGIC.copy(header);header.writeUInt32LE(manifest.length,8);
    await fs.writeFile(temporary,Buffer.concat([header,manifest]));
    for(const asset of assets) await pipeline(createReadStream(path.join(staging,asset.id)),createWriteStream(temporary,{flags:'a'}));
    await fs.rename(temporary,destination);
    return {files:assets.length,bytes:(await fs.stat(destination)).size};
  } finally { await fs.unlink(temporary).catch(()=>{}); await fs.rm(staging,{recursive:true,force:true}); }
}
async function readPackage(source, importedRoot) {
  const handle=await fs.open(source,'r');
  let folder;
  try {
    const header=Buffer.alloc(12);
    const read=await handle.read(header,0,12,0);
    if(read.bytesRead!==12 || !header.subarray(0,8).equals(MAGIC)) throw new Error('Это не пакет мероприятия Пульта');
    const length=header.readUInt32LE(8);
    if(length<2 || length>MAX_MANIFEST) throw new Error('Повреждён заголовок пакета');
    const bytes=Buffer.alloc(length);
    if((await handle.read(bytes,0,length,12)).bytesRead!==length) throw new Error('Пакет обрезан');
    let manifest;try {manifest=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('Повреждён список материалов');}
    if(manifest.format!=='pult-event'||manifest.version!==1) throw new Error('Эта версия пакета пока не поддерживается');
    validateEvent(manifest.event);
    if(!Array.isArray(manifest.assets)||manifest.assets.length>10000) throw new Error('Неверный список файлов');
    const ids=new Set(); let total=12+length;
    for(const asset of manifest.assets) {
      if(!asset || !/^asset-\d+\.[a-z0-9]+$/.test(asset.id)||!extensions.has(path.extname(asset.id))||ids.has(asset.id)||!Number.isSafeInteger(asset.size)||asset.size<=0||asset.size>50*1024**3||!/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Повреждён список файлов');
      ids.add(asset.id);total+=asset.size;
    }
    if(total!==(await handle.stat()).size) throw new Error('Пакет неполный или повреждён');
    for(const [object,key] of references(manifest.event)) if(!ids.has(object[key])) throw new Error('В пакете отсутствует нужный файл');
    await fs.mkdir(importedRoot,{recursive:true});
    folder=await fs.mkdtemp(path.join(importedRoot,'event-'));
    let offset=12+length;
    for(const asset of manifest.assets) {
      const target=path.join(folder,asset.id);
      // Only validated generated names reach the filesystem, never paths from the event.
      await pipeline(createReadStream(source,{start:offset,end:offset+asset.size-1}),createWriteStream(target,{flags:'wx'}));
      if(await hashFile(target)!==asset.sha256) throw new Error('Файл повреждён: '+asset.name);
      offset+=asset.size;
    }
    for(const [object,key] of references(manifest.event)) object[key]=path.join(folder,object[key]);
    return manifest.event;
  } catch(error) { if(folder) await fs.rm(folder,{recursive:true,force:true});throw error; }
  finally {await handle.close();}
}
module.exports={writePackage,readPackage};
