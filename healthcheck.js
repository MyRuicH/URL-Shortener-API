import { pathToFileURL } from 'node:url';

// Перевіряє справжнє з'єднання з БД; імпорт лінивий, щоб HTTP-проба не відкривала пул.
export async function checkDatabase() {
  const { db } = await import('./db.js');
  await db.one('SELECT 1 AS connected');
}

// Єдиний обробник готовності сервера та PostgreSQL, включно з режимом відмови.
export async function healthcheck(req, res) {
  res.set('Cache-Control', 'no-store');
  try {
    await checkDatabase();
    res.json({ status: 'ok', database: 'up' });
  } catch {
    res.status(503).json({ status: 'error', database: 'down' });
  }
}

// Окремий запуск цього ж файлу виконує HTTP-пробу контейнера без curl.
export async function probe() {
  try {
    const response = await fetch(`http://127.0.0.1:${process.env.PORT || 8080}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    const body = await response.json();
    if (!response.ok || body.status !== 'ok' || body.database !== 'up') process.exitCode = 1;
  } catch {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await probe();
