import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PushWorkerModule } from './push/push-worker.module.js';

async function main() {
  const app = await NestFactory.createApplicationContext(PushWorkerModule);
  app.enableShutdownHooks();
}
main().catch(() => {
  console.error(
    'Push worker startup failed; check database configuration and migrations',
  );
  process.exitCode = 1;
});
