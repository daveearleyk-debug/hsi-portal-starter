'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createPortal} = require('../server');
const env={PORTAL_MODE:'live',PORTAL_RANKINGS_ENABLED:'false',SPECTORA_API_KEY:'synthetic-placeholder',SPECTORA_COMPANY_ID:'42',PORTAL_SIGNING_SECRET:'synthetic-signing-secret-at-least-32-bytes'};
function inspection(id,date,attrs={},ids=[],agent='17'){
 return {id,attributes:{datetime:date,slug:'inspection-'+id,...attrs},relationships:{
  company:{data:{id:'42',type:'company'}},buying_agent:{data:{id:agent,type:'connection'}},selling_agent:{data:null},
  inspection_attachments:{data:ids.map(id=>({id,type:'inspection_attachment'}))}
 }};
}
function attachment(id,inspectionId,attrs={}){
 return {id,type:'inspection_attachment',attributes:{inspection_id:inspectionId,internal_only:false,report:false,name:'Home Inspection',file_file_name:'Home_Inspection.pdf',file_url:`https://cdn.spectora.com/inspection_attachments/${id}.pdf`,...attrs}};
}
function app(rows,included=[]){
 const paths=[];
 const portal=createPortal({env,log:()=>{},upstreamGet:async path=>{
  paths.push(path);
  if(path.startsWith('/v2/reports'))throw new Error('Report API must not be called');
  if(path.startsWith('/v2/connections/'))return {data:{id:'17',attributes:{company_id:42}}};
  if(path.startsWith('/v2/connection_stats'))return {data:[{id:'17',attributes:{company_id:42}}]};
  return {data:rows,included};
 }});
 return {portal,paths};
}
test('January 1 cutoff restores modern client portals and preserves older document PDFs',async()=>{
 const {portal,paths}=app([
  inspection('1','2022-12-31T23:59:59-07:00',{},['old']),
  inspection('2','2023-01-01T00:00:00-07:00',{},['new']),
  inspection('3','2026-11-01T12:00:00Z',{published_at:null})
 ],[attachment('old',1),attachment('new',2)]);
 const result=await portal.getAgentPayload('17');
 assert.deepEqual(result.inspections[0].reports,[{name:'Home Inspection',url:'https://cdn.spectora.com/inspection_attachments/old.pdf'}]);
 assert.equal(result.inspections[0].date,'2022-12-31');
 assert.deepEqual(result.inspections[1].reports,[{name:'Client portal',format:'portal',url:'https://portal.spectora.com/inspection/inspection-2'}]);
 assert.equal(result.inspections[2].reports[0].url,'https://portal.spectora.com/inspection/inspection-3');
 assert.equal(paths.some(path=>path.startsWith('/v2/reports')),false);
});
test('older records without a suitable document stay visible without a link',async()=>{
 const {portal}=app([inspection('1','2022-11-01T12:00:00Z',{},['invoice'])],[attachment('invoice',1,{name:'Inspection Invoice',file_file_name:'Inspection_Invoice.pdf'})]);
 const result=await portal.getAgentPayload('17');
 assert.equal(result.inspections.length,1);assert.deepEqual(result.inspections[0].reports,[]);
});
test('older document matching continues to exclude private, unlinked and mismatched files',async()=>{
 const {portal}=app([inspection('1','2022-11-01T12:00:00Z',{},['good','internal','other'])],[
  attachment('good',1),attachment('internal',1,{internal_only:true}),attachment('other',2),attachment('unlinked',1)
 ]);
 const result=await portal.getAgentPayload('17');assert.equal(result.inspections[0].reports.length,1);
 assert.equal(result.inspections[0].reports[0].url,'https://cdn.spectora.com/inspection_attachments/good.pdf');
});
test('invalid or missing slugs and canceled modern inspections have no client portal link',async()=>{
 for(const slug of [null,undefined,'','../escape','https://attacker.test','x?redirect=elsewhere']){
  const {portal}=app([inspection('1','2023-05-01T12:00:00Z',{slug})]);
  assert.deepEqual((await portal.getAgentPayload('17')).inspections[0].reports,[]);
 }
 const {portal}=app([inspection('1','2024-01-01T12:00:00Z',{canceled_at:'2024-01-02'})]);
 assert.deepEqual((await portal.getAgentPayload('17')).inspections[0].reports,[]);
});
test('client portal links remain scoped to authorized inspections',async()=>{
 const {portal}=app([inspection('1','2026-11-01T12:00:00Z'),inspection('2','2026-11-01T12:00:00Z',{},[],'18')]);
 const result=await portal.getAgentPayload('17');assert.equal(result.inspections.length,1);
 assert.equal(result.inspections[0].reports[0].url,'https://portal.spectora.com/inspection/inspection-1');
});
