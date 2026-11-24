import pgPromise from 'pg-promise';
import { config } from './src/config.js';

// Єдиний пул pg-promise для всіх операцій сховища.
export const pgp = pgPromise();
export const db = pgp(config.database);

// Перетворює поля PostgreSQL на внутрішнє представлення, не втрачаючи BIGINT.
function link(row) {
  if (!row) return null;
  return {
    code: row.code,
    originalUrl: row.original_url,
    createdAt: row.created_at.toISOString(),
    clicks: row.clicks,
  };
}

// Серіалізує створення однакового URL; UNIQUE остаточно захищає код від колізій.
export async function createLink(originalUrl, alias, generateCode) {
  return db.tx(async function createTransaction(transaction) {
    await transaction.none('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [originalUrl]);
    if (alias === undefined) {
      const existing = await transaction.oneOrNone(
        'SELECT * FROM links WHERE original_url = $1 ORDER BY created_at, id LIMIT 1', [originalUrl],
      );
      if (existing) return { item: link(existing), created: false };
    }
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = alias ?? await generateCode();
      const row = await transaction.oneOrNone(
        'INSERT INTO links (code, original_url) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING RETURNING *',
        [code, originalUrl],
      );
      if (row) return { item: link(row), created: true };
      if (alias !== undefined) return { conflict: true };
    }
    throw new Error('Generated code attempts exhausted');
  });
}

// Одним SQL-запитом отримує сторінку і загальну кількість з одного MVCC-знімка.
export async function listLinks(limit, offset) {
  const result = await db.one(`
    SELECT (SELECT count(*)::text FROM links) AS total,
           COALESCE(json_agg(page ORDER BY page.created_at DESC, page.id DESC)
                    FILTER (WHERE page.id IS NOT NULL), '[]') AS items
    FROM (SELECT id::text, code, original_url, created_at, clicks::text
          FROM links ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2) AS page`, [limit, offset]);
  // JSON з SQL містить дати як рядки; відновлюємо UTC-формат, як для інших відповідей.
  const items = [];
  for (const row of result.items) items.push(link({ ...row, created_at: new Date(row.created_at) }));
  return { items, limit, offset, total: result.total };
}

// Читає метадані без зміни лічильника переходів.
export async function getLink(code) {
  return link(await db.oneOrNone('SELECT * FROM links WHERE code = $1', [code]));
}

// Змінює лише адресу призначення; інші поля зберігаються.
export async function updateLink(code, originalUrl) {
  return link(await db.oneOrNone('UPDATE links SET original_url = $2 WHERE code = $1 RETURNING *', [code, originalUrl]));
}

// Повертає факт видалення, щоб відрізняти 204 від 404.
export async function deleteLink(code) {
  return Boolean(await db.oneOrNone('DELETE FROM links WHERE code = $1 RETURNING code', [code]));
}

// Атомарно рахує GET і читає актуальну адресу навіть за одночасних звернень.
export async function countRedirect(code) {
  return link(await db.oneOrNone('UPDATE links SET clicks = clicks + 1 WHERE code = $1 RETURNING *', [code]));
}
