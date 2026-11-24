import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile } from 'node:fs/promises';

const exec = promisify(execFile);
const origin = 'http://localhost:8080';
const run = `v${Date.now().toString(36)}`;
const results = [];
const owned = new Set();

// Керує лише Compose цього проєкту, не передаючи пароль у командний рядок.
async function compose(...args) {
  return (await exec('docker', ['compose', ...args], { maxBuffer: 1024 * 1024 })).stdout.trim();
}

// Виконує службовий SQL усередині контейнера з його власними змінними середовища.
async function sql(statement) {
  return compose('exec', '-T', 'db', 'sh', '-c', 'exec psql -X -v ON_ERROR_STOP=1 -At -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"', 'sh', statement);
}

// Перевіряє реальний HTTP-статус, заголовки та тіло; редиректи не проходить.
async function request(label, method, path, expected, body, headers = {}) {
  const response = await fetch(origin + path, {
    method, redirect: 'manual', signal: AbortSignal.timeout(10000),
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  assert.equal(response.status, expected, `${label}: ${text}`);
  assert.equal(response.headers.get('cache-control'), 'no-store', label);
  const value = text ? JSON.parse(text) : null;
  if (method === 'HEAD' || expected === 204 || expected === 302) assert.equal(text, '', label);
  if (expected >= 400 && method !== 'HEAD') {
    assert.deepEqual(Object.keys(value), ['error']);
    assert.deepEqual(Object.keys(value.error).sort(), ['code', 'message']);
    const codes = { 400: 'BAD_REQUEST', 404: 'NOT_FOUND', 405: 'METHOD_NOT_ALLOWED', 409: 'ALIAS_CONFLICT', 413: 'PAYLOAD_TOO_LARGE', 415: 'UNSUPPORTED_MEDIA_TYPE', 500: 'INTERNAL_ERROR', 503: 'SERVICE_UNAVAILABLE' };
    if (path !== '/health') assert.equal(value.error.code, codes[expected], label);
  }
  results.push({ label, method, path, status: expected });
  console.log(`PASS ${method} ${path} -> ${expected} (${label})`);
  return { value, headers: response.headers };
}

// Перевіряє повний склад полів Link і відсутність втрати точності BIGINT.
function checkLink(value) {
  assert.deepEqual(Object.keys(value).sort(), ['clicks', 'code', 'createdAt', 'originalUrl', 'shortUrl']);
  assert.match(value.clicks, /^(0|[1-9][0-9]*)$/);
  assert.equal(new Date(value.createdAt).toISOString(), value.createdAt);
  assert.equal(value.shortUrl, `${origin}/r/${value.code}`);
}

// Обгортка створення запам'ятовує лише власні тестові коди для очищення.
async function create(originalUrl, alias) {
  const response = await request('create', 'POST', '/api/links', 201, { originalUrl, ...(alias ? { alias } : {}) });
  owned.add(response.value.code);
  checkLink(response.value);
  assert.equal(response.headers.get('location'), `/api/links/${response.value.code}`);
  return response.value;
}

// Перевіряє CRUD, валідацію, нормалізацію, пагінацію, HEAD та конкурентні звернення.
async function regular() {
  await request('health', 'GET', '/health', 200);
  const first = await create(`https://example.org/${run}`, `${run}alias`);
  const generated = await create(`https://example.org/${run}/generated`);
  assert.match(generated.code, /^[A-Za-z0-9]{8}$/);
  const reused = await request('reuse', 'POST', '/api/links', 200, { originalUrl: first.originalUrl });
  assert.deepEqual(reused.value, first);
  assert.equal(reused.headers.get('location'), `/api/links/${first.code}`);
  await request('alias conflict', 'POST', '/api/links', 409, { originalUrl: first.originalUrl, alias: first.code });
  const meta = `/api/links/${first.code}`;
  const redirect = `/r/${first.code}`;
  assert.deepEqual((await request('metadata', 'GET', meta, 200)).value, first);
  await request('HEAD does not count', 'HEAD', redirect, 302);
  assert.equal((await request('HEAD counter', 'GET', meta, 200)).value.clicks, '0');
  const redirected = await request('redirect headers', 'GET', redirect, 302);
  assert.equal(redirected.headers.get('location'), first.originalUrl);
  const updated = (await request('PATCH preserves fields', 'PATCH', meta, 200, { originalUrl: `https://example.org/${run}/updated` })).value;
  assert.equal(updated.clicks, '1');
  assert.equal(updated.createdAt, first.createdAt);
  assert.equal(updated.code, first.code);
  // Проміси стартують разом, щоб перевірити атомарність SQL UPDATE.
  const concurrent = [];
  for (let i = 0; i < 20; i += 1) concurrent.push(request('concurrent click', 'GET', redirect, 302));
  await Promise.all(concurrent);
  assert.equal((await request('no lost clicks', 'GET', meta, 200)).value.clicks, '21');
  const same = [];
  for (let i = 0; i < 10; i += 1) same.push(fetch(origin + '/api/links', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ originalUrl: `https://example.org/${run}/race` }) }));
  const replies = await Promise.all(same);
  const raceCodes = new Set();
  let createdCount = 0;
  for (const reply of replies) {
    assert.ok([200, 201].includes(reply.status));
    if (reply.status === 201) createdCount += 1;
    const item = await reply.json();
    raceCodes.add(item.code); owned.add(item.code);
  }
  assert.equal(createdCount, 1); assert.equal(raceCodes.size, 1);
  const page = (await request('pagination', 'GET', '/api/links?limit=1&offset=0', 200)).value;
  assert.equal(page.items.length, 1); assert.equal(typeof page.total, 'string'); checkLink(page.items[0]);
  assert.deepEqual((await request('empty page', 'GET', '/api/links?offset=2147483647', 200)).value.items, []);
  for (const query of ['limit=01', 'limit=0', 'limit=101', 'offset=-1', 'offset=2147483648', 'limit=1&limit=2', 'other=1', 'limit=1e1', 'offset=0.0']) await request('bad query', 'GET', `/api/links?${query}`, 400);
  for (const value of [null, [], {}, { originalUrl: null }, { originalUrl: first.originalUrl, clicks: '9' }, { originalUrl: first.originalUrl, alias: null }, { originalUrl: first.originalUrl, alias: 'bad!' }]) await request('bad object', 'POST', '/api/links', 400, JSON.stringify(value));
  for (const originalUrl of ['ftp://example.org', 'HTTP://example.org', 'https://user:pass@example.org', 'https://example.org/a b', 'https://example.org/\\a', 'https://', 'https://example.org/' + 'a'.repeat(2048)]) await request('bad URL', 'POST', '/api/links', 400, { originalUrl });
  for (const method of ['POST', 'PATCH']) {
    const path = method === 'POST' ? '/api/links' : meta;
    for (const body of ['', '{']) await request('bad JSON', method, path, 400, body);
    await request('oversize', method, path, 413, { originalUrl: 'https://example.org/' + 'a'.repeat(17000) });
    for (const type of ['text/plain', 'application/json; charset=iso-8859-1']) await request('bad media type', method, path, 415, {}, { 'Content-Type': type });
    await request('encoding precedes JSON', method, path, 415, '{', { 'Content-Encoding': 'gzip' });
  }
  for (const [method, path, body] of [['GET', meta], ['PATCH', meta, { originalUrl: first.originalUrl }], ['DELETE', meta], ['GET', redirect], ['HEAD', redirect]]) {
    await request('unknown query', method, path + '?other=1', 400, body);
    await request('invalid code', method, path.replace(first.code, 'bad!'), 400, body);
    await request('missing code', method, path.replace(first.code, `${run}missing`), 404, body);
  }
  for (const [path, allow] of [['/api/links', 'GET, POST'], [meta, 'GET, PATCH, DELETE'], [redirect, 'GET, HEAD']]) {
    const response = await request('Allow', 'PUT', path, 405);
    assert.equal(response.headers.get('allow'), allow);
  }
  await request('no automatic HEAD metadata', 'HEAD', meta, 405);
  await request('unknown path', 'GET', '/missing-lab6', 404);
  await request('malformed path', 'GET', '/r/%ZZ', 400);
  await request('delete', 'DELETE', meta, 204);
  owned.delete(first.code);
  await request('delete twice', 'DELETE', meta, 404);
}

// Тимчасово перейменовує таблицю для справжніх SQL-помилок 500; завжди відновлює її.
async function faults() {
  const paths = [['POST', '/api/links', { originalUrl: `https://example.org/${run}/fault` }], ['GET', '/api/links'], ['GET', '/api/links/lab6ui'], ['PATCH', '/api/links/lab6ui', { originalUrl: 'https://example.org/' }], ['DELETE', '/api/links/lab6ui'], ['GET', '/r/lab6ui'], ['HEAD', '/r/lab6ui']];
  await sql('ALTER TABLE links RENAME TO lab6_links_backup');
  try {
    for (const [method, path, body] of paths) await request('SQL failure', method, path, 500, body);
  } finally {
    await sql('ALTER TABLE lab6_links_backup RENAME TO links');
  }
  await compose('stop', 'db');
  try {
    for (const [method, path, body] of paths) await request('database stopped', method, path, 503, body);
    const response = await fetch(origin + '/health');
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { status: 'error', database: 'down' });
    results.push({ label: 'database stopped', method: 'GET', path: '/health', status: 503 });
  } finally {
    await compose('up', '-d', '--wait');
  }
  await request('recovered', 'GET', '/health', 200);
}

// Порівнює всі рядки до та після down/up, включно з BIGINT і created_at.
async function persistence() {
  const snapshot = "SELECT COALESCE(json_agg(t ORDER BY t.id), '[]') FROM (SELECT * FROM links) AS t";
  const before = await sql(snapshot);
  await compose('down');
  try {
    await compose('up', '-d', '--wait');
  } catch (error) {
    console.error('Run docker compose up -d --wait to recover containers.');
    throw error;
  }
  assert.equal(await sql(snapshot), before, 'All persisted rows must survive down/up');
  await request('after down/up', 'GET', '/health', 200);
  results.push({ label: 'all rows and counters survive docker compose down/up', status: 'PASS' });
}

// Основний сценарій видаляє лише ресурси, створені саме цим запуском перевірки.
try {
  await regular();
  await faults();
  await persistence();
} finally {
  for (const code of owned) await fetch(`${origin}/api/links/${code}`, { method: 'DELETE' });
}
await writeFile(new URL('../docs/verification-results.json', import.meta.url), JSON.stringify({ results, passed: results.length }, null, 2) + '\n');
console.log(`PASS: ${results.length} checks; concurrent creation and clicks; all rows preserved after down/up.`);
