'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {nextSevenDays, normalizeAvailability, createPortal, createGrant} = require('../server');
const now = Date.parse('2026-11-16T18:00:00Z');
const dates = nextSevenDays(now, 'America/Edmonton');
function fixture() {
  return {data: [{attributes: {inspector_id: 29852, private_note: 'must-not-leak', days: dates.map((date, i) => ({date, slots: i === 0 ? [
    {datetime: `${date}T09:00:00-07:00`}, {datetime: `${date}T13:00:00-07:00`}, {datetime: `${date}T13:00:00-07:00`}
  ] : []}))}}, {attributes: {inspector_id: 999, days: []}}], meta: {time_zone: 'America/Edmonton', duration: 2.5}};
}
test('seven-day range starts on the local date, including year and DST rollover', () => {
  assert.deepEqual(nextSevenDays(Date.parse('2026-11-17T18:00:00Z'), 'America/Edmonton'), ['2026-11-17','2026-11-18','2026-11-19','2026-11-20','2026-11-21','2026-11-22','2026-11-23']);
  assert.equal(nextSevenDays(Date.parse('2026-12-29T18:00:00Z'), 'America/Edmonton')[6], '2027-01-04');
  assert.deepEqual(dates, ['2026-11-16','2026-11-17','2026-11-18','2026-11-19','2026-11-20','2026-11-21','2026-11-22']);
  assert.equal(nextSevenDays(Date.parse('2026-11-16T01:00:00Z'), 'America/Edmonton')[0], '2026-11-15');
  assert.equal(nextSevenDays(Date.parse('2027-01-01T18:00:00Z'), 'America/Edmonton')[0], '2027-01-01');
  assert.equal(nextSevenDays(Date.parse('2026-03-08T18:00:00Z'), 'America/Edmonton')[6], '2026-03-14');
});
test('only selected inspector open times are exposed, with past times removed and duplicates collapsed', () => {
  const payload = normalizeAvailability(fixture(), '29852', dates, now);
  assert.deepEqual(payload.days[0].slots, ['2026-11-16T13:00:00-07:00']);
  assert.equal(payload.days.length, 7);
  assert.equal(payload.duration, 2.5);
  assert.equal(JSON.stringify(payload).includes('must-not-leak'), false);
  assert.equal(JSON.stringify(payload).includes('inspector_id'), false);
});
test('missing days, wrong inspector and malformed or cross-day timestamps cannot appear as available', () => {
  assert.throws(() => normalizeAvailability(fixture(), '777', dates, now));
  let data = fixture(); data.data[0].attributes.days.pop();
  assert.throws(() => normalizeAvailability(data, '29852', dates, now));
  data = fixture(); data.data[0].attributes.days[0].slots = [{datetime: '2026-11-17T13:00:00-07:00'}];
  assert.throws(() => normalizeAvailability(data, '29852', dates, now));
  data = fixture(); data.data[0].attributes.days[0].slots = [{datetime: '13:00'}];
  assert.throws(() => normalizeAvailability(data, '29852', dates, now));
});
const env = {PORTAL_MODE:'live', SPECTORA_API_KEY:'synthetic-placeholder', SPECTORA_COMPANY_ID:'42', PORTAL_SIGNING_SECRET:'synthetic-signing-secret-at-least-32-bytes'};
function request(portal, grant) {
  return new Promise((resolve,reject) => portal.handleRequest({method:'GET',url:'/api/agent/17/availability',headers:grant ? {authorization:`Bearer ${grant}`} : {}}, {
    writeHead(status) {this.status = status;}, end(body) {resolve({status:this.status,payload:JSON.parse(body)});}
  }).catch(reject));
}
test('availability endpoint authenticates and checks company before reading shared slots', async () => {
  const calls = [];
  const portal = createPortal({env, log:()=>{}, now:()=>Math.floor(now/1000), nowMs:()=>now, upstreamGet: async path => {
    calls.push(path);
    if (path.startsWith('/v2/connections/')) return {data:{id:'17',attributes:{company_id:99}}};
    return fixture();
  }});
  assert.equal((await request(portal)).status,401); assert.equal(calls.length,0);
  const grant = createGrant('17',env.PORTAL_SIGNING_SECRET,{now:Math.floor(now/1000)});
  assert.equal((await request(portal,grant)).status,403);
  assert.equal(calls.length,1);
});
test('shared availability refresh is cached, coalesced, service-aware and expires after five minutes', async () => {
  let clock = now; let calls = 0;
  const portal = createPortal({env:{...env,AVAILABILITY_SERVICE_IDS:'12,34'},log:()=>{},nowMs:()=>clock,upstreamGet:async path => {
    calls++;
    const params = new URL(path,'https://example.test').searchParams;
    assert.equal(params.get('start_date'),dates[0]);assert.equal(params.get('end_date'),dates[6]);
    assert.deepEqual(params.getAll('service_ids[]'),['12','34']);
    return fixture();
  }});
  const [a,b] = await Promise.all([portal.getAvailability(),portal.getAvailability()]);
  assert.equal(a.available,true);assert.deepEqual(a,b);assert.equal(calls,1);
  await portal.getAvailability();assert.equal(calls,1);
  clock += 300001;await portal.getAvailability();assert.equal(calls,2);
});
test('upstream failure returns unavailable instead of false open times and backs off', async () => {
  let calls = 0;
  const portal = createPortal({env,log:()=>{},nowMs:()=>now,upstreamGet:async()=>{calls++;throw new Error('Synthetic outage');}});
  assert.deepEqual(await portal.getAvailability(),{available:false,reason:'Spectora connection unavailable'});
  await portal.getAvailability();assert.equal(calls,1);
});


test('Spectora Rails Mountain zone name is normalized and 30-minute availability is retained', () => {
  const response = fixture();
  response.meta.time_zone = 'Mountain Time (US & Canada)';
  response.meta.duration = 0.5;
  const payload = normalizeAvailability(response, '29852', dates, now);
  assert.equal(payload.available, true);
  assert.equal(payload.timeZone, 'America/Denver');
  assert.equal(payload.duration, 0.5);
  assert.deepEqual(payload.days[0].slots, ['2026-11-16T13:00:00-07:00']);
});

test('an unrecognized upstream zone cannot silently shift available times', () => {
  const response = fixture(); response.meta.time_zone = 'Unrecognized Company Zone';
  assert.throws(() => normalizeAvailability(response, '29852', dates, now));
});

test('local midnight advances the cached range even before its five-minute expiry',async()=>{
 let clock=Date.parse('2026-01-18T06:59:00Z');const ranges=[];
 const portal=createPortal({env,log:()=>{},nowMs:()=>clock,upstreamGet:async path=>{
  const params=new URL(path,'https://example.test').searchParams;
  ranges.push([params.get('start_date'),params.get('end_date')]);
  return {data:[{attributes:{inspector_id:29852,days:nextSevenDays(clock,'America/Edmonton').map(date=>({date,slots:[]}))}}],meta:{time_zone:'America/Edmonton',duration:2}};
 }});
 const before=await portal.getAvailability();clock+=120000;const after=await portal.getAvailability();
 assert.equal(before.days[0].date,'2026-01-17');assert.equal(after.days[0].date,'2026-01-18');
 assert.deepEqual(ranges,[['2026-01-17','2026-01-23'],['2026-01-18','2026-01-24']]);
});
