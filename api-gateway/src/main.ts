import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  const port = Number(
    configService.get<string>('PORT', '3002'),
  );

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  app.enableShutdownHooks();

  await app.listen(port);

  Logger.log(
    `API Gateway listening on http://localhost:${port}`,
    'Bootstrap',
  );
}

void bootstrap().catch((error: unknown) => {
  Logger.error(
    error instanceof Error ? error.message : 'Startup failed',
    error instanceof Error ? error.stack : undefined,
    'Bootstrap',
  );

  process.exit(1);
});