import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ApplicationErrorFilter } from './api/application-error.filter.js';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const origins = (
    process.env.CORS_ORIGINS ??
    'http://localhost:4200,http://127.0.0.1:4200,http://localhost:4000,http://127.0.0.1:4000'
  )
    .split(',')
    .map((origin) => origin.trim());

  app.enableCors({ origin: origins });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new ApplicationErrorFilter());
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
