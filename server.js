#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const SAMPLE_PATH = path.join(ROOT, 'data', 'sample-agent.json');
const SPECTORA_ORIGIN = 'https://connect.spectora.com';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 1_000_000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.vcf': 'text/vcard; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': "default-src 'self'; img-src 'self' https://cdn.spectora.com; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'X-Frame-Options': 'DENY'
});

function loadEnvFile(filePath = path.join(ROOT, '.env'), env = process.env) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) throw new Error(`Invalid .env line for ${filePath}`);
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (env[match[1]] === undefined) env[match[1]] = value;
  }
}

function validatedHttpsUrl(value, name) {
  if (!value) return value;
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a valid HTTPS URL`); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error(`${name} must be a valid HTTPS URL`);
  return url.href;
}

function validatedColor(value, name) {
  if (!value) return value;
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new Error(`${name} must be a six-digit hex color`);
  return value.toLowerCase();
}

function validatedAssetPath(value, name) {
  if (!value) return value;
  if (!/^\/assets\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) || value.includes('..')) {
    throw new Error(`${name} must be a local /assets/ path without traversal`);
  }
  return value;
}

function validatedPositiveDecimalId(value, name) {
  const text = String(value ?? '');
  if (!/^[1-9][0-9]*$/.test(text)) throw new Error(`${name} must be a positive decimal identifier`);
  return text;
}

function createConfig(env = process.env) {
  const mode = env.PORTAL_MODE || 'demo';
  if (!['demo', 'live'].includes(mode)) throw new Error('PORTAL_MODE must be either demo or live');
  if (mode === 'live') {
    const missing = ['SPECTORA_API_KEY', 'SPECTORA_COMPANY_ID', 'PORTAL_SIGNING_SECRET'].filter(name => !env[name]);
    if (missing.length) throw new Error('Live mode requires SPECTORA_API_KEY, SPECTORA_COMPANY_ID, and PORTAL_SIGNING_SECRET');
    if (Buffer.byteLength(env.PORTAL_SIGNING_SECRET, 'utf8') < 32) throw new Error('PORTAL_SIGNING_SECRET must be at least 32 bytes');
    validatedPositiveDecimalId(env.SPECTORA_COMPANY_ID, 'SPECTORA_COMPANY_ID');
  }
  const port = Number(env.PORT || 3005);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  return {
    mode,
    port,
    apiKey: env.SPECTORA_API_KEY || '',
    companyId: mode === 'live' ? validatedPositiveDecimalId(env.SPECTORA_COMPANY_ID, 'SPECTORA_COMPANY_ID') : '',
    signingSecret: env.PORTAL_SIGNING_SECRET || '',
    agentAccessHashes: parseAgentAccessHashes(env.PORTAL_AGENT_ACCESS_HASHES),
    rankingsEnabled: env.PORTAL_RANKINGS_ENABLED !== 'false',
    availabilityInspectorId: validatedPositiveDecimalId(env.AVAILABILITY_INSPECTOR_ID || '29852', 'AVAILABILITY_INSPECTOR_ID'),
    availabilityTimeZone: env.AVAILABILITY_TIME_ZONE || 'America/Edmonton',
    availabilityServiceIds: (env.AVAILABILITY_SERVICE_IDS || '').split(',').map(id => id.trim()).filter(Boolean)
      .map(id => validatedPositiveDecimalId(id, 'AVAILABILITY_SERVICE_IDS')),
    upstreamTimeoutMs: boundedInteger(env.UPSTREAM_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 100, 30_000),
    upstreamMaxBytes: boundedInteger(env.UPSTREAM_MAX_BYTES, DEFAULT_MAX_BYTES, 1024, 5_000_000),
    rateLimitMax: boundedInteger(env.RATE_LIMIT_MAX, 60, 1, 1000),
    rateLimitWindowMs: boundedInteger(env.RATE_LIMIT_WINDOW_MS, 60_000, 1000, 3_600_000),
    branding: {
      appName: env.PORTAL_APP_NAME,
      name: env.COMPANY_NAME,
      tagline: env.COMPANY_TAGLINE,
      license: env.COMPANY_LICENSE,
      phone: env.COMPANY_PHONE,
      website: validatedHttpsUrl(env.COMPANY_WEBSITE, 'COMPANY_WEBSITE'),
      bookingUrl: validatedHttpsUrl(env.BOOKING_URL, 'BOOKING_URL'),
      whatsappUrl: validatedHttpsUrl(env.WHATSAPP_URL, 'WHATSAPP_URL'),
      brand: {
        primary: validatedColor(env.BRAND_PRIMARY_COLOR, 'BRAND_PRIMARY_COLOR'),
        accentText: validatedColor(env.BRAND_ACCENT_TEXT_COLOR, 'BRAND_ACCENT_TEXT_COLOR'),
        ink: validatedColor(env.BRAND_INK_COLOR, 'BRAND_INK_COLOR'),
        muted: validatedColor(env.BRAND_MUTED_COLOR, 'BRAND_MUTED_COLOR'),
        surface: validatedColor(env.BRAND_SURFACE_COLOR, 'BRAND_SURFACE_COLOR'),
        background: validatedColor(env.BRAND_BACKGROUND_COLOR, 'BRAND_BACKGROUND_COLOR'),
        border: validatedColor(env.BRAND_BORDER_COLOR, 'BRAND_BORDER_COLOR'),
        success: validatedColor(env.BRAND_SUCCESS_COLOR, 'BRAND_SUCCESS_COLOR'),
        focus: validatedColor(env.BRAND_FOCUS_COLOR, 'BRAND_FOCUS_COLOR')
      }
    },
    demoAgent: {
      firstName: env.DEMO_AGENT_FIRST_NAME,
      lastName: env.DEMO_AGENT_LAST_NAME,
      agency: env.DEMO_AGENT_AGENCY,
      city: env.DEMO_AGENT_CITY,
      state: env.DEMO_AGENT_STATE,
      photoUrl: validatedAssetPath(env.DEMO_AGENT_PHOTO_PATH, 'DEMO_AGENT_PHOTO_PATH')
    },
    demoTier: {
      label: env.DEMO_TIER_LABEL
    }
  };
}

function parseAgentAccessHashes(value) {
  const result = Object.create(null);
  if (!value) return result;
  if (value.length > 100000) throw new Error('PORTAL_AGENT_ACCESS_HASHES is too large');
  let entries;
  try { entries = JSON.parse(value); } catch { throw new Error('PORTAL_AGENT_ACCESS_HASHES must be a JSON object'); }
  if (!entries || Array.isArray(entries) || typeof entries !== 'object' || Object.keys(entries).length > 500) {
    throw new Error('PORTAL_AGENT_ACCESS_HASHES must contain at most 500 agent/hash pairs');
  }
  for (const [id, hash] of Object.entries(entries)) {
    validatedPositiveDecimalId(id, 'Permanent access connection ID');
    if (typeof hash !== 'string' || !/^[a-fA-F0-9]{64}$/.test(hash)) {
      throw new Error('Permanent access values must be SHA-256 hashes');
    }
    result[id] = hash.toLowerCase();
  }
  return result;
}

function verifyPortalAccess(grant, connectionId, config, options = {}) {
  validatedPositiveDecimalId(connectionId, 'Spectora connection ID');
  if (typeof grant === 'string' && grant.startsWith('p1.')) {
    const expectedHash = config.agentAccessHashes[connectionId];
    if (!/^p1\.[A-Za-z0-9_-]{43}$/.test(grant) || !expectedHash) {
      throw authError('Invalid or revoked portal access link');
    }
    const suppliedHash = crypto.createHash('sha256').update(grant).digest();
    if (!crypto.timingSafeEqual(Buffer.from(expectedHash, 'hex'), suppliedHash)) {
      throw authError('Invalid or revoked portal access link');
    }
    return { type: 'permanent', connectionId };
  }
  const claims = verifyGrant(grant, connectionId, config.signingSecret, options);
  return { type: 'temporary', connectionId, exp: claims.exp };
}

function profilePhoto(value, fallback) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'cdn.spectora.com' && !url.username && !url.password && !url.port &&
        /^\/(?:users|connections)\/images\//.test(url.pathname)) return url.href;
  } catch {}
  return fallback;
}

function boundedInteger(value, fallback, min, max) {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`Configuration value must be an integer from ${min} to ${max}`);
  return number;
}

function authError(message, statusCode = 401) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

class UpstreamHttpError extends Error {
  constructor(upstreamStatus) {
    super(`Spectora API returned ${upstreamStatus}`);
    this.name = 'UpstreamHttpError';
    this.upstreamStatus = upstreamStatus;
  }
}

function signGrantPayload(encodedPayload, secret) {
  return crypto.createHmac('sha256', secret).update(encodedPayload).digest('base64url');
}

function createGrant(connectionId, secret, options = {}) {
  const validatedConnectionId = validatedPositiveDecimalId(connectionId, 'Spectora connection ID');
  if (Buffer.byteLength(secret || '', 'utf8') < 32) throw new Error('A signing secret of at least 32 bytes is required');
  const now = options.now ?? Math.floor(Date.now() / 1000);
  const ttlSeconds = options.ttlSeconds ?? 3600;
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 86400) throw new Error('Grant TTL must be between 1 and 86400 seconds');
  const payload = Buffer.from(JSON.stringify({ v: 1, connectionId: validatedConnectionId, exp: now + ttlSeconds })).toString('base64url');
  return `${payload}.${signGrantPayload(payload, secret)}`;
}

function verifyGrant(grant, requestedConnectionId, secret, options = {}) {
  const fail = () => { throw authError('Invalid or expired portal grant'); };
  validatedPositiveDecimalId(requestedConnectionId, 'Spectora connection ID');
  if (typeof grant !== 'string') fail();
  const [payloadPart, signaturePart, extra] = grant.split('.');
  if (!payloadPart || !signaturePart || extra) fail();
  const expected = Buffer.from(signGrantPayload(payloadPart, secret));
  const supplied = Buffer.from(signaturePart);
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) fail();
  let payload;
  try { payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')); } catch { fail(); }
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (payload.v !== 1 || !/^[1-9][0-9]*$/.test(payload.connectionId) || !Number.isSafeInteger(payload.exp) || payload.exp <= now) fail();
  if (payload.connectionId !== requestedConnectionId) throw authError('Portal grant is not valid for this connection', 403);
  return payload;
}

function readSampleAgent() {
  return JSON.parse(fs.readFileSync(SAMPLE_PATH, 'utf8'));
}

function applyCustomization(sample, branding, demoAgent, demoTier) {
  const company = { ...sample.company, brand: { ...sample.company.brand } };
  for (const [key, value] of Object.entries(branding)) {
    if (key === 'brand') {
      for (const [color, colorValue] of Object.entries(value)) if (colorValue) company.brand[color] = colorValue;
    } else if (value) {
      company[key] = value;
    }
  }
  const agent = { ...sample.agent };
  for (const [key, value] of Object.entries(demoAgent)) if (value) agent[key] = value;
  const tier = { ...sample.tier };
  for (const [key, value] of Object.entries(demoTier)) if (value) tier[key] = value;
  return { ...sample, company, agent, tier };
}

function headers(extra = {}) {
  return { ...SECURITY_HEADERS, ...extra };
}

function sendJson(res, status, payload) {
  res.writeHead(status, headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }));
  res.end(JSON.stringify(payload));
}

function bearerToken(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/);
  return match?.[1];
}

function matchesCompanyId(value, companyId) {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 && String(value) === companyId;
  return typeof value === 'string' && /^[1-9][0-9]*$/.test(value) && value === companyId;
}

function calendarDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) ? value.slice(0, 10) : null;
}

function assertCompanyScope(records, companyId) {
  for (const record of records) {
    const attributeId = record?.attributes?.company_id;
    if (!matchesCompanyId(attributeId, companyId)) {
      throw authError('Upstream company scope mismatch', 403);
    }
    if (record.relationships && Object.hasOwn(record.relationships, 'company')) {
      const relationship = record.relationships.company;
      const resource = relationship?.data;
      if (!resource || Array.isArray(resource) || typeof resource !== 'object' || resource.type !== 'company' || resource.id !== companyId) {
        throw authError('Upstream company relationship mismatch', 403);
      }
    }
  }
}

function assertRecordId(record, expectedId, label) {
  if (!record || String(record.id ?? '') !== expectedId) throw authError(`Upstream ${label} identifier mismatch`, 403);
}

function relationshipId(record, name, expectedType, allowNull = false) {
  const relationship = record?.relationships?.[name];
  if (!relationship || !Object.hasOwn(relationship, 'data')) throw authError(`Upstream ${name} relationship missing`, 403);
  if (relationship.data === null && allowNull) return null;
  if (!relationship.data || Array.isArray(relationship.data) || typeof relationship.data !== 'object') {
    throw authError(`Upstream ${name} relationship ambiguous`, 403);
  }
  const { id, type } = relationship.data;
  if (type !== expectedType) throw authError(`Upstream ${name} relationship type mismatch`, 403);
  if (typeof id !== 'string' || id === '') throw authError(`Upstream ${name} relationship identifier missing`, 403);
  return id;
}

function scopedInspections(records, companyId, connectionId) {
  return records.filter(record => {
    if (Object.hasOwn(record?.attributes || {}, 'company_id') && !matchesCompanyId(record.attributes.company_id, companyId)) {
      throw authError('Upstream inspection company attribute mismatch', 403);
    }
    if (relationshipId(record, 'company', 'company') !== companyId) throw authError('Upstream inspection company scope mismatch', 403);
    const buyingAgentId = relationshipId(record, 'buying_agent', 'connection', true);
    const sellingAgentId = relationshipId(record, 'selling_agent', 'connection', true);
    // Upstream agent filters can return historical matches. Only expose a
    // buyer-side record, or an unrepresented-buyer pre-sale listing for this agent.
    return buyingAgentId === connectionId || (buyingAgentId === null && sellingAgentId === connectionId);
  });
}

function isPreSaleInspection(insp, connectionId) {
  return typeof connectionId === 'string' && insp.relationships?.buying_agent?.data === null && insp.relationships?.selling_agent?.data?.id === connectionId;
}

function reportPdfUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['pdf.spectora.com', 'cdn.spectora.com'].includes(url.hostname) ? url.href : null;
  } catch { return null; }
}

function inspectionReports(insp, included) {
  if (insp.attributes?.canceled_at) return [];
  const date = calendarDate(insp.attributes?.datetime);
  if (!date) return [];
  const links = new Map();
  if (date >= '2023-01-01') {
    const slug = insp.attributes?.slug;
    if (typeof slug !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(slug)) return [];
    return [{ name: 'Client portal', format: 'portal',
      url: `https://portal.spectora.com/inspection/${encodeURIComponent(slug)}` }];
  }
  // Attachments must be explicitly linked to this authorized inspection.
  const references = insp.relationships?.inspection_attachments?.data;
  const ids = new Set(Array.isArray(references) ? references.filter(ref => ref.type === 'inspection_attachment').map(ref => ref.id) : []);
  for (const record of included) {
    if (record?.type !== 'inspection_attachment' || !ids.has(record.id)) continue;
    const attrs = record.attributes || {};
    if (String(attrs.inspection_id) !== String(insp.id) || attrs.internal_only !== false) continue;
    const name = [attrs.name, attrs.file_file_name].filter(Boolean).join(' ').replace(/[_-]/g, ' ');
    const url = reportPdfUrl(attrs.file_url);
    if (!url || !/\.pdf$/i.test(attrs.file_file_name || new URL(url).pathname)) continue;
    // Uploaded reports are sometimes filed as ordinary Documents. Exclude
    // invoices, agreements and other paperwork rather than linking any PDF.
    if (/\b(invoice|receipt|agreement|contract|recallchek)\b/i.test(name)) continue;
    if (attrs.report !== true && !/\b(inspection|report|wett)\b/i.test(name)) continue;
    if (!links.has(url)) links.set(url, { name: attrs.name || 'Inspection report', url });
  }
  return [...links.values()];
}

function mapInspection(insp, connectionId, reports = []) {
  const attrs = insp.attributes || {};
  const isPreSale = isPreSaleInspection(insp, connectionId);
  return {
    classification: isPreSale ? 'Pre-sale inspection' : 'Buyer inspection',
    date: calendarDate(attrs.datetime) || '',
    location: attrs.property_address || [attrs.property_city, attrs.property_state].filter(Boolean).join(', ') || 'Address unavailable',
    services: [attrs.service_names, attrs.service_add_on_names].filter(Boolean).join(' + '),
    inspector: attrs.inspector_name || '',
    status: attrs.canceled_at ? 'Canceled' : (attrs.published_at ? 'Report Published' : 'Scheduled'),
    published: Boolean(attrs.published_at),
    reports: attrs.canceled_at ? [] : reports
  };
}

function readUpstreamJson(response, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let exceeded = false;
    response.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        exceeded = true;
        reject(new Error('Spectora API response exceeded size limit'));
        response.destroy();
      } else {
        chunks.push(chunk);
      }
    });
    response.on('end', () => {
      if (exceeded) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('Spectora API returned malformed JSON')); }
    });
    response.on('error', reject);
  });
}

function createHttpsUpstream(config, transport = https) {
  return endpoint => new Promise((resolve, reject) => {
    const url = new URL(endpoint, SPECTORA_ORIGIN);
    if (url.origin !== SPECTORA_ORIGIN) return reject(new Error('Unapproved upstream origin'));
    const request = transport.get(url, {
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
      timeout: config.upstreamTimeoutMs
    }, response => {
      if (response.statusCode < 200 || response.statusCode > 299) {
        response.resume();
        reject(new UpstreamHttpError(response.statusCode));
        return;
      }
      readUpstreamJson(response, config.upstreamMaxBytes).then(resolve, reject);
    });
    request.on('timeout', () => request.destroy(new Error('Spectora API timeout')));
    request.on('error', reject);
  });
}

function query(pathname, filters) {
  const params = new URLSearchParams(filters);
  return `${pathname}?${params.toString().replace(/%5B/g, '[').replace(/%5D/g, ']')}`;
}

function nextSevenDays(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(now));
  const part = type => parts.find(item => item.type === type).value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const start = new Date(`${today}T12:00:00Z`);
  return Array.from({ length: 7 }, (_, index) => {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}

function normalizeAvailability(response, inspectorId, dates, now) {
  const rows = response?.data;
  const matches = Array.isArray(rows) ? rows.filter(row => String(row?.attributes?.inspector_id) === inspectorId) : [];
  // Spectora can return Rails display names rather than IANA zone identifiers.
  const upstreamTimeZone = response?.meta?.time_zone;
  const timeZone = upstreamTimeZone === 'Mountain Time (US & Canada)' ? 'America/Denver' : upstreamTimeZone;
  const duration = response?.meta?.duration;
  if (matches.length !== 1 || typeof timeZone !== 'string' || !(Number(duration) > 0)) throw new Error('Availability response incomplete');
  new Intl.DateTimeFormat('en-CA', { timeZone });
  const sourceDays = matches[0].attributes.days;
  if (!Array.isArray(sourceDays)) throw new Error('Availability days missing');
  const days = dates.map(date => {
    const matching = sourceDays.filter(day => day?.date === date);
    if (matching.length !== 1 || !Array.isArray(matching[0].slots)) throw new Error('Availability day incomplete');
    const slots = new Set();
    for (const slot of matching[0].slots) {
      const datetime = slot?.datetime;
      if (typeof datetime !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(datetime) || !Number.isFinite(Date.parse(datetime))) throw new Error('Invalid availability slot');
      const slotDate = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(datetime));
      if (slotDate !== date) throw new Error('Availability slot date mismatch');
      if (Date.parse(datetime) > now) slots.add(datetime);
    }
    return { date, slots: [...slots].sort((a, b) => Date.parse(a) - Date.parse(b)) };
  });
  return { available: true, timeZone, duration: Number(duration), days, updatedAt: new Date(now).toISOString() };
}

function createRateLimiter(config, nowMs) {
  const buckets = new Map();
  return key => {
    const now = nowMs();
    if (buckets.size > 10_000) {
      for (const [id, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(id);
      if (buckets.size > 10_000) buckets.delete(buckets.keys().next().value);
    }
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + config.rateLimitWindowMs };
    bucket.count += 1;
    buckets.set(key, bucket);
    return bucket.count <= config.rateLimitMax;
  };
}

function loadStaticSnapshot(publicDir) {
  const rootStat = fs.lstatSync(publicDir);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('Public root must be a real directory');
  const publicReal = fs.realpathSync(publicDir);
  const files = new Map();

  function visit(directory, relativeDirectory = '') {
    for (const name of fs.readdirSync(directory)) {
      const absolute = path.join(directory, name);
      const relative = path.join(relativeDirectory, name);
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) throw new Error(`Public tree contains a symlink or non-regular entry: ${relative}`);
      const real = fs.realpathSync(absolute);
      const containment = path.relative(publicReal, real);
      if (containment.startsWith('..') || path.isAbsolute(containment)) throw new Error(`Public tree entry escapes its root: ${relative}`);
      if (stat.isDirectory()) {
        visit(absolute, relative);
        continue;
      }
      if (!stat.isFile()) throw new Error(`Public tree contains a symlink or non-regular entry: ${relative}`);
      const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const opened = fs.fstatSync(descriptor);
        if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino) {
          throw new Error(`Public tree entry changed during startup: ${relative}`);
        }
        const key = `/${relative.split(path.sep).join('/')}`;
        const ext = path.extname(relative);
        files.set(key, Object.freeze({
          body: fs.readFileSync(descriptor),
          contentType: MIME_TYPES[ext] || 'application/octet-stream',
          cacheControl: ['.html', '.js'].includes(ext) ? 'no-cache' : 'public, max-age=86400'
        }));
      } finally {
        fs.closeSync(descriptor);
      }
    }
  }

  visit(publicDir);
  return files;
}

async function fetchRankingPages(upstreamGet, endpoint, parameters) {
  async function page(number) {
    const payload = await upstreamGet(query(endpoint, { ...parameters, 'page[size]': '200', 'page[number]': String(number) }));
    if (!Array.isArray(payload?.data)) throw new Error('Ranking records unavailable');
    const pagination = payload.meta?.pagination;
    if (pagination?.current != null && Number(pagination.current) !== number) throw new Error('Ranking page mismatch');
    return payload;
  }
  const first = await page(1);
  const pages = [first];
  const last = Number(first.meta?.pagination?.last || 1);
  if (!Number.isSafeInteger(last) || last < 1 || last > 50) throw new Error('Ranking pagination limit');
  if (last > 1) {
    for (let start = 2; start <= last; start += 3) {
      const numbers = Array.from({ length: Math.min(3, last - start + 1) }, (_, index) => start + index);
      pages.push(...await Promise.all(numbers.map(page)));
    }
    for (let index = 0; index < pages.length; index++) {
      const next = pages[index].meta?.pagination?.next;
      if (index < pages.length - 1 && Number(next) !== index + 2) throw new Error('Incomplete ranking pages');
      if (index === pages.length - 1 && next != null) throw new Error('Incomplete ranking pages');
    }
  } else {
    let next = first.meta?.pagination?.next;
    while (next != null) {
      if (Number(next) !== pages.length + 1 || pages.length >= 50) throw new Error('Ranking pagination mismatch');
      const current = await page(Number(next));
      pages.push(current);
      next = current.meta?.pagination?.next;
    }
  }
  const records = pages.flatMap(payload => payload.data);
  const expectedCount = first.meta?.pagination?.records;
  if (expectedCount != null && (!Number.isSafeInteger(Number(expectedCount)) || Number(expectedCount) !== records.length)) {
    throw new Error('Incomplete ranking collection');
  }
  return records;
}

function buildRankingIndex(agentStats, inspections, companyId) {
  assertCompanyScope(agentStats, companyId);
  const agents = new Map();
  function count(attributes, name) {
    const raw = attributes[name];
    const value = Number(raw);
    if (raw == null || raw === '' || !Number.isSafeInteger(value) || value < 0) throw new Error('Ranking counts unavailable');
    return value;
  }
  for (const record of agentStats) {
    const id = validatedPositiveDecimalId(record.id, 'Ranking agent ID');
    if (agents.has(id)) throw new Error('Duplicate ranking agent');
    agents.set(id, {
      overall: count(record.attributes, 'total_inspections_count'),
      buyers: count(record.attributes, 'buying_inspections_count'),
      sellers: count(record.attributes, 'selling_inspections_count'),
      presales: 0
    });
  }
  const seen = new Set();
  for (const record of inspections) {
    if (Object.hasOwn(record?.attributes || {}, 'company_id') && !matchesCompanyId(record.attributes.company_id, companyId)) throw authError('Ranking company mismatch', 403);
    if (relationshipId(record, 'company', 'company') !== companyId) throw authError('Ranking company mismatch', 403);
    const buyer = relationshipId(record, 'buying_agent', 'connection', true);
    const seller = relationshipId(record, 'selling_agent', 'connection', true);
    const id = validatedPositiveDecimalId(record.id, 'Ranking inspection ID');
    if (seen.has(id)) continue;
    seen.add(id);
    const attrs = record.attributes || {};
    if (attrs.canceled_at || attrs.deleted_at || attrs.archived_by_inspector) continue;
    if (buyer === null && seller !== null && agents.has(seller)) agents.get(seller).presales++;
  }
  const results = new Map();
  for (const [id, scores] of agents) {
    const result = { available: true, population: agents.size };
    for (const metric of ['overall', 'buyers', 'sellers', 'presales']) {
      const values = [...agents.values()].map(agent => agent[metric]);
      result[metric] = {
        rank: 1 + values.filter(value => value > scores[metric]).length,
        tied: values.filter(value => value === scores[metric]).length > 1,
        count: scores[metric]
      };
    }
    results.set(id, result);
  }
  return results;
}

function createPortal(options = {}) {
  const config = createConfig(options.env || process.env);
  const staticFiles = loadStaticSnapshot(options.publicDir || PUBLIC_DIR);
  const nowSeconds = options.now || (() => Math.floor(Date.now() / 1000));
  const nowMs = options.nowMs || Date.now;
  const upstreamGet = options.upstreamGet || createHttpsUpstream(config);
  const log = options.log || (entry => process.stdout.write(`${JSON.stringify(entry)}\n`));
  const allowRequest = createRateLimiter(config, nowMs);
  let rankingCache = null;
  let rankingPending = null;
  let rankingRetryAt = 0;
  let availabilityCache = null;
  let availabilityPending = null;
  let availabilityRetryAt = 0;
  let availabilityFailure = { available: false };

  async function getAvailability() {
    const dates = nextSevenDays(nowMs(), config.availabilityTimeZone);
    const startDate = dates[0];
    if (config.mode === 'demo') return { available: false, demo: true };
    if (availabilityCache?.startDate === startDate && availabilityCache.expiresAt > nowMs()) return availabilityCache.payload;
    if (availabilityRetryAt > nowMs()) return availabilityFailure;
    try {
      if (!availabilityPending) {
        availabilityPending = (async () => {
          const params = new URLSearchParams({ start_date: startDate, end_date: dates[6] });
          for (const id of config.availabilityServiceIds) params.append('service_ids[]', id);
          const response = await upstreamGet(`/v2/availabilities?${params}`);
          const payload = normalizeAvailability(response, config.availabilityInspectorId, dates, nowMs());
          availabilityCache = { startDate, payload, expiresAt: nowMs() + 5 * 60 * 1000 };
          return payload;
        })().finally(() => { availabilityPending = null; });
      }
      return await availabilityPending;
    } catch (error) {
      availabilityRetryAt = nowMs() + 30 * 1000;
      const reason = error instanceof UpstreamHttpError
        ? `Spectora API HTTP ${error.upstreamStatus}`
        : (['Availability response incomplete', 'Availability days missing', 'Availability day incomplete', 'Invalid availability slot', 'Availability slot date mismatch', 'Spectora API timeout', 'Spectora API response exceeded size limit', 'Spectora API returned malformed JSON'].includes(error.message) ? error.message : 'Spectora connection unavailable');
      availabilityFailure = { available: false, reason };
      log({ event: 'availability_unavailable', reason });
      return availabilityFailure;
    }
  }

  async function getAgentRankings(connectionId) {
    if (!config.rankingsEnabled) return null;
    try {
      if (!rankingCache || rankingCache.expiresAt <= nowMs()) {
        if (rankingRetryAt > nowMs()) return { available: false };
        if (!rankingPending) {
          rankingPending = (async () => {
            const [allStats, allInspections] = await Promise.all([
              fetchRankingPages(upstreamGet, '/v2/connection_stats', {}),
              fetchRankingPages(upstreamGet, '/v2/inspections', { include: 'buying_agent,selling_agent,company', sort: '-datetime' })
            ]);
            const rankings = buildRankingIndex(allStats, allInspections, config.companyId);
            rankingCache = { rankings, updatedAt: new Date(nowMs()).toISOString(), expiresAt: nowMs() + 15 * 60 * 1000 };
          })().finally(() => { rankingPending = null; });
        }
        await rankingPending;
      }
      const ranking = rankingCache.rankings.get(connectionId);
      return ranking ? { ...ranking, updatedAt: rankingCache.updatedAt } : { available: false };
    } catch {
      rankingRetryAt = nowMs() + 30 * 1000;
      return { available: false };
    }
  }


  async function getAgentPayload(connectionId) {
    const sample = applyCustomization(readSampleAgent(), config.branding, config.demoAgent, config.demoTier);
    if (config.mode === 'demo') return { ...sample, meta: { mode: 'demo' } };
    const scope = config.companyId;
    let connections;
    try {
      connections = await upstreamGet(`/v2/connections/${encodeURIComponent(connectionId)}`);
    } catch (error) {
      if (error instanceof UpstreamHttpError && error.upstreamStatus === 404) return null;
      throw error;
    }
    const connection = connections.data;
    assertRecordId(connection, connectionId, 'connection');
    assertCompanyScope([connection], scope);
    const stats = await upstreamGet(query('/v2/connection_stats', {
      'filter[id]': connectionId, 'page[size]': '1'
    }));
    if (!Array.isArray(stats.data) || stats.data.length !== 1) throw authError('Upstream stats record missing or ambiguous', 403);
    assertRecordId(stats.data[0], connectionId, 'stats');
    assertCompanyScope(stats.data, scope);
    const inspections = await upstreamGet(query('/v2/inspections', {
      'filter[connection_id]': connectionId, include: 'buying_agent,selling_agent,company,inspection_attachments', sort: '-datetime', 'page[size]': '200'
    }));
    if (!Array.isArray(inspections.data)) throw authError('Upstream inspections data missing', 403);
    const authorizedInspections = scopedInspections(inspections.data, scope, connectionId);
    const attrs = connection.attributes || {};
    const statAttrs = stats.data?.[0]?.attributes || {};
    const rankings = await getAgentRankings(connectionId);
    return {
      meta: { mode: 'live' },
      ...(rankings ? { rankings } : {}),
      company: sample.company,
      agent: {
        firstName: attrs.first_name || '',
        lastName: attrs.last_name || '',
        agency: attrs.agency_name || '',
        city: attrs.city || '',
        state: attrs.state || '',
        photoUrl: profilePhoto(attrs.image || attrs.thumb, sample.agent.photoUrl)
      },
      stats: {
        totalInspections: Number(statAttrs.total_inspections_count || attrs.total_inspections_count || 0),
        buyingInspections: Number(statAttrs.buying_inspections_count || 0),
        sellingInspections: Number(statAttrs.selling_inspections_count || 0),
        preSaleInspections: authorizedInspections.filter(inspection => isPreSaleInspection(inspection, connectionId)).length,
        firstInspection: calendarDate(statAttrs.first_inspection_date),
        lastInspection: calendarDate(statAttrs.last_inspection_date),
        overallCount: Number(statAttrs.overall_inspections_count || 0)
      },
      tier: sample.tier,
      inspections: authorizedInspections.map(inspection => mapInspection(inspection, connectionId,
        inspectionReports(inspection, Array.isArray(inspections.included) ? inspections.included : [])))
    };
  }

  function sendStatic(res, pathname) {
    const requested = pathname === '/' || pathname.startsWith('/agent/') ? '/index.html' : pathname;
    let decoded;
    try { decoded = decodeURIComponent(requested); } catch { sendJson(res, 400, { error: 'Malformed URL' }); return; }
    if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) { sendJson(res, 403, { error: 'Forbidden' }); return; }
    const file = staticFiles.get(path.posix.normalize(decoded));
    if (!file) { sendJson(res, 404, { error: 'Not found' }); return; }
    res.writeHead(200, headers({
      'Content-Type': file.contentType,
      ...(path.extname(decoded).toLowerCase() === '.vcf' ? { 'Content-Disposition': 'attachment; filename="Dave-Earle-HSI.vcf"' } : {}),
      'Cache-Control': file.cacheControl
    }));
    res.end(file.body);
  }

  async function handleRequest(req, res) {
    const startedAt = nowMs();
    let pathname = '<malformed>';
    let status = 500;
    try {
      let url;
      try { url = new URL(req.url, 'http://localhost'); } catch { sendJson(res, 400, { error: 'Malformed URL' }); status = 400; return; }
      pathname = url.pathname;
      if (req.method === 'GET' && pathname === '/api/health') {
        sendJson(res, 200, { status: 'ok', service: 'spectora-agent-portal', mode: config.mode }); status = 200; return;
      }
      if (req.method === 'GET' && pathname.startsWith('/api/agent/')) {
        const connectionId = pathname.slice('/api/agent/'.length).split('/')[0];
        if (!connectionId) { sendJson(res, 400, { error: 'Missing connection ID' }); status = 400; return; }
        if (config.mode === 'live') {
          let grant;
          try {
            validatedPositiveDecimalId(connectionId, 'Spectora connection ID');
            grant = bearerToken(req);
            verifyPortalAccess(grant, connectionId, config, { now: nowSeconds() });
          }
          catch (error) { status = error.statusCode || 401; sendJson(res, status, { error: error.message }); return; }
          const key = crypto.createHash('sha256').update(`${grant}:${connectionId}`).digest('hex');
          if (!allowRequest(key)) { sendJson(res, 429, { error: 'Rate limit exceeded' }); status = 429; return; }
        }
        const availabilityRoute = pathname === `/api/agent/${connectionId}/availability`;
        if (availabilityRoute && config.mode === 'live') {
          // Revoked/deleted or cross-company connections cannot read the calendar.
          const connection = await upstreamGet(`/v2/connections/${encodeURIComponent(connectionId)}`);
          assertRecordId(connection.data, connectionId, 'connection');
          assertCompanyScope([connection.data], config.companyId);
        }
        const payload = availabilityRoute ? await getAvailability() : await getAgentPayload(connectionId);
        if (!payload) { sendJson(res, 404, { error: 'Agent not found' }); status = 404; return; }
        sendJson(res, 200, payload); status = 200; return;
      }
      if (req.method === 'GET') { sendStatic(res, pathname); status = res.statusCode || res.status || 200; return; }
      sendJson(res, 405, { error: 'Method not allowed' }); status = 405;
    } catch (error) {
      status = Number(error.statusCode) || 502;
      if (!res.headersSent) sendJson(res, status, { error: status === 502 ? 'Upstream service unavailable' : error.message });
      else res.destroy?.();
    } finally {
      const route = pathname === '/api/health'
        ? '/api/health'
        : (pathname.startsWith('/api/agent/')
            ? '/api/agent/:id'
            : (pathname.startsWith('/agent/') ? '/agent/:id' : '/:static-or-not-found'));
      log({ method: req.method, route, status, durationMs: Math.max(0, nowMs() - startedAt) });
    }
  }

  return { config, handleRequest, getAgentPayload, getAvailability };
}

function createServer(portal) {
  const server = http.createServer((req, res) => {
    Promise.resolve(portal.handleRequest(req, res)).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' });
      else res.destroy();
    });
  });
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  return server;
}

loadEnvFile();
const defaultPortal = createPortal({ log: () => {} });

if (require.main === module) {
  const portal = createPortal();
  const server = createServer(portal);
  server.listen(portal.config.port, () => console.log(`Agent Portal running at http://localhost:${portal.config.port} (${portal.config.mode} mode)`));
}

module.exports = {
  SECURITY_HEADERS,
  SPECTORA_ORIGIN,
  UpstreamHttpError,
  createConfig,
  createGrant,
  verifyGrant,
  verifyPortalAccess,
  createHttpsUpstream,
  readUpstreamJson,
  createPortal,
  buildRankingIndex,
  fetchRankingPages,
  createServer,
  handleRequest: defaultPortal.handleRequest,
  readSampleAgent,
  mapInspection,
  nextSevenDays,
  normalizeAvailability,
  loadEnvFile
};
