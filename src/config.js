import 'dotenv/config';
import { Command, InvalidArgumentError } from 'commander';

// Перевіряє діапазон порту для CLI та змінних середовища.
function portNumber(value) {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new InvalidArgumentError('Port must be an integer between 1 and 65535.');
  }
  return Number(value);
}

const program = new Command()
  .name('url-shortener-api')
  .description('Start the Express.js URL shortener')
  .option('--host <host>', 'Server bind address', process.env.HOST || '0.0.0.0')
  .option('-p, --port <port>', 'Server port', portNumber, portNumber(process.env.PORT || '8080'))
  .parse();

for (const name of ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD']) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}

// Базову адресу задає власник сервісу; заголовки клієнта на неї не впливають.
const publicBase = new URL(process.env.PUBLIC_BASE_URL || 'http://localhost:8080');
if (!['http:', 'https:'].includes(publicBase.protocol) || publicBase.username || publicBase.password
    || publicBase.search || publicBase.hash) throw new Error('Invalid PUBLIC_BASE_URL');

// Єдине місце читання параметрів підключення, включно з обмеженнями часу.
export const config = {
  ...program.opts(),
  publicBaseUrl: publicBase.href.replace(/\/$/, ''),
  database: {
    host: process.env.POSTGRES_HOST,
    port: portNumber(process.env.POSTGRES_PORT),
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    connectionTimeoutMillis: 2000,
    query_timeout: 2000,
    max: 5,
  },
};
