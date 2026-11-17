const {test}=require('node:test');const assert=require('node:assert/strict');const {resolveDisplay}=require('./display-routing.cjs');
const displays=[{id:1,label:'Laptop'},{id:2,label:'Projector'}];
test('automatic selects external, one display uses a window',()=>{assert.equal(resolveDisplay(displays,1).display.id,2);assert.equal(resolveDisplay([displays[0]],1).fullscreen,false);});
test('explicit selection can target primary or window mode',()=>{assert.equal(resolveDisplay(displays,1,{mode:'display',id:1}).fullscreen,true);assert.equal(resolveDisplay(displays,1,{mode:'window'}).fullscreen,false);});
test('missing selected display never silently falls back to primary',()=>{assert.equal(resolveDisplay([displays[0]],1,{mode:'display',id:2,label:'Projector'}).missing,true);});
test('unique label restores display with changed id',()=>{assert.equal(resolveDisplay([{id:9,label:'Projector'}],9,{mode:'display',id:2,label:'Projector'}).display.id,9);});
test('ambiguous labels are not selected automatically',()=>{assert.equal(resolveDisplay([{id:8,label:'Projector'},{id:9,label:'Projector'}],8,{mode:'display',id:2,label:'Projector'}).missing,true);});
