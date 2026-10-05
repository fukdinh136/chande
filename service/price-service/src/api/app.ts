import 'reflect-metadata';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { Catch, Controller, Get, Post, HttpCode, Inject, Module, Req, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { ApiBody, ApiOkResponse, ApiSecurity, DocumentBuilder, SwaggerModule, type SchemaObject } from '@nestjs/swagger';
import type { Config } from '../bootstrap/config';
import { FareError, FarePolicy, requestSchema } from '../domain/fare';
import { CalculateFare } from '../application/calculate';
type PriceRequest = Request & { requestId: string };
const schema = (value: z.ZodType): SchemaObject => { const json = z.toJSONSchema(value, { io: 'input' }); delete json.$schema; return json as unknown as SchemaObject; };
const money = z.string().regex(/^(0|[1-9]\d*)$/);
const responseSchema = z.object({ data: z.object({ currency: z.literal('VND'), amount: money, breakdown: z.array(z.object({ code: z.string(), amount: money })) }), meta: z.object({ requestId: z.uuid() }) });
@Catch()
class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest<PriceRequest>(); const res = host.switchToHttp().getResponse<Response>();
    let status = 500; let code = 'INTERNAL_ERROR';
    if (error instanceof FareError) { status = error.status; code = error.code; }
    else if (error instanceof HttpException) { status = error.getStatus(); code = status < 500 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR'; }
    else if (error instanceof SyntaxError) { status = 400; code = 'INVALID_REQUEST'; }
    else if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') { status = 413; code = 'INVALID_REQUEST'; }
    res.status(status).json({ error: { code, message: code, details: [] }, meta: { requestId: req.requestId ?? randomUUID() } });
  }
}
@Controller()
class PriceController {
  constructor(@Inject('CONFIG') private readonly config: Config, @Inject(CalculateFare) private readonly fare: CalculateFare) {}
  @Post('internal/fares/estimate') @HttpCode(200) @ApiSecurity('service-token') @ApiBody({ schema: schema(requestSchema) }) @ApiOkResponse({ schema: schema(responseSchema) })
  calculate(@Req() req: PriceRequest) {
    const token = Buffer.from(req.get('x-service-token') ?? ''); const expected = Buffer.from(this.config.token);
    if (token.length !== expected.length || !timingSafeEqual(token, expected)) throw new FareError('INVALID_SERVICE_CREDENTIAL', 401);
    return { data: this.fare.execute(req.body), meta: { requestId: req.requestId } };
  }
  @Get('health/live') live() { return { status: 'ok' }; }
  @Get('health/ready') ready() { return { status: 'ok' }; }
}
export async function createApi(config: Config) {
  @Module({ controllers: [PriceController], providers: [{ provide: 'CONFIG', useValue: config }, { provide: CalculateFare, useValue: new CalculateFare(new FarePolicy(config.policy), config.vehicles) }] }) class PriceModule {}
  const app = await NestFactory.create(PriceModule, { logger: false, bodyParser: false });
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use((req: PriceRequest, res: Response, next: NextFunction) => {
    const header = req.get('x-request-id'); const id = header ? z.uuid().safeParse(header) : undefined;
    req.requestId = id?.success ? id.data : randomUUID(); res.setHeader('X-Request-Id', req.requestId); res.setHeader('Cache-Control', 'no-store');
    if ((id && !id.success) || (req.method === 'POST' && !req.is('application/json'))) { next(new FareError('INVALID_REQUEST', 400)); return; } next();
  });
  app.use(express.json({ limit: '64kb', strict: true })); app.useGlobalFilters(new ErrorFilter()); app.enableShutdownHooks(['SIGTERM', 'SIGINT']);
  if (config.swagger) SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Price Service').setVersion('1.0').addApiKey({ type: 'apiKey', in: 'header', name: 'X-Service-Token' }, 'service-token').build()), { jsonDocumentUrl: 'openapi.json' });
  await app.init(); return app;
}
