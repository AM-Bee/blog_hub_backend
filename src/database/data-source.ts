import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { AddGoogleAccounts1792454400000 } from './migrations/1792454400000-AddGoogleAccounts.js';

// Used only by migration commands. Application startup keeps its current configuration.
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5433),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  synchronize: false,
  migrations: [AddGoogleAccounts1792454400000],
});
