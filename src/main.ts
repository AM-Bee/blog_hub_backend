import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import helmet from 'helmet';
import * as dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { frontendOrigins } from './auth/auth.config.js';
// import { join } from 'path';
// import * as express from 'express';

dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');

  app.enableCors({ origin: frontendOrigins(), credentials: true });
  app.use(cookieParser());
  app.use(
    helmet({
      crossOriginResourcePolicy: false, // disable default CSP blocking for images
    }),
  );

  // Serve images with proper headers
  // app.use('/images', (req, res, next) => {
  //   res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); // <— this fixes your error
  //   next();
  // }, express.static(join(process.cwd(), 'public/images')));

  const PORT = process.env.PORT ?? 5300;
  const HOST = process.env.HOST ?? 'localhost';

  const swaggerConfig = new DocumentBuilder()
    .setTitle('BlogHub API')
    .setDescription('BlogHub backend API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, swaggerConfig),
  );

 

  await app.listen(PORT, HOST);
  console.log(`NestJS App is running on http://${HOST}:${PORT}`);

  // console.log(`Swagger UI is available at http://${HOST}:${PORT}/api`);
}
bootstrap();
