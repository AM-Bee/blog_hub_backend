import 'reflect-metadata';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { AddGoogleAccounts1792454400000 } from './migrations/1792454400000-AddGoogleAccounts.js';
import { AddBlogAuditLogs1792490000000 } from './migrations/1792490000000-AddBlogAuditLogs.js';
import { AddNotifications1792570000000 } from './migrations/1792570000000-AddNotifications.js';
import { AddPrivateChat1792584000000 } from './migrations/1792584000000-AddPrivateChat.js';
import { AddMessageDeletion1793145600000 } from './migrations/1793145600000-AddMessageDeletion.js';

// Used only by migration commands. Application startup keeps its current configuration.
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5433),
  username: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  synchronize: false,
  migrations: [
    AddGoogleAccounts1792454400000,
    AddBlogAuditLogs1792490000000,
    AddNotifications1792570000000,
    AddPrivateChat1792584000000,
    AddMessageDeletion1793145600000,
  ],
});
