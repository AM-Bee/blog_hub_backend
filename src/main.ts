import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });

  const port = process.env.PORT ?? 3000;

  await app.listen(port);

  console.log(`Server is running on http://localhost:${port}`);
}

await bootstrap();