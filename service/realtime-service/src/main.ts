import 'reflect-metadata';
import 'dotenv/config';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { json, NextFunction, Request, Response } from 'express';
import { RealtimeModule } from './bootstrap/modules/realtime.module';
import { Config, CONFIG } from './bootstrap/config/configuration';
import { RealtimeSocketAdapter } from './bootstrap/socket.adapter';
import { ErrorFilter } from './presentation/http/filters/error.filter';
export async function bootstrap() {
  const app = await NestFactory.create(RealtimeModule, { logger: false, bodyParser: false });
  const config = app.get<Config>(CONFIG);
  app.use((request: Request & { requestId?: string }, response: Response, next: NextFunction) => {
    const id = request.header('X-Request-Id');
    request.requestId = id && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : randomUUID();
    response.setHeader('X-Request-Id', request.requestId);
    response.setHeader('Cache-Control', 'no-store'); next();
  });
  app.use(json({ limit: '8kb' }));
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: false } }));
  app.useGlobalFilters(new ErrorFilter());
  app.useWebSocketAdapter(new RealtimeSocketAdapter(app, config.origins));
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  console.info(`Realtime listening on port ${config.port}`);
  return app;
}
if (require.main === module) void bootstrap().catch(() => {
  process.stderr.write('Realtime startup failed; check configuration and installed dependencies.\n');
  process.exitCode = 1;
});
