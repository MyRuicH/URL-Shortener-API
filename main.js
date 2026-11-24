import { app } from './src/app.js';
import { config } from './src/config.js';
import { checkDatabase, pgp } from './src/db.js';

try {
  await checkDatabase();
  console.log('PostgreSQL connection established.');
  const server = app.listen(config.port, config.host, () => {
    console.log(`Express server listening on ${config.host}:${config.port}`);
    console.log('Swagger UI: /docs; readiness check: /health');
  });

  server.on('error', (error) => {
    console.error(`Server failed to start (${error.code || error.name}).`);
    pgp.end();
    process.exitCode = 1;
  });

  function shutdown() {
    const timeout = setTimeout(() => process.exit(1), 8000);
    timeout.unref();
    server.close(() => {
      pgp.end();
      clearTimeout(timeout);
    });
  }
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
} catch (error) {
  console.error(`Database connection failed (${error.code || error.name}). Check PostgreSQL and .env.`);
  pgp.end();
  process.exitCode = 1;
}
