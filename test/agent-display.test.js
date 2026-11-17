'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {createPortal,createConfig,SECURITY_HEADERS} = require('../server');
const base = {PORTAL_MODE:'live',PORTAL_RANKINGS_ENABLED:'false',SPECTORA_API_KEY:'synthetic-placeholder',SPECTORA_COMPANY_ID:'42',PORTAL_SIGNING_SECRET:'synthetic-signing-secret-at-least-32-bytes'};
function row(id,buying,selling,attributes={}) {
 return {id,attributes:{datetime:'2026-10-01T12:00:00Z',...attributes},relationships:{company:{data:{id:'42',type:'company'}},buying_agent:{data:buying?{id:buying,type:'connection'}:null},selling_agent:{data:selling?{id:selling,type:'connection'}:null}}};
}
function app({image,rows}={}) {
 return createPortal({env:{...base},log:()=>{},upstreamGet:async path=>{
  if(path.startsWith('/v2/connections/')) return {data:{id:'17',attributes:{company_id:42,image}}};
  if(path.startsWith('/v2/connection_stats')) return {data:[{id:'17',attributes:{company_id:42}}]};
  return {data:rows||[]};
 }});
}
test('buyer-only history includes dual-role buyer and excludes seller-only and unrelated records',async()=>{
 const rows=[row('1','17','18'),row('2','18','17'),row('3','17','17'),row('4','18',null)];
 const result=await app({rows}).getAgentPayload('17');
 assert.equal(result.inspections.length,2);
});
test('uses trusted Spectora profile photo and blocks lookalike and non-HTTPS image URLs',async()=>{
 const url='https://cdn.spectora.com/users/images/example/photo.png?version=1';
 assert.equal((await app({image:url}).getAgentPayload('17')).agent.photoUrl,url);
 for(const image of ['https://cdn.spectora.com.attacker.test/users/images/photo.png','http://cdn.spectora.com/users/images/photo.png','https://user:pass@cdn.spectora.com/users/images/photo.png']) {
  assert.equal((await app({image}).getAgentPayload('17')).agent.photoUrl,'/assets/mock-agent.svg');
 }
 assert.match(SECURITY_HEADERS['Content-Security-Policy'],/img-src 'self' https:\/\/cdn\.spectora\.com;/);
});
test('modern inspections receive client portal links in the reports collection',async()=>{
 const rows=[row('1','17','18',{slug:'11111111-1111-1111-1111-111111111111',published_at:'2026-10-02'}),row('2','17',null,{slug:'22222222-2222-2222-2222-222222222222'}),row('3','18','17',{slug:'33333333-3333-3333-3333-333333333333'}),row('4','17',null,{slug:'canceled-example',canceled_at:'2026-10-03'})];
 const result=await app({rows}).getAgentPayload('17');
 assert.equal(result.inspections.length,3);
 for (const inspection of result.inspections) {
  assert.equal(Object.hasOwn(inspection,'portalUrl'),false);
  if (inspection.status==='Canceled') assert.deepEqual(inspection.reports,[]);
  else assert.equal(inspection.reports[0].format,'portal');
 }
 assert.equal(Object.hasOwn(result.inspections[2],'portalUrl'),false);
 assert.equal(JSON.stringify(result).includes('33333333-3333-3333-3333-333333333333'),false);
});
test('missing, malformed and externally supplied slugs never create a link',async()=>{
 for(const slug of [undefined,null,'','../escape','https://attacker.test','example?redirect=elsewhere','example#fragment','x'.repeat(201)]) {
  const result=await app({rows:[row('1','17',null,{slug})]}).getAgentPayload('17');
  assert.equal(Object.hasOwn(result.inspections[0],'portalUrl'),false);
 }
});

test('buyer history uses the API street address without including client details',async()=>{
 const result=await app({rows:[row('1','17',null,{property_address:'123 Example Street',buyer_name:'Synthetic Client',quote:'999',slug:'example-report'})]}).getAgentPayload('17');
 assert.equal(result.inspections[0].location,'123 Example Street');
 assert.equal(JSON.stringify(result).includes('Synthetic Client'),false);
 assert.equal(JSON.stringify(result).includes('999'),false);
});
