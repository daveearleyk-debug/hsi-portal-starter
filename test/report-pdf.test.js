'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPortal } = require('../server');
const crypto = require('node:crypto');
function reportId(name) {
 const h=crypto.createHash('sha256').update(name).digest('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}
function viewer(name) { return `https://reports.spectora.com/v/reports/${reportId(name)}?ignoreClientComplete=true`; }
const env = { PORTAL_MODE: 'live', PORTAL_RANKINGS_ENABLED: 'false', SPECTORA_API_KEY: 'synthetic-placeholder', SPECTORA_COMPANY_ID: '42', PORTAL_SIGNING_SECRET: 'synthetic-signing-secret-at-least-32-bytes' };
function inspection(id, attrs = {}, attachmentIds = [], agent = '17') {
  return { id, attributes: { datetime: '2024-11-01T12:00:00Z', ...attrs }, relationships: {
    company: { data: { id: '42', type: 'company' } }, buying_agent: { data: { id: agent, type: 'connection' } }, selling_agent: { data: null },
    inspection_attachments: { data: attachmentIds.map(id => ({ id, type: 'inspection_attachment' })) }
  } };
}
function report(id, inspectionId, attrs = {}) {
  return { id:reportId(id), type: 'report', attributes: { inspection_id: inspectionId, published: true, name: 'Home inspection', pdf_url: `https://pdf.spectora.com/${id}`, ...attrs } };
}
function attachment(id, inspectionId, attrs = {}) {
  return { id, type: 'inspection_attachment', attributes: { inspection_id: inspectionId, internal_only: false, report: false, name: 'Home Inspection', file_file_name: 'Home_Inspection.pdf', file_url: `https://cdn.spectora.com/inspection_attachments/${id}.pdf`, ...attrs } };
}
function app(rows, reports = [], included = [], fail = false) {
  const paths = [];
  const portal = createPortal({ env, log: () => {}, upstreamGet: async path => {
    paths.push(path);
    if (path.startsWith('/v2/connections/')) return { data: { id: '17', attributes: { company_id: 42 } } };
    if (path.startsWith('/v2/connection_stats')) return { data: [{ id: '17', attributes: { company_id: 42 } }] };
    if (path.startsWith('/v2/reports/')) {
      if (fail) throw new Error('Reports unavailable');
      return {data: reports.flat().find(record => record.id === path.split('/').pop())};
    }
    if (path.startsWith('/v2/reports?')) {
      if (fail) throw new Error('Reports unavailable');
      const page = Number(new URL(path, 'https://example.test').searchParams.get('page[number]'));
      return { data: (reports[page - 1] || []).map(record => { const {pdf_url, ...attributes} = record.attributes; return {...record, attributes}; }), meta: { pagination: { current: page, last: reports.length || 1, next: page < reports.length ? page + 1 : null } } };
    }
    return { data: rows, included };
  } });
  return { portal, paths };
}
test('published report IDs produce scoped viewer links without PDF URLs or detail requests', async () => {
  const {portal,paths}=app([inspection('1'),inspection('2'),inspection('3',{},[],'18'),inspection('4',{canceled_at:'2026-11-01'})],[
    [report('a',1,{pdf_url:null}),report('b',3),report('c',1,{published:false})],
    [report('e',2),report('g',1,{company_id:99}),report('h',4)]
  ]);
  const result=await portal.getAgentPayload('17');
  assert.deepEqual(result.inspections.map(row=>row.reports.map(link=>link.url)),[[viewer('a')],[viewer('e')],[]]);
  assert.equal(result.inspections[0].reports[0].format,'viewer');
  await portal.getAgentPayload('17');
  assert.equal(paths.filter(path=>path.startsWith('/v2/reports?')).length,2);
  assert.equal(paths.filter(path=>path.startsWith('/v2/reports/')).length,0);
});
test('legacy Documents PDFs work; internal files, paperwork, unlinked and other-inspection files are excluded', async () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const { portal } = app([inspection('1', {datetime:'2022-12-31T23:59:59-07:00'}, ids), inspection('2')], [], [
    attachment('a', 1), attachment('b', 1, { internal_only: true }),
    attachment('c', 1, { name: 'Inspection Invoice', file_file_name: 'Inspection_Invoice.pdf' }),
    attachment('d', 2), attachment('unlinked', 1),
    attachment('e', 1, { file_file_name: 'Inspection.jpg' }),
    attachment('f', 1, { name: 'Boiler Maintenance', file_file_name: 'Inv_8761.pdf' }),
    attachment('g', 1, { file_url: 'javascript:alert(1)' })
  ]);
  const result = await portal.getAgentPayload('17');
  assert.deepEqual(result.inspections[0].reports, [{ name: 'Home Inspection', url: 'https://cdn.spectora.com/inspection_attachments/a.pdf' }]);
  assert.deepEqual(result.inspections[1].reports, []);
});
test('unavailable native report service preserves history and usable uploaded reports', async () => {
  const { portal } = app([inspection('1', {datetime:'2022-12-31T12:00:00Z'}, ['a']), inspection('2')], [], [attachment('a', 1)], true);
  const result = await portal.getAgentPayload('17');
  assert.equal(result.inspections.length, 2);
  assert.equal(result.inspections[0].reports.length, 1);
  assert.deepEqual(result.inspections[1].reports, []);
});

test('January 1, 2023 is native PDF only; older records use Documents only', async () => {
  const {portal, paths} = app([
    inspection('1', {datetime:'2022-12-31T23:59:59-07:00'}, ['old']),
    inspection('2', {datetime:'2023-01-01T00:00:00-07:00'}, ['new']),
    inspection('3', {datetime:'2023-05-01T12:00:00Z'}, ['restricted']),
    inspection('4', {datetime:'2024-01-01T12:00:00Z'}, ['unpublished'])
  ], [[report('old-native',1),report('new-native',2),report('null-pdf',3,{pdf_url:null}),report('unpublished',4,{published:false})]], [attachment('old',1),attachment('new',2),attachment('restricted',3),attachment('unpublished',4)]);
  const {inspections} = await portal.getAgentPayload('17');
  assert.deepEqual(inspections.map(row => row.reports.map(report => report.url)), [
    ['https://cdn.spectora.com/inspection_attachments/old.pdf'],
    [viewer('new-native')], [viewer('null-pdf')], []
  ]);
  assert.equal(paths.includes('/v2/reports/old-native'),false);
  assert.equal(paths.includes('/v2/reports/unpublished'),false);
});
test('viewer links use the supplied report UUID and reject malformed identifiers', async () => {
  const id='bd317357-3f4e-4b80-8637-85d7d937b6cc';
  const valid={id,type:'report',attributes:{inspection_id:1,published:true,name:'Residential Report'}};
  const bad=['../escape','https://attacker.test','not-an-id','',null,1].map(id=>({...valid,id}));
  const {portal,paths}=app([inspection('1')],[[valid,...bad]]);
  const result=await portal.getAgentPayload('17');
  assert.deepEqual(result.inspections[0].reports,[{name:'Residential Report',url:'https://reports.spectora.com/v/reports/bd317357-3f4e-4b80-8637-85d7d937b6cc?ignoreClientComplete=true',format:'viewer'}]);
  assert.equal(paths.some(path=>path.startsWith('/v2/reports/')),false);
});

test('report diagnostics expose HTTP status without logging API keys, IDs or response bodies', async () => {
  const entries=[];
  const {UpstreamHttpError}=require('../server');
  const portal=createPortal({env,log:entry=>entries.push(entry),upstreamGet:async path=>{
    if(path.startsWith('/v2/connections/'))return {data:{id:'17',attributes:{company_id:42}}};
    if(path.startsWith('/v2/connection_stats'))return {data:[{id:'17',attributes:{company_id:42}}]};
    if(path.startsWith('/v2/reports?'))throw new UpstreamHttpError(403);
    return {data:[inspection('1')]};
  }});
  const result=await portal.getAgentPayload('17');
  assert.equal(result.inspections.length,1);
  assert.deepEqual(result.inspections[0].reports,[]);
  assert.deepEqual(entries.find(entry=>entry.stage==='report_list'),{
    event:'spectora_report_lookup',stage:'report_list',result:'failed',upstreamStatus:403,reason:'upstream_http_error'
  });
  assert.equal(entries.some(entry=>entry.stage==='report_summary'),true);
  assert.equal(JSON.stringify(entries).includes(env.SPECTORA_API_KEY),false);
  assert.equal(JSON.stringify(entries).includes('inspection_id'),false);
});
