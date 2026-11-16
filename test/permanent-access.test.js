'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {createConfig,createPortal,verifyPortalAccess,createGrant} = require('../server');
const credential = byte => 'p1.'+Buffer.alloc(32,byte).toString('base64url');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const base = {PORTAL_MODE:'live',PORTAL_RANKINGS_ENABLED:'false',SPECTORA_API_KEY:'synthetic-placeholder',SPECTORA_COMPANY_ID:'42',PORTAL_SIGNING_SECRET:'synthetic-signing-secret-at-least-32-bytes'};
const config = entries => createConfig({...base,PORTAL_AGENT_ACCESS_HASHES:JSON.stringify(entries)});
function invoke(handler,id,grant) {
 return new Promise(resolve=>{
  const req={method:'GET',url:'/api/agent/'+id,headers:{authorization:'Bearer '+grant},socket:{}};
  const res={headersSent:false,writeHead(status){this.statusCode=status;this.headersSent=true},end(body){resolve({status:this.statusCode,body})}};
  handler(req,res);
 });
}
test('permanent access remains valid across time and is bound to the configured agent',()=>{
 const grant=credential(1),cfg=config({'17':digest(grant)});
 assert.equal(verifyPortalAccess(grant,'17',cfg,{now:4102444800}).type,'permanent');
 assert.throws(()=>verifyPortalAccess(grant,'18',cfg),{statusCode:401});
 assert.throws(()=>verifyPortalAccess(credential(2),'17',cfg),{statusCode:401});
});
test('removing an agent hash revokes that link without affecting other agents',()=>{
 const first=credential(1),second=credential(2);
 const cfg=config({'18':digest(second)});
 assert.throws(()=>verifyPortalAccess(first,'17',cfg),{statusCode:401});
 assert.equal(verifyPortalAccess(second,'18',cfg).type,'permanent');
});
test('rotating one agent hash invalidates its old link and accepts its new link',()=>{
 const old=credential(1),next=credential(3),cfg=config({'17':digest(next)});
 assert.throws(()=>verifyPortalAccess(old,'17',cfg),{statusCode:401});
 assert.equal(verifyPortalAccess(next,'17',cfg).type,'permanent');
});
test('temporary signed grants retain their existing expiration behavior',()=>{
 const cfg=config({}),grant=createGrant('17',base.PORTAL_SIGNING_SECRET,{now:1800000000,ttlSeconds:60});
 assert.equal(verifyPortalAccess(grant,'17',cfg,{now:1800000001}).type,'temporary');
 assert.throws(()=>verifyPortalAccess(grant,'17',cfg,{now:1800000060}),{statusCode:401});
});
test('invalid hash configuration and malformed permanent credentials fail closed',()=>{
 for(const value of ['null','[]','broken','{"17":"raw-secret"}','{"0":"'+digest('synthetic')+'"}']) {
  assert.throws(()=>createConfig({...base,PORTAL_AGENT_ACCESS_HASHES:value}));
 }
 const cfg=config({'17':digest(credential(1))});
 for(const grant of ['p1.','p1.short','p1.'+'a'.repeat(44),undefined]) {
  assert.throws(()=>verifyPortalAccess(grant,'17',cfg),{statusCode:401});
 }
});
test('permanent HTTP authorization rejects invalid codes before requesting upstream records',async()=>{
 const grant=credential(1),logs=[];let calls=0;
 const app=createPortal({env:{...base,PORTAL_AGENT_ACCESS_HASHES:JSON.stringify({'17':digest(grant)})},log:entry=>logs.push(entry),upstreamGet:async p=>{
  calls++;
  if(p.startsWith('/v2/connections/')) return {data:{id:'17',attributes:{company_id:42}}};
  if(p.startsWith('/v2/connection_stats')) return {data:[{id:'17',attributes:{company_id:42}}]};
  return {data:[]};
 }});
 assert.equal((await invoke(app.handleRequest,'17',credential(2))).status,401);
 assert.equal(calls,0);
 const response=await invoke(app.handleRequest,'17',grant);
 assert.equal(response.status,200);assert.equal(calls,3);
 assert.equal(response.body.includes(grant),false);
 assert.equal(JSON.stringify(logs).includes(grant),false);
});
