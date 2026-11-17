'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPortal } = require('../server');
const env = { PORTAL_MODE: 'live', PORTAL_RANKINGS_ENABLED: 'false', SPECTORA_API_KEY: 'synthetic-placeholder', SPECTORA_COMPANY_ID: '42', PORTAL_SIGNING_SECRET: 'synthetic-signing-secret-at-least-32-bytes' };
function inspection(id, attrs = {}, attachmentIds = [], agent = '17') {
  return { id, attributes: { datetime: '2022-11-01T12:00:00Z', ...attrs }, relationships: {
    company: { data: { id: '42', type: 'company' } }, buying_agent: { data: { id: agent, type: 'connection' } }, selling_agent: { data: null },
    inspection_attachments: { data: attachmentIds.map(id => ({ id, type: 'inspection_attachment' })) }
  } };
}
function report(id, inspectionId, attrs = {}) {
  return { id, type: 'report', attributes: { inspection_id: inspectionId, published: true, name: 'Home inspection', pdf_url: `https://pdf.spectora.com/${id}`, ...attrs } };
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
    if (path.startsWith('/v2/reports?')) {
      if (fail) throw new Error('Reports unavailable');
      const page = Number(new URL(path, 'https://example.test').searchParams.get('page[number]'));
      return { data: reports[page - 1] || [], meta: { pagination: { current: page, last: reports.length || 1, next: page < reports.length ? page + 1 : null } } };
    }
    return { data: rows, included };
  } });
  return { portal, paths };
}
test('PDFs are matched by authorized inspection, paginated, cached and restricted to published trusted links', async () => {
  const { portal, paths } = app([inspection('1'), inspection('2'), inspection('3', {}, [], '18'), inspection('4', { canceled_at: '2026-11-01' })], [
    [report('a', 1), report('b', 3), report('c', 1, { published: false }), report('d', 1, { pdf_url: null })],
    [report('e', 2), report('f', 1, { pdf_url: 'https://pdf.spectora.com.attacker.test/leak' }), report('g', 1, { company_id: 99 }), report('h', 4)]
  ]);
  const result = await portal.getAgentPayload('17');
  assert.deepEqual(result.inspections.map(row => row.reports.map(pdf => pdf.url)), [['https://pdf.spectora.com/a'], ['https://pdf.spectora.com/e'], []]);
  assert.equal(JSON.stringify(result).includes('portalUrl'), false);
  await portal.getAgentPayload('17');
  assert.equal(paths.filter(path => path.startsWith('/v2/reports?')).length, 2);
});
test('legacy Documents PDFs work; internal files, paperwork, unlinked and other-inspection files are excluded', async () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const { portal } = app([inspection('1', {}, ids), inspection('2')], [], [
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
  const { portal } = app([inspection('1', {}, ['a']), inspection('2')], [], [attachment('a', 1)], true);
  const result = await portal.getAgentPayload('17');
  assert.equal(result.inspections.length, 2);
  assert.equal(result.inspections[0].reports.length, 1);
  assert.deepEqual(result.inspections[1].reports, []);
});
