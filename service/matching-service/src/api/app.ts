import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { Body, Catch, Controller, Get, HttpCode, Inject, Module, Param, Post, Req, Res, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule, ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Config } from '../bootstrap/config';
import { Repository } from '../infrastructure/persistence';
import { Commands } from '../application/commands';
import { OfferDecisions } from '../application/decisions';
import { publicOffer } from '../application/match';
import { cancelCommand, completedEvent, MatchingError, searchCommand, uuid } from '../domain/models';
import { credential, Identity } from './auth';
type MatchingRequest = Request & { requestId: string };
const CTX = 'MATCHING_CONTEXT';
export interface Context { config: Config; repo: Repository; commands: Commands; decisions: OfferDecisions; identity: { verify(h: string | undefined): Promise<string> }; onModuleDestroy?(): Promise<void> }
export function parse<T>(schema: z.ZodType<T>, value: unknown): T { const r = schema.safeParse(value); if (!r.success) throw new MatchingError('INVALID_REQUEST', 400); return r.data; }
const envelope = (req: MatchingRequest, data: unknown) => ({ data, meta: { requestId: req.requestId } });
@ApiTags('internal') @ApiHeader({ name: 'X-Service-Token', required: true }) @Controller('internal')
class InternalController {
  constructor(@Inject(CTX) private readonly c: Context) {}
  @Post('matching/requests') @HttpCode(202) @ApiOperation({ operationId: 'startMatching' })
  async search(@Req() req: MatchingRequest, @Body() body: unknown) { credential(req.header('X-Service-Token'), this.c.config.tokens.trip); return envelope(req, await this.c.commands.search(parse(searchCommand, body))); }
  @Post('matching/requests/:tripId/cancel') @HttpCode(202)
  async cancel(@Req() req: MatchingRequest, @Param('tripId') id: string, @Body() body: unknown) { credential(req.header('X-Service-Token'), this.c.config.tokens.trip); const input = parse(cancelCommand, body); if (input.tripId !== parse(uuid, id)) throw new MatchingError('INVALID_REQUEST', 400); return envelope(req, await this.c.commands.stop(input.commandId, input.tripId, input, 'CANCELLED')); }
  @Post('events/trips') @HttpCode(202)
  async completed(@Req() req: MatchingRequest, @Body() body: unknown) { credential(req.header('X-Service-Token'), this.c.config.tokens.trip); const input = parse(completedEvent, body); return envelope(req, await this.c.commands.stop(input.eventId, input.tripId, input, 'COMPLETED')); }
  @Post('matching/reservations/batch') @HttpCode(200)
  async reservations(@Req() req: MatchingRequest, @Body() body: unknown) { credential(req.header('X-Service-Token'), this.c.config.tokens.driver); const input = parse(z.object({ driverIds: z.array(uuid).min(1).max(100).refine(ids => new Set(ids).size === ids.length) }).strict(), body); return envelope(req, { items: await this.c.repo.reservations(input.driverIds) }); }
  @Get('matching/offers/:offerId')
  async offer(@Req() req: MatchingRequest, @Param('offerId') id: string) { credential(req.header('X-Service-Token'), this.c.config.tokens.realtime); const o = await this.c.repo.getOffer(parse(uuid, id)); if (!o) throw new MatchingError('NOT_FOUND', 404); return envelope(req, publicOffer(o)); }
  @Get('matching/drivers/:driverId/offer')
  async driver(@Req() req: MatchingRequest, @Param('driverId') id: string) { credential(req.header('X-Service-Token'), this.c.config.tokens.realtime); return envelope(req, publicOffer(await this.c.repo.activeOffer(parse(uuid, id)))); }
}
@ApiTags('offers') @ApiHeader({ name: 'Authorization', required: true }) @Controller('matching/offers')
class OffersController {
  constructor(@Inject(CTX) private readonly c: Context) {}
  @Get('active') async active(@Req() req: MatchingRequest) { return envelope(req, publicOffer(await this.c.repo.activeOffer(await this.c.identity.verify(req.header('Authorization'))))); }
  @Get(':offerId') async get(@Req() req: MatchingRequest, @Param('offerId') id: string) { return envelope(req, await this.c.decisions.get(parse(uuid, id), await this.c.identity.verify(req.header('Authorization')))); }
  @Post(':offerId/accept') @HttpCode(202) @ApiHeader({ name: 'Idempotency-Key', required: true })
  async accept(@Req() req: MatchingRequest, @Param('offerId') id: string, @Body() body: unknown) { return this.decision(req, id, body, 'accept'); }
  @Post(':offerId/decline') @HttpCode(200) @ApiHeader({ name: 'Idempotency-Key', required: true })
  async decline(@Req() req: MatchingRequest, @Param('offerId') id: string, @Body() body: unknown) { return this.decision(req, id, body, 'decline'); }
  private async decision(req: MatchingRequest, id: string, body: unknown, action: 'accept' | 'decline') { const driver = await this.c.identity.verify(req.header('Authorization')); parse(z.object({}).strict(), body); return envelope(req, await this.c.decisions.execute(parse(uuid, id), driver, parse(uuid, req.header('Idempotency-Key')), action)); }
}
@Controller('health') class HealthController {
  constructor(@Inject(CTX) private readonly c: Context) {}
  @Get('live') live() { return { status: 'ok' }; }
  @Get('ready') async ready(@Res() res: Response) { const ready = await this.c.repo.ready(); res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable' }); }
}
@Catch() class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) { const req = host.switchToHttp().getRequest<MatchingRequest>(), res = host.switchToHttp().getResponse<Response>(); const status = error instanceof MatchingError ? error.status : error instanceof HttpException ? error.getStatus() : (error as { status?: number })?.status === 413 ? 413 : 503; const code = error instanceof MatchingError ? error.code : status < 500 ? 'INVALID_REQUEST' : 'DEPENDENCY_UNAVAILABLE'; res.status(status).json({ error: { code, message: code }, meta: { requestId: req.requestId } }); }
}
export async function createApi(c: Context) {
  @Module({ controllers: [InternalController, OffersController, HealthController], providers: [{ provide: CTX, useValue: c }] }) class ApiModule {}
  const app = await NestFactory.create<NestExpressApplication>(ApiModule, { logger: ['error', 'warn'], bodyParser: false }); app.disable('x-powered-by');
  app.use((req: MatchingRequest, res: Response, next: import('express').NextFunction) => { const incoming = req.header('X-Request-Id'); req.requestId = incoming && uuid.safeParse(incoming).success ? incoming.toLowerCase() : randomUUID(); res.setHeader('X-Request-Id', req.requestId); res.setHeader('Cache-Control', 'no-store'); if (incoming && !uuid.safeParse(incoming).success) { res.status(400).json({ error: { code: 'INVALID_REQUEST' }, meta: { requestId: req.requestId } }); return; } next(); });
  app.use(json({ limit: '64kb' })); app.useGlobalFilters(new Errors()); app.enableShutdownHooks();
  if (c.config.swagger) { const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Matching Service').setVersion('1.0').addBearerAuth().build()); SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'openapi.json' }); }
  await app.init(); return app;
}
export function context(config: Config, repo: Repository): Context { return { config, repo, commands: new Commands(repo), decisions: new OfferDecisions(repo), identity: new Identity(config), onModuleDestroy: async () => { if (repo.db.isInitialized) await repo.db.destroy(); } }; }
