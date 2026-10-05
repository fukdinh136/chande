import 'reflect-metadata';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import express, { type Request, type Response, type NextFunction } from 'express';
import { NestFactory } from '@nestjs/core';
import { Catch, Controller, Get, Post, HttpCode, Inject, Module, Req, Res, HttpException, type ArgumentsHost, type ExceptionFilter, type INestApplication } from '@nestjs/common';
import { ApiBody, ApiSecurity, ApiTags, DocumentBuilder, SwaggerModule, type SchemaObject } from '@nestjs/swagger';
import { RoutingRuntime } from '../bootstrap/runtime';
import { RoutingError } from '../domain/errors';
import { estimateSchema, routeRequestSchema, matrixRequestSchema } from '../domain/requests';
import type { Context } from '../application/ports/clients';
interface RoutingRequest extends Request { routing: { requestId: string; started: number } }
function bodySchema(schema: z.ZodType): SchemaObject { const json = z.toJSONSchema(schema, { io: 'input' }); delete json.$schema; return json as unknown as SchemaObject; }
function authorize(req: Request, runtime: RoutingRuntime, operation: 'trip' | 'gateway' | 'matching'): void {
  const token = req.get('x-service-token'); let caller: string | undefined;
  if (token) for (const [name, expected] of Object.entries(runtime.config.tokens)) {
    const a = Buffer.from(token); const b = Buffer.from(expected);
    if (a.length === b.length && timingSafeEqual(a, b)) caller = name;
  }
  if (!caller) throw new RoutingError('INVALID_SERVICE_CREDENTIAL', 401);
  if (caller !== operation) throw new RoutingError('FORBIDDEN_OPERATION', 403);
  if (!runtime.pool.stats.accepting) throw new RoutingError('ROUTING_BUSY', 503);
}
@Catch()
class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const req = host.switchToHttp().getRequest<RoutingRequest>(); const res = host.switchToHttp().getResponse<Response>();
    let failure = error instanceof RoutingError ? error : new RoutingError('INTERNAL_ERROR', 500);
    if (error instanceof HttpException) failure = new RoutingError('INVALID_REQUEST', error.getStatus());
    if (error instanceof SyntaxError) failure = new RoutingError('INVALID_REQUEST', 400);
    if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') failure = new RoutingError('INVALID_REQUEST', 413);
    if (res.destroyed || res.headersSent) return;
    if (failure.code === 'ROUTING_BUSY') res.setHeader('Retry-After', '1');
    res.status(failure.status).json({ error: { code: failure.code, message: failure.code, details: [] }, meta: { requestId: req.routing?.requestId ?? randomUUID() } });
  }
}
@ApiTags('Routing')
@Controller()
class RoutingController {
  constructor(@Inject(RoutingRuntime) private readonly runtime: RoutingRuntime) {}
  private async execute(req: RoutingRequest, res: Response, caller: 'trip' | 'gateway' | 'matching', action: (context: Context) => Promise<unknown>) {
    authorize(req, this.runtime, caller);
    const controller = new AbortController(); const abort = () => controller.abort();
    const untrack = this.runtime.track(controller);
    const disconnect = () => { if (!res.writableEnded) abort(); };
    const deadline = req.routing.started + this.runtime.config.limits.deadline;
    const timer = setTimeout(abort, Math.max(1, deadline - this.runtime.clock.now()));
    req.on('aborted', abort); res.on('close', disconnect);
    try {
      const data = await action({ requestId: req.routing.requestId, deadline, signal: controller.signal });
      return { data, meta: { requestId: req.routing.requestId } };
    } finally { clearTimeout(timer); req.off('aborted', abort); res.off('close', disconnect); untrack(); }
  }
  @Post('internal/routes/estimate') @HttpCode(200) @ApiSecurity('service-token') @ApiBody({ schema: bodySchema(estimateSchema) })
  estimate(@Req() req: RoutingRequest, @Res({ passthrough: true }) res: Response) {
    return this.execute(req, res, 'trip', ctx => this.runtime.route.estimate(req.body, ctx));
  }
  @Post('routes') @HttpCode(200) @ApiSecurity('service-token') @ApiBody({ schema: bodySchema(routeRequestSchema) })
  route(@Req() req: RoutingRequest, @Res({ passthrough: true }) res: Response) {
    return this.execute(req, res, 'gateway', ctx => this.runtime.route.full(req.body, ctx));
  }
  @Post('routes/matrix') @HttpCode(200) @ApiSecurity('service-token') @ApiBody({ schema: bodySchema(matrixRequestSchema) })
  matrix(@Req() req: RoutingRequest, @Res({ passthrough: true }) res: Response) {
    return this.execute(req, res, 'matching', ctx => this.runtime.matrix.execute(req.body, ctx));
  }
  @Get('health/live') live() { return { status: 'ok' }; }
  @Get('health/ready') ready() {
    if (!this.runtime.pool.stats.accepting) throw new RoutingError('ROUTING_BUSY', 503);
    return { status: 'ok' };
  }
}
export async function createApp(runtime: RoutingRuntime): Promise<INestApplication> {
  @Module({ controllers: [RoutingController], providers: [{ provide: RoutingRuntime, useValue: runtime }] }) class RoutingModule {}
  const app = await NestFactory.create(RoutingModule, { logger: false, bodyParser: false });
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use((req: RoutingRequest, res: Response, next: NextFunction) => {
    const header = req.get('x-request-id'); const parsed = header ? z.uuid().safeParse(header) : undefined;
    req.routing = { requestId: parsed?.success ? parsed.data : randomUUID(), started: runtime.clock.now() };
    res.setHeader('X-Request-Id', req.routing.requestId);
    if (parsed && !parsed.success) { next(new RoutingError('INVALID_REQUEST', 400)); return; }
    if (req.method === 'POST' && !req.is('application/json')) { next(new RoutingError('INVALID_REQUEST', 400)); return; }
    next();
  });
  app.use(express.json({ limit: '64kb', strict: true }));
  app.useGlobalFilters(new ErrorFilter()); app.enableShutdownHooks(['SIGINT', 'SIGTERM']);
  if (runtime.config.swagger && !runtime.config.production) {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Routing Service').setVersion('1.0').addApiKey({ type: 'apiKey', in: 'header', name: 'X-Service-Token' }, 'service-token').build());
    SwaggerModule.setup('docs', app, document);
  }
  await app.init(); return app;
}
