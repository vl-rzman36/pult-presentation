const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {writePackage,readPackage}=require('./event-package.cjs');
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'pult-package-test-'));
 const pdf=path.join(root,'Доклад.pdf'),pptx=path.join(root,'Доклад.pptx'),audio=path.join(root,'Фон.wav');
 await fs.writeFile(pdf,'%PDF-1.4\nTest slide');await fs.writeFile(pptx,'PPTX fixture');await fs.writeFile(audio,'Audio fixture');
 const event={name:'Тест переноса',state:{sections:[{id:'s',name:'Вступление',notes:'Объявить докладчика'}],files:[{id:'a',path:pptx,preparedPath:pdf,name:'Доклад.pptx',sectionId:'s',notes:'Личные заметки',page:2,videoOptions:{autoplay:true,loop:false,volume:.4,end:'next'}},{id:'b',path:pptx,preparedPath:pdf,sectionId:'s',page:1}],music:{fadeSeconds:2,volume:.8,playlists:[{id:'m',name:'Музыка',tracks:[{id:'t',path:audio,name:'Фон.wav',volume:.25}]}]},placeholder:{text:'Перерыв'}}};
 return {root,event,pdf,pptx,audio,package:path.join(root,'Мероприятие.pult')};
}
test('portable package preserves independent entries, notes, music and prepared PPTX without sources',async()=>{
 const f=await fixture();try{
  const summary=await writePackage(f.package,f.event,path.join(f.root,'cache'));assert.equal(summary.files,3);
  await Promise.all([f.pdf,f.pptx,f.audio].map(file=>fs.unlink(file)));
  const imported=await readPackage(f.package,path.join(f.root,'import'));
  assert.deepEqual(imported.state.files[0].videoOptions,f.event.state.files[0].videoOptions);assert.equal(imported.state.music.fadeSeconds,2);assert.equal(imported.state.music.playlists[0].tracks[0].volume,.25);assert.equal(imported.state.files[0].notes,'Личные заметки');assert.equal(imported.state.sections[0].notes,'Объявить докладчика');
  assert.equal(imported.state.files[0].path,imported.state.files[1].path);assert.notEqual(imported.state.files[0].page,imported.state.files[1].page);
  assert.match(await fs.readFile(imported.state.files[0].preparedPath,'utf8'),/^%PDF-/);
  assert.equal(await fs.readFile(imported.state.music.playlists[0].tracks[0].path,'utf8'),'Audio fixture');
 }finally{await fs.rm(f.root,{recursive:true,force:true});}
});
test('missing source leaves an existing destination untouched',async()=>{
 const f=await fixture();try{await fs.writeFile(f.package,'existing');await fs.unlink(f.audio);await assert.rejects(writePackage(f.package,f.event,f.root),/недоступен/);assert.equal(await fs.readFile(f.package,'utf8'),'existing');}finally{await fs.rm(f.root,{recursive:true,force:true});}
});
test('corrupted bytes reject the package and remove partial extraction',async()=>{
 const f=await fixture();try{await writePackage(f.package,f.event,f.root);const bytes=await fs.readFile(f.package);bytes[bytes.length-1]^=1;await fs.writeFile(f.package,bytes);const root=path.join(f.root,'import');await assert.rejects(readPackage(f.package,root),/повреждён/);assert.deepEqual(await fs.readdir(root),[]);}finally{await fs.rm(f.root,{recursive:true,force:true});}
});
test('path traversal is rejected before extraction',async()=>{
 const f=await fixture();try{await writePackage(f.package,f.event,f.root);const bytes=await fs.readFile(f.package);const length=bytes.readUInt32LE(8);const manifest=JSON.parse(bytes.subarray(12,12+length));manifest.assets[0].id='../outside.pdf';const json=Buffer.from(JSON.stringify(manifest));const header=Buffer.from(bytes.subarray(0,12));header.writeUInt32LE(json.length,8);await fs.writeFile(f.package,Buffer.concat([header,json,bytes.subarray(12+length)]));await assert.rejects(readPackage(f.package,path.join(f.root,'import')),/список файлов/);}finally{await fs.rm(f.root,{recursive:true,force:true});}
});
test('truncated package is rejected without creating an event',async()=>{
 const f=await fixture();try{await writePackage(f.package,f.event,f.root);const stat=await fs.stat(f.package);await fs.truncate(f.package,stat.size-10);await assert.rejects(readPackage(f.package,path.join(f.root,'import')),/неполный/);}finally{await fs.rm(f.root,{recursive:true,force:true});}
});
