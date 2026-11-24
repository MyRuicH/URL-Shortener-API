import http from 'node:http';
import { once } from 'node:events';
import { randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import express from 'express';
import { load } from 'js-yaml';
import swaggerUi from 'swagger-ui-express';
import { config } from './src/config.js';
import * as storage from './db.js';
import { checkDatabase, healthcheck } from './healthcheck.js';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const codePattern = /^[A-Za-z0-9_-]{4,32}$/;
const specification = load(await readFile(new URL('./openapi.yaml', import.meta.url), 'utf8'));
export const app = express();
app.disable('x-powered-by');
app.enable('case sensitive routing');
app.enable('strict routing');

// Створює помилку з безпечним повідомленням для клієнта.
function apiError(status, code, message) {
  return Object.assign(new Error(message), { status, apiCode: code });
}

// Генерує вісім рівномірно випадкових символів Base62 без modulo-зміщення.
async function generateCode() {
  let code = '';
  for (let index = 0; index < 8; index += 1) code += alphabet[randomInt(62)];
  return code;
}

// Використовує довірену конфігурацію замість заголовка Host користувача.
function represent(item) {
  return { ...item, shortUrl: `${config.publicBaseUrl}/r/${item.code}` };
}

// Перевіряє сирий URL до нормалізації та забороняє облікові дані.
function destination(value) {
  try {
    if (typeof value !== 'string' || value.length > 2048 || !/^https?:\/\/[^\u0000-\u0020\u007f\\]+$/.test(value)) throw new Error();
    const url = new URL(value);
    if (!url.hostname || url.username || url.password || url.href.length > 2048) throw new Error();
    return url.href;
  } catch {
    throw apiError(400, 'BAD_REQUEST', 'originalUrl must be an absolute HTTP or HTTPS URL without credentials.');
  }
}

// Послідовність перевірок: тип/кодування, розмір, JSON, поля; читання без callback.
async function readInput(req, allowAlias) {
  const mediaType = req.headers['content-type'] || '';
  const encoding = req.headers['content-encoding'];
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(mediaType)
      || (encoding && encoding.toLowerCase() !== 'identity')) {
    req.resume();
    throw apiError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json with UTF-8 and no content encoding.');
  }
  let size = 0;
  const chunks = [];
  // Зберігаємо сокет відкритим для структурованої відповіді 413.
  if (Number(req.headers['content-length']) > 16384) {
    req.resume();
    throw apiError(413, 'PAYLOAD_TOO_LARGE', 'Request body must not exceed 16384 bytes.');
  }
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 16384) {
      req.resume();
      throw apiError(413, 'PAYLOAD_TOO_LARGE', 'Request body must not exceed 16384 bytes.');
    }
    chunks.push(chunk);
  }
  let body;
  try {
    const json = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    body = JSON.parse(json.replace(/^\uFEFF/, ''));
  } catch {
    throw apiError(400, 'BAD_REQUEST', 'Request body must contain valid UTF-8 JSON.');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw apiError(400, 'BAD_REQUEST', 'A JSON object is required.');
  for (const key of Object.keys(body)) {
    if (key !== 'originalUrl' && !(allowAlias && key === 'alias')) throw apiError(400, 'BAD_REQUEST', 'Unknown or read-only input field.');
  }
  const originalUrl = destination(body.originalUrl);
  if (Object.hasOwn(body, 'alias') && (typeof body.alias !== 'string' || !codePattern.test(body.alias))) {
    throw apiError(400, 'BAD_REQUEST', 'Invalid alias format.');
  }
  return { originalUrl, alias: body.alias };
}

// Перевіряє декодований code і параметри; повтори та невідомі ключі заборонені.
function parameters(req, paginated = false) {
  if (req.params.code !== undefined && !codePattern.test(req.params.code)) throw apiError(400, 'BAD_REQUEST', 'Invalid code format.');
  const query = new URL(req.originalUrl, 'http://localhost').searchParams;
  for (const key of query.keys()) {
    if (!paginated || !['limit', 'offset'].includes(key) || query.getAll(key).length !== 1) throw apiError(400, 'BAD_REQUEST', 'Unknown or repeated query parameter.');
  }
  const result = { limit: 20, offset: 0 };
  for (const key of ['limit', 'offset']) {
    if (!query.has(key)) continue;
    const value = query.get(key);
    const number = Number(value);
    if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(number)
        || number < (key === 'limit' ? 1 : 0) || number > (key === 'limit' ? 100 : 2147483647)) {
      throw apiError(400, 'BAD_REQUEST', 'Invalid pagination value.');
    }
    result[key] = number;
  }
  return result;
}

// Забороняє кешування бізнес-відповідей, включно з помилками.
async function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

// Перехоплює автоматичні HEAD/OPTIONS Express на бізнес-шляхах і додає Allow.
async function allowedMethods(req, res, next) {
  const allowed = req.path === '/api/links' ? ['GET', 'POST']
    : /^\/api\/links\/[^/]+$/.test(req.path) ? ['GET', 'PATCH', 'DELETE']
      : /^\/r\/[^/]+$/.test(req.path) ? ['GET', 'HEAD'] : null;
  if (allowed && !allowed.includes(req.method)) {
    res.set('Allow', allowed.join(', '));
    throw apiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
  }
  next();
}

// Створює нове посилання або повторно використовує ресурс відомого URL.
async function create(req, res) {
  const input = await readInput(req, true);
  parameters(req);
  const result = await storage.createLink(input.originalUrl, input.alias, generateCode);
  if (result.conflict) throw apiError(409, 'ALIAS_CONFLICT', 'The requested alias is already in use.');
  res.location(`/api/links/${result.item.code}`).status(result.created ? 201 : 200).json(represent(result.item));
}

// Читає узгоджену сторінку й загальну кількість без зміни clicks.
async function list(req, res) {
  const { limit, offset } = parameters(req, true);
  const page = await storage.listLinks(limit, offset);
  const items = [];
  for (const item of page.items) items.push(represent(item));
  res.json({ ...page, items });
}

// Повертає метадані одного посилання без підрахунку переходу.
async function get(req, res) {
  parameters(req);
  const item = await storage.getLink(req.params.code);
  if (!item) throw apiError(404, 'NOT_FOUND', 'Link not found.');
  res.json(represent(item));
}

// Змінює тільки адресу призначення після валідації тіла й параметрів.
async function update(req, res) {
  const input = await readInput(req, false);
  parameters(req);
  const item = await storage.updateLink(req.params.code, input.originalUrl);
  if (!item) throw apiError(404, 'NOT_FOUND', 'Link not found.');
  res.json(represent(item));
}

// Видаляє ресурс і повертає порожню відповідь 204 або 404.
async function remove(req, res) {
  parameters(req);
  if (!await storage.deleteLink(req.params.code)) throw apiError(404, 'NOT_FOUND', 'Link not found.');
  res.status(204).end();
}

// GET атомарно збільшує clicks; HEAD лише читає адресу. Обидва повертають порожній 302.
async function redirect(req, res) {
  parameters(req);
  const item = req.method === 'HEAD' ? await storage.getLink(req.params.code) : await storage.countRedirect(req.params.code);
  if (!item) throw apiError(404, 'NOT_FOUND', 'Link not found.');
  res.status(302).location(item.originalUrl).end();
}

// Невідомі шляхи також використовують схему Error.
async function notFound() {
  throw apiError(404, 'NOT_FOUND', 'Resource not found.');
}

// Відділяє недоступність БД від неочікуваної помилки, приховуючи SQL і секрети.
async function handleError(error, req, res, next) {
  if (res.headersSent) return next(error);
  let status = error.apiCode ? error.status : 500;
  let code = error.apiCode || 'INTERNAL_ERROR';
  let message = error.apiCode ? error.message : 'An unexpected server error occurred.';
  if (error instanceof URIError) {
    status = 400; code = 'BAD_REQUEST'; message = 'Malformed path encoding.';
  } else if (!error.apiCode && (/^(08|53|57P0)/.test(error.code || '')
      || ['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EPIPE'].includes(error.code)
      || /timeout|timed out|connection.*(?:closed|terminated)/i.test(error.message))) {
    status = 503; code = 'SERVICE_UNAVAILABLE'; message = 'The database is temporarily unavailable.';
  }
  res.set('Cache-Control', 'no-store').status(status).json({ error: { code, message } });
}

// Swagger UI читає єдиний YAML; порядок middleware зберігає правила контракту.
app.use('/docs', swaggerUi.serve, swaggerUi.setup(specification));
app.get('/health', healthcheck);
app.use(noStore, allowedMethods);
app.post('/api/links', create);
app.get('/api/links', list);
app.get('/api/links/:code', get);
app.patch('/api/links/:code', update);
app.delete('/api/links/:code', remove);
app.head('/r/:code', redirect);
app.get('/r/:code', redirect);
app.use(notFound);
app.use(handleError);

// Єдиний callback передає запит Express; запуск і завершення очікуємо промісами.
export const server = http.createServer((req, res) => app(req, res));
let stopping = false;

// Закриває HTTP та пул без callback-вкладеності з обмеженням очікування.
async function shutdown() {
  if (stopping) return;
  stopping = true;
  try {
    const closed = once(server, 'close', { signal: AbortSignal.timeout(8000) });
    server.close();
    await closed;
  } catch {
    server.closeAllConnections();
    process.exitCode = 1;
  } finally {
    await storage.pgp.end();
  }
}

// Обробляє помилку HTTP-сервера без друку конфігурації.
async function serverError(error) {
  console.error(`Server error (${error.code || error.name}).`);
  process.exitCode = 1;
  await shutdown();
}

// Починає слухати порт лише після перевірки PostgreSQL.
export async function start() {
  try {
    await checkDatabase();
    const listening = once(server, 'listening');
    server.listen(config.port, config.host);
    await listening;
    server.on('error', serverError);
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    console.log(`Express listening on ${config.host}:${config.port}; Swagger UI: /docs/`);
  } catch (error) {
    console.error(`Startup failed (${error.code || error.name}). Check PostgreSQL and configuration.`);
    await storage.pgp.end();
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await start();
