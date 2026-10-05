import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { z } from 'zod';
import type { TripContext } from '../bootstrap/context';
import { AssignmentController, CONTEXT, HealthController, MatchingGuard, TripsController, UserGuard } from './controllers';
import { ErrorFilter, type TripRequest } from './http';
export async function createApi(context: TripContext) {
  @Module({ controllers: [TripsController, AssignmentController, HealthController], providers: [{ provide: CONTEXT, useValue: context }, UserGuard, MatchingGuard] })
  class ApiModule {}
  const app = await NestFactory.create<NestExpressApplication>(ApiModule, { logger: ['error', 'warn'], bodyParser: false });
  app.disable('x-powered-by');
  app.use((req: TripRequest, res: import('express').Response, next: import('express').NextFunction) => {
    const started = Date.now();
    const incoming = req.header('X-Request-Id'); req.requestId = incoming && z.uuid().safeParse(incoming).success ? incoming.toLowerCase() : randomUUID();
    res.setHeader('X-Request-Id', req.requestId); res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.once('finish', () => { const tripId = req.params.id; console.info(JSON.stringify({ event: 'http_request', requestId: req.requestId, method: req.method, route: (req.route as { path?: string } | undefined)?.path ?? 'unmatched', ...(z.uuid().safeParse(tripId).success ? { tripId } : {}), status: res.statusCode, durationMs: Date.now() - started })); });
    if (incoming && !z.uuid().safeParse(incoming).success) { res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'INVALID_REQUEST', details: [] }, meta: { requestId: req.requestId } }); return; }
    next();
  });
  app.use(json({ limit: '64kb', strict: true })); app.useGlobalFilters(new ErrorFilter());
  if (context.config.swagger) {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Trip Service').setVersion('1.0').addBearerAuth().addApiKey({ type: 'apiKey', in: 'header', name: 'X-Service-Token' }, 'matching').build());
    SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'openapi.json' });
  }
  await app.init(); return app;
}
