'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createPortal} = require('../server');
const env = {PORTAL_MODE:'live',SPECTORA_API_KEY:'synthetic-placeholder',SPECTORA_COMPANY_ID:'42',PORTAL_SIGNING_SECRET:'synthetic-test-secret-at-least-32-bytes'};
function app(companyId) {
 return createPortal({env,log:()=>{},upstreamGet:async path=>{
  if(path.startsWith('/v2/connections/')) return {data:{id:'17',attributes:{company_id:companyId,first_name:'Example'}}};
  if(path.startsWith('/v2/connection_stats')) return {data:[{id:'17',attributes:{company_id:companyId,total_inspections_count:1,first_inspection_date:'2024-01-10T23:00:00.000Z',last_inspection_date:'2026-10-27T15:00:00.000Z'}}]};
  return {data:[{id:'123',attributes:{company_id:companyId,datetime:'2026-10-27T09:00:00-06:00'},relationships:{company:{data:{id:'42',type:'company'}},buying_agent:{data:{id:'17',type:'connection'}},selling_agent:{data:null}}}]};
 }});
}
test('numeric company attributes and timestamp dates map into usable live dashboard data',async()=>{
 const data=await app(42).getAgentPayload('17');
 assert.equal(data.meta.mode,'live');
 assert.equal(data.stats.firstInspection,'2024-01-10');
 assert.equal(data.stats.lastInspection,'2026-10-27');
 assert.ok(Number.isFinite(new Date(data.stats.firstInspection+'T00:00:00').getTime()));
});
test('numeric compatibility still rejects wrong, missing and ambiguous company IDs',async()=>{
 for(const value of [43,0,-42,null,undefined,{},['42'],true,'042','42.0',42.5]) {
  await assert.rejects(()=>app(value).getAgentPayload('17'),{statusCode:403});
 }
});
