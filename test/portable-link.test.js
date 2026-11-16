'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../public/app.js'),'utf8');
const token = (exp=Math.floor(Date.now()/1000)+3600) => Buffer.from(JSON.stringify({v:1,connectionId:'17',exp})).toString('base64url')+'.synthetic-signature';
async function browser(grant,denyClipboard=false,inspectionRows=[],extraStats={},rankings=null) {
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
 const state={clipboard:null,authorization:null,nodes,app,storage,fetchCalls:0};
 const payload={rankings,meta:{mode:'live'},company:{brand:{},appName:'HSI',name:'HSI',tagline:'',phone:'8674474663',bookingUrl:'https://example.test/book',whatsappUrl:'https://wa.me/18674474663',website:'https://example.test',license:'RHI'},agent:{firstName:'Example',lastName:'Agent'},tier:{label:'Partner'},stats:{totalInspections:1,buyingInspections:1,sellingInspections:0,...extraStats},inspections:inspectionRows};
 const context={URL,URLSearchParams,atob,Date,location,
  history:{replaceState(){location.hash=''}},
  sessionStorage:{setItem(k,v){storage.set(k,v)},getItem(k){return storage.get(k)}},
  navigator:{clipboard:{async writeText(value){if(denyClipboard)throw new Error('Denied');state.clipboard=value}}},
  document:{getElementById(){return app},createElement:node,createTextNode(text){return {textContent:text}},querySelector(){return theme},documentElement:{style:{setProperty(){}}}},
  portalModeCopy:{modeNotice(){return 'Live'}},
  async fetch(_url,options){state.fetchCalls++;state.authorization=options.headers.Authorization;return {ok:true,async json(){return payload}}}
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
 const field=state.nodes.find(n=>n.className==='portal-link-fallback');
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

const filterRows = [
 {date:'2026-10-16',location:'212 Woolgar Ave',services:'Walk Through Inspection',classification:'Buyer inspection',inspector:'Example',status:'Report Published',portalUrl:'https://portal.example.test/inspection/first'},
 {date:'2025-02-01',location:'2 Ward Crescent',services:'Residential Inspection',classification:'Pre-sale inspection',inspector:'Example',status:'Report Published',portalUrl:'https://portal.example.test/inspection/second'},
 {date:'2026-01-01',location:'9 Woolgar Ave',services:'WETT Inspection',classification:'Buyer inspection',inspector:'Example',status:'Report Published',portalUrl:'https://portal.example.test/inspection/third'}
];
function historyControls(state) {
 return {search:state.nodes.find(n=>n.id==='inspection-search'),type:state.nodes.find(n=>n.id==='inspection-type'),year:state.nodes.find(n=>n.id==='inspection-year'),clear:state.nodes.find(n=>n.textContent==='Clear filters'),count:state.nodes.find(n=>n.className==='history-count'),timeline:state.nodes.find(n=>n.className==='timeline')};
}
function visibleCards(controls) {return controls.timeline.children.filter(n=>n.tag==='article');}
function cardText(node) {return [node.textContent||'',...(node.children||[]).map(cardText)].join(' ');}
test('history searches addresses and services with case-insensitive multiword matching',async()=>{
 const state=await browser(token(),false,filterRows);const c=historyControls(state);
 assert.equal(visibleCards(c).length,3);
 assert.equal(visibleCards(c)[0].children[0].tag,'time');
 assert.equal(visibleCards(c)[0].children[0].children[2].textContent,'2026');
 assert.equal(visibleCards(c)[1].children[0].children[2].textContent,'2025');
 assert.equal(visibleCards(c)[0].children[0].datetime,'2026-10-16');
 c.search.value='  wOoLgAr   212 ';c.search.events.input();
 assert.equal(visibleCards(c).length,1);assert.match(cardText(visibleCards(c)[0]),/212 Woolgar Ave/);
 assert.equal(c.count.textContent,'Showing 1 of 3 inspections');
 c.search.value='wett';c.search.events.input();
 assert.equal(visibleCards(c).length,1);assert.match(cardText(visibleCards(c)[0]),/9 Woolgar Ave/);
 c.search.value='  ';c.search.events.input();assert.equal(visibleCards(c).length,3);
 assert.equal(state.fetchCalls,1);
});
test('type and year filters combine, show empty results, and clear together',async()=>{
 const state=await browser(token(),false,filterRows);const c=historyControls(state);
 assert.deepEqual(c.year.children.map(n=>n.value),['all','2026','2025']);
 c.type.value='pre-sale';c.type.events.change();
 assert.equal(visibleCards(c).length,1);assert.match(cardText(visibleCards(c)[0]),/2 Ward Crescent/);
 c.year.value='2026';c.year.events.change();
 assert.equal(visibleCards(c).length,0);assert.match(cardText(c.timeline),/No inspections match your filters/);
 assert.equal(c.count.textContent,'Showing 0 of 3 inspections');
 c.search.value='missing';c.search.events.input();c.clear.events.click();
 assert.equal(c.search.value,'');assert.equal(c.type.value,'all');assert.equal(c.year.value,'all');
 assert.equal(visibleCards(c).length,3);assert.equal(c.search.focused,true);
});
test('filtered cards retain their own inspection link and snapshot counts remain unchanged',async()=>{
 const state=await browser(token(),false,filterRows,{totalInspections:99});const c=historyControls(state);
 c.search.value='9 Woolgar';c.search.events.input();
 const card=visibleCards(c)[0];const anchor=card.children[1].children.find(n=>n.tag==='a');
 assert.equal(anchor.href,'https://portal.example.test/inspection/third');
 const total=state.nodes.find(n=>n.className==='metric'&&n.children.some(child=>child.textContent==='Total'));
 assert.ok(total.children.some(n=>n.textContent==='99'));
});
test('empty history and unmatched search text are handled without rendering HTML',async()=>{
 const empty=historyControls(await browser(token()));assert.equal(visibleCards(empty).length,0);
 assert.match(cardText(empty.timeline),/No inspections to display/);
 const state=await browser(token(),false,filterRows);const c=historyControls(state);
 c.search.value='<script>alert(1)</script>';c.search.events.input();
 assert.equal(visibleCards(c).length,0);assert.equal(state.nodes.some(n=>n.tag==='script'),false);
});

test('hero displays an overall rank and all three category ranks with tie labels',async()=>{
 const score=(rank,count,tied=false)=>({rank,count,tied});
 const ranking={available:true,population:28,overall:score(4,104),buyers:score(3,69),sellers:score(7,35),presales:score(16,3,true),updatedAt:'2026-11-15T12:00:00Z'};
 const state=await browser(token(),false,[],{},ranking);
 const hero=state.nodes.find(n=>n.className==='hero');
 const panel=hero.children.find(n=>n.className==='ranking-card');
 assert.ok(panel);
 const text=cardText(panel);
 for(const phrase of ['#4','Among 28 realtors','Buyers','Sellers','Pre-sales','#16','Tied'])assert.ok(text.includes(phrase),phrase);
 assert.ok(hero.children.indexOf(panel)>hero.children.findIndex(n=>n.className==='agent-name'));
 assert.equal(state.nodes.filter(n=>n.className?.startsWith('ranking-category')&&n.role==='group').length,4);
 assert.ok(state.nodes.some(n=>n['aria-label']==='Pre-sales: tied rank 16 of 28, 3 inspections'));
});
test('ranking outage shows an honest message while preserving portal and history controls',async()=>{
 const state=await browser(token(),false,filterRows,{}, {available:false});
 assert.ok(state.nodes.some(n=>n.textContent==='Rankings are temporarily unavailable.'));
 assert.ok(historyControls(state).search);
 assert.equal(visibleCards(historyControls(state)).length,3);
});
