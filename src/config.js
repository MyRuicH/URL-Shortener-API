import 'dotenv/config';
import { Command, InvalidArgumentError } from 'commander';

function portNumber(value) {
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    throw new InvalidArgumentError('Port must be an integer between 1 and 65535.');
  }
  return Number(value);
}

const program = new Command()
  .name('url-shortener-api')
  .description('Start the Express.js URL shortener scaffold')
  .option('--host <host>', 'Server bind address', process.env.HOST || '0.0.0.0')
  .option('-p, --port <port>', 'Server port', portNumber, portNumber(process.env.PORT || '8080'))
  .parse();

for (const name of ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD']) {
  if (!process.env[name]) throw new Error(`Missing required environment variable: ${name}`);
}

export const config = {
  ...program.opts(),
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
