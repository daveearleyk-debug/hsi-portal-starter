'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPortal}=require('../server');
const env={PORTAL_MODE:'live',SPECTORA_API_KEY:'synthetic-placeholder',SPECTORA_COMPANY_ID:'42',PORTAL_SIGNING_SECRET:'synthetic-signing-secret-at-least-32-bytes'};
function row(id,buyer,seller,company='42') {
 return {id,attributes:{datetime:'2026-11-01T12:00:00Z',property_address:'Example '+id},relationships:{company:{data:{id:company,type:'company'}},buying_agent:{data:buyer?{id:buyer,type:'connection'}:null},selling_agent:{data:seller?{id:seller,type:'connection'}:null}}};
}
function app(rows) {
 return createPortal({env,log:()=>{},upstreamGet:async p=>{
  if(p.startsWith('/v2/connections/')) return {data:{id:'17',attributes:{company_id:42}}};
  if(p.startsWith('/v2/connection_stats')) return {data:[{id:'17',attributes:{company_id:42,total_inspections_count:10,buying_inspections_count:6,selling_inspections_count:4}}]};
  return {data:rows};
 }});
}
test('includes buyer jobs and listing jobs with explicitly no buying agent, and labels pre-sales',async()=>{
 const result=await app([row('1','17','18'),row('2','18','17'),row('3',null,'17'),row('4',null,'18'),row('5','17','17'),row('6',null,null)]).getAgentPayload('17');
 assert.deepEqual(result.inspections.map(x=>[x.location,x.classification]),[['Example 1','Buyer inspection'],['Example 3','Pre-sale inspection'],['Example 5','Buyer inspection']]);
 assert.equal(result.stats.totalInspections,10);
 assert.equal(result.stats.buyingInspections,6);
 assert.equal(result.stats.sellingInspections,4);
 assert.equal(result.stats.preSaleInspections,1);
});
test('a missing buyer relationship is not treated as an explicitly unrepresented buyer',async()=>{
 const record=row('1',null,'17');delete record.relationships.buying_agent;
 await assert.rejects(()=>app([record]).getAgentPayload('17'),{statusCode:403});
});
test('pre-sale classification does not bypass company ownership checks',async()=>{
 await assert.rejects(()=>app([row('1',null,'17','99')]).getAgentPayload('17'),{statusCode:403});
});

test('pre-sale snapshot count is zero for buyer-only history',async()=>{
 const result=await app([row('1','17','18')]).getAgentPayload('17');
 assert.equal(result.stats.preSaleInspections,0);
});
