import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHistory} from './history.mjs';
const fixture=()=>({files:[{id:'a',path:'a.pdf',page:1,time:0,notes:''}],sections:[{id:'s'}],music:{playlists:[],volume:.7,current:null,position:0}});
test('navigation and playback do not create undo entries, edits undo and redo',async()=>{
 let state=fixture(),buttons;const history=createHistory({capture:()=>state,apply:async s=>{state=s;},onChange:s=>buttons=s});history.reset();
 state.files[0].page=4;state.music.position=32;history.observe();assert.equal(buttons.undo,false);
 state.files=[];history.observe();assert.equal(buttons.undo,true);await history.undo();assert.equal(state.files[0].page,4);await history.redo();assert.equal(state.files.length,0);
});
test('new edit after undo discards redo and reset isolates events',async()=>{
 let state=fixture(),buttons;const history=createHistory({capture:()=>state,apply:async s=>{state=s;},onChange:s=>buttons=s});history.reset();state.files[0].notes='A';history.observe();await history.undo();state.files[0].notes='B';history.observe();assert.equal(buttons.redo,false);history.reset();assert.equal(buttons.undo,false);
});
test('typing is grouped; failed restoration retains undo',async()=>{
 let state=fixture(),fail=true;const history=createHistory({capture:()=>state,apply:async s=>{if(fail)throw Error('failed');state=s;}});history.reset();state.files[0].notes='A';history.observe('notes');state.files[0].notes='AB';history.observe('notes');await assert.rejects(history.undo());fail=false;await history.undo();assert.equal(state.files[0].notes,'');assert.equal(await history.undo(),false);
});
