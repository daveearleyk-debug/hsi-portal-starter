'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {buildRankingIndex,fetchRankingPages,createPortal}=require('../server');
function stat(id,total,buyers,sellers,company=42){return {id,attributes:{company_id:company,total_inspections_count:total,buying_inspections_count:buyers,selling_inspections_count:sellers,email:'synthetic-private@example.test'}};}
function inspection(id,buyer,seller,company='42',attrs={}){return {id,attributes:{datetime:'2026-01-01T12:00:00Z',...attrs},relationships:{company:{data:{id:company,type:'company'}},buying_agent:{data:buyer?{id:buyer,type:'connection'}:null},selling_agent:{data:seller?{id:seller,type:'connection'}:null}}};}
const stats=[stat('17',10,6,4),stat('18',10,2,8),stat('19',4,4,0)];
const rows=[inspection('1',null,'17'),inspection('2','17','18'),inspection('3','17','17'),inspection('4',null,'18'),inspection('5',null,'18','42',{canceled_at:'2026-01-02'}),inspection('6',null,'99')];
test('competition rankings use each metric and share ties without double-counting pre-sales in overall',()=>{
 const ranks=buildRankingIndex(stats,[...rows,rows[0]],'42');
 assert.deepEqual(ranks.get('17').overall,{rank:1,tied:true,count:10});
 assert.deepEqual(ranks.get('19').overall,{rank:3,tied:false,count:4});
 assert.equal(ranks.get('17').buyers.rank,1);assert.equal(ranks.get('18').buyers.rank,3);
 assert.equal(ranks.get('18').sellers.rank,1);
 assert.deepEqual(ranks.get('17').presales,{rank:1,tied:true,count:1});
 assert.deepEqual(ranks.get('19').presales,{rank:3,tied:false,count:0});
 assert.equal(ranks.get('17').population,3);
 assert.equal(JSON.stringify(ranks.get('17')).includes('synthetic-private'),false);
});
test('ranking index rejects cross-company records, malformed relationships and invalid count fields',()=>{
 assert.throws(()=>buildRankingIndex([stat('17',1,1,0,99)],[],'42'),{statusCode:403});
 assert.throws(()=>buildRankingIndex(stats,[inspection('1',null,'17','99')],'42'),{statusCode:403});
 const record=inspection('1',null,'17');delete record.relationships.buying_agent;
 assert.throws(()=>buildRankingIndex(stats,[record],'42'),{statusCode:403});
 assert.throws(()=>buildRankingIndex([stat('17',-1,1,0)],[],'42'));
 assert.throws(()=>buildRankingIndex([stats[0],stats[0]],[],'42'));
});
test('ranking pagination uses bounded documented pages and never follows upstream URLs',async()=>{
 const paths=[];const result=await fetchRankingPages(async path=>{
  paths.push(path);const page=Number(new URL(path,'https://example.test').searchParams.get('page[number]'));
  return {data:[{id:String(page)}],meta:{pagination:{current:page,last:3,records:3,...(page<3?{next:page+1}:{})}},links:{next:'https://untrusted.invalid/credential-target'}};
 },'/v2/connection_stats',{});
 assert.equal(result.length,3);assert.equal(paths.length,3);
 assert.ok(paths.every(p=>p.startsWith('/v2/connection_stats?')));
 assert.ok(paths.every(p=>p.includes('page[size]=200')));
});
test('ranking pagination fails on incomplete totals and page mismatches',async()=>{
 await assert.rejects(()=>fetchRankingPages(async()=>({data:[],meta:{pagination:{current:1,records:4}}}),'/v2/connection_stats',{}));
 await assert.rejects(()=>fetchRankingPages(async()=>({data:[],meta:{pagination:{current:2}}}),'/v2/connection_stats',{}));
});
function integration({fail=false}={}){
 let now=1800000000000;const calls=[];
 const portal=createPortal({env:{PORTAL_MODE:'live',SPECTORA_API_KEY:'synthetic-placeholder',SPECTORA_COMPANY_ID:'42',PORTAL_SIGNING_SECRET:'synthetic-signing-secret-at-least-32-bytes'},log:()=>{},nowMs:()=>now,upstreamGet:async path=>{
  calls.push(path);const url=new URL(path,'https://example.test');
  if(url.pathname.startsWith('/v2/connections/')){const id=url.pathname.split('/').pop();return {data:{id,attributes:{company_id:42,first_name:'Example'}}};}
  if(url.pathname==='/v2/connection_stats'){
   const id=url.searchParams.get('filter[id]');if(id)return {data:stats.filter(r=>r.id===id)};
   if(fail)throw new Error('Synthetic upstream outage');
   return {data:stats,meta:{pagination:{current:1,records:3}}};
  }
  if(url.searchParams.has('filter[connection_id]'))return {data:rows};
  const page=Number(url.searchParams.get('page[number]'));
  return {data:page===1?rows.slice(0,3):rows.slice(3),meta:{pagination:{current:page,last:2,records:6,...(page===1?{next:2}:{})}}};
 }});
 return {portal,calls,advance(ms){now+=ms},globalCalls(){return calls.filter(p=>!p.includes('filter[')&&!p.startsWith('/v2/connections/')).length}};
}
test('live portal includes only the authorized agent ranking and caches shared global work for 15 minutes',async()=>{
 const fixture=integration();
 const first=await fixture.portal.getAgentPayload('17');assert.equal(first.rankings.overall.rank,1);
 assert.equal(fixture.globalCalls(),3);assert.equal(first.rankings.population,3);
 assert.equal(Object.hasOwn(first.rankings,'17'),false);assert.equal(JSON.stringify(first).includes('synthetic-private'),false);
 const second=await fixture.portal.getAgentPayload('18');assert.equal(second.rankings.buyers.rank,3);assert.equal(fixture.globalCalls(),3);
 fixture.advance(15*60*1000+1);await fixture.portal.getAgentPayload('17');assert.equal(fixture.globalCalls(),6);
});
test('a global ranking error does not block the authorized portal or retry repeatedly',async()=>{
 const fixture=integration({fail:true});const first=await fixture.portal.getAgentPayload('17');
 assert.equal(first.rankings.available,false);assert.ok(first.inspections.length>0);
 const count=fixture.globalCalls();await fixture.portal.getAgentPayload('17');assert.equal(fixture.globalCalls(),count);
});

test('simultaneous agent visits share one ranking refresh',async()=>{
 const fixture=integration();
 const [first,second]=await Promise.all([fixture.portal.getAgentPayload('17'),fixture.portal.getAgentPayload('18')]);
 assert.equal(first.rankings.available,true);assert.equal(second.rankings.available,true);
 assert.equal(fixture.globalCalls(),3);
});
