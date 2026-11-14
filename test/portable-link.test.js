'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const token = (exp=Math.floor(Date.now()/1000)+3600) => Buffer.from(JSON.stringify({v:1,connectionId:'17',exp})).toString('base64url')+'.synthetic-signature';
async function browser(grant,denyClipboard=false,inspectionRows=[],extraStats={}) {
 const nodes=[];
 function node(tag) {
  const n={tag,children:[],events:{},hidden:false,value:'',style:{setProperty(){}},
   append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items},
   setAttribute(k,v){this[k]=v},addEventListener(k,fn){this.events[k]=fn},
   focus(){this.focused=true},select(){this.selected=true}};
  nodes.push(n);return n;
 }
 const app=node('main'),theme=node('meta'),storage=new Map();
 const location={origin:'https://portal.example.test',pathname:'/agent/17',search:'',hash:'#grant='+grant};
 const state={clipboard:null,authorization:null,nodes,app,storage};
 const payload={meta:{mode:'live'},company:{brand:{},appName:'HSI',name:'HSI',tagline:'',phone:'8674474663',bookingUrl:'https://example.test/book',whatsappUrl:'https://wa.me/18674474663',website:'https://example.test',license:'RHI'},agent:{firstName:'Example',lastName:'Agent'},tier:{label:'Partner'},stats:{totalInspections:1,buyingInspections:1,sellingInspections:0,...extraStats},inspections:inspectionRows};
 const context={URL,URLSearchParams,atob,Date,location,
  history:{replaceState(){location.hash=''}},
  sessionStorage:{setItem(k,v){storage.set(k,v)},getItem(k){return storage.get(k)}},
  navigator:{clipboard:{async writeText(value){if(denyClipboard)throw new Error('Denied');state.clipboard=value}}},
  document:{getElementById(){return app},createElement:node,createTextNode(text){return {textContent:text}},querySelector(){return theme},documentElement:{style:{setProperty(){}}}},
  portalModeCopy:{modeNotice(){return 'Live'}},
  async fetch(_url,options){state.authorization=options.headers.Authorization;return {ok:true,async json(){return payload}}}
 };
 vm.runInNewContext(source,context);
 await new Promise(setImmediate);
 state.button=nodes.find(n=>n.tag==='button'&&n.textContent==='Copy portal link');
 return state;
}
test('copied link opens the same authorized portal in a fresh second-browser session',async()=>{
 const grant=token();
 const first=await browser(grant);
 assert.ok(first.button);
 await first.button.events.click();
 const link=new URL(first.clipboard);
 assert.equal(link.origin,'https://portal.example.test');
 assert.equal(link.pathname,'/agent/17');
 assert.equal(new URLSearchParams(link.hash.slice(1)).get('grant'),grant);
 const second=await browser(new URLSearchParams(link.hash.slice(1)).get('grant'));
 assert.equal(second.authorization,'Bearer '+grant);
 assert.ok(second.button);
});
test('clipboard denial provides a selected manual-copy field',async()=>{
 const grant=token();const state=await browser(grant,true);
 await state.button.events.click();
 const field=state.nodes.find(n=>n.tag==='input');
 assert.equal(field.hidden,false);assert.equal(field.selected,true);
 assert.equal(new URLSearchParams(new URL(field.value).hash.slice(1)).get('grant'),grant);
});
test('a tab cannot extend or copy an expired access grant',async()=>{
 const state=await browser(token(Math.floor(Date.now()/1000)-1));
 await state.button.events.click();
 assert.equal(state.clipboard,null);
 assert.ok(state.nodes.some(n=>n.textContent?.includes('has expired')));
});

test('permanent access link copies into a new browser without needing an expiry timestamp',async()=>{
 const grant='p1.'+Buffer.alloc(32,9).toString('base64url');
 const first=await browser(grant);await first.button.events.click();
 const copied=new URLSearchParams(new URL(first.clipboard).hash.slice(1)).get('grant');
 const second=await browser(copied);
 assert.equal(second.authorization,'Bearer '+grant);
 assert.ok(first.nodes.some(n=>n.textContent?.includes('Permanent private link copied')));
});

test('history renders both buyer and pre-sale labels under a shared history heading',async()=>{
 const common={date:'2026-11-01',services:'Inspection',inspector:'Example',status:'Report Published'};
 const state=await browser(token(),false,[{...common,location:'Example 1',classification:'Buyer inspection'},{...common,location:'Example 2',classification:'Pre-sale inspection'}]);
 assert.ok(state.nodes.some(n=>n.textContent==='Inspection History'));
 assert.ok(state.nodes.some(n=>n.textContent==='Buyer inspection'));
 assert.ok(state.nodes.some(n=>n.textContent==='Pre-sale inspection'));
});

test('relationship snapshot renders a separate pre-sale metric with its value',async()=>{
 const state=await browser(token(),false,[],{preSaleInspections:7});
 const tile=state.nodes.find(n=>n.className==='metric'&&n.children.some(c=>c.textContent==='Pre-sales'));
 assert.ok(tile);
 assert.ok(tile.children.some(c=>c.textContent==='7'));
 assert.ok(state.nodes.some(n=>n.textContent==='Pre-sales are included in the selling count.'));
});
