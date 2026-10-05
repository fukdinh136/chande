import { Body, Controller, Get, Post, Patch, Param, Query, Req, Res, Inject, UseGuards, Injectable, HttpCode, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiHeader, ApiOperation, ApiParam, ApiQuery, ApiSecurity, ApiTags, ApiResponse } from '@nestjs/swagger';
import { z } from 'zod';
import type { ApiBodyOptions } from '@nestjs/swagger';
import type { Response } from 'express';
import { TripContext } from '../bootstrap/context';
import { verifyServiceCredential } from './auth';
import { envelope, result, type TripRequest } from './http';
import { parse, uuid, estimateBody, createBody, updateBody, cancelBody, assignmentBody, historyQuery } from './schemas';
import { quoteResponse, tripResponse, detailResponse, pageResponse, assignmentResponse, errorResponse, responseEnvelope } from './schemas';
export const CONTEXT = 'TRIP_CONTEXT';
function body(schema: z.ZodType) { return ApiBody({ schema: z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input' }) as Extract<ApiBodyOptions, { schema: unknown }>['schema'] }); }
function response(status: number, schema: z.ZodType) { return ApiResponse({ status, schema: z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input' }) as Extract<ApiBodyOptions, { schema: unknown }>['schema'] }); }
const keyHeader = () => ApiHeader({ name: 'Idempotency-Key', required: true, schema: { type: 'string', format: 'uuid' } });
const tripParam = () => ApiParam({ name: 'id', type: String, format: 'uuid' });
@Injectable()
export class UserGuard implements CanActivate {
  constructor(@Inject(CONTEXT) private readonly context: TripContext) {}
  async canActivate(execution: ExecutionContext): Promise<boolean> { const request = execution.switchToHttp().getRequest<TripRequest>(); request.principal = await this.context.identity.verify(request.header('Authorization')); return true; }
}
@Injectable()
export class MatchingGuard implements CanActivate {
  constructor(@Inject(CONTEXT) private readonly context: TripContext) {}
  canActivate(execution: ExecutionContext): boolean { verifyServiceCredential(execution.switchToHttp().getRequest<TripRequest>().header('X-Service-Token'), this.context.config.callbackToken); return true; }
}
@ApiTags('trips') @ApiBearerAuth() @UseGuards(UserGuard) @Controller('trips')
@ApiHeader({ name: 'X-Request-Id', required: false, schema: { type: 'string', format: 'uuid' } })
@response(400, errorResponse) @response(401, errorResponse) @response(403, errorResponse) @response(404, errorResponse) @response(409, errorResponse) @response(503, errorResponse)
export class TripsController {
  constructor(@Inject(CONTEXT) private readonly context: TripContext) {}
  @Post('estimate') @HttpCode(200) @body(estimateBody) @response(200, responseEnvelope(quoteResponse)) @ApiOperation({ operationId: 'estimateTrip' })
  async estimate(@Req() req: TripRequest, @Body() input: unknown) { return envelope(req, await this.context.estimate.execute(req.principal, parse(estimateBody, input), req.requestId)); }
  @Post() @body(createBody) @keyHeader() @response(201, responseEnvelope(tripResponse)) @ApiOperation({ operationId: 'createTrip' })
  async create(@Req() req: TripRequest, @Res({ passthrough: true }) res: Response, @Body() input: unknown) { return result(req, res, await this.context.create.execute(req.principal, parse(createBody, input).quoteId, parse(uuid, req.header('Idempotency-Key')))); }
  @Get('active') @response(200, responseEnvelope(tripResponse.nullable())) @ApiOperation({ operationId: 'getActiveTrip' })
  async active(@Req() req: TripRequest) { return envelope(req, await this.context.get.active(req.principal)); }
  @Get('history') @response(200, responseEnvelope(pageResponse)) @ApiOperation({ operationId: 'getTripHistory' })
  @ApiQuery({ name: 'limit', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } }) @ApiQuery({ name: 'status', required: false, enum: ['COMPLETED', 'CANCELLED'] }) @ApiQuery({ name: 'cursor', required: false, type: String })
  async history(@Req() req: TripRequest, @Query() query: unknown) { const input = parse(historyQuery, query); return envelope(req, await this.context.get.list(req.principal, input.limit, input.status, input.cursor)); }
  @Get(':id') @tripParam() @response(200, responseEnvelope(detailResponse)) @ApiOperation({ operationId: 'getTrip' })
  async detail(@Req() req: TripRequest, @Param('id') id: string) { return envelope(req, await this.context.get.detail(req.principal, parse(uuid, id))); }
  @Patch(':id/status') @tripParam() @body(updateBody) @keyHeader() @response(200, responseEnvelope(tripResponse)) @ApiOperation({ operationId: 'updateTrip' })
  async update(@Req() req: TripRequest, @Res({ passthrough: true }) res: Response, @Param('id') id: string, @Body() bodyValue: unknown) { const input = parse(updateBody, bodyValue); return result(req, res, await this.context.update.execute(req.principal, parse(uuid, id), input.status, input.version, parse(uuid, req.header('Idempotency-Key')))); }
  @Post(':id/cancel') @HttpCode(200) @tripParam() @body(cancelBody) @keyHeader() @response(200, responseEnvelope(tripResponse)) @ApiOperation({ operationId: 'cancelTrip' })
  async cancel(@Req() req: TripRequest, @Res({ passthrough: true }) res: Response, @Param('id') id: string, @Body() bodyValue: unknown) { const input = parse(cancelBody, bodyValue); return result(req, res, await this.context.cancel.execute(req.principal, parse(uuid, id), input.reason, input.version, parse(uuid, req.header('Idempotency-Key')))); }
}
@ApiTags('internal') @ApiSecurity('matching') @UseGuards(MatchingGuard) @Controller('internal/trips')
@response(400, errorResponse) @response(401, errorResponse) @response(404, errorResponse) @response(409, errorResponse) @response(503, errorResponse)
export class AssignmentController {
  constructor(@Inject(CONTEXT) private readonly context: TripContext) {}
  @Post(':id/assignment') @HttpCode(202) @tripParam() @body(assignmentBody) @response(202, responseEnvelope(assignmentResponse)) @ApiOperation({ operationId: 'assignTrip' })
  async assign(@Req() req: TripRequest, @Res({ passthrough: true }) res: Response, @Param('id') id: string, @Body() input: unknown) { return result(req, res, await this.context.assignment.execute(parse(uuid, id), parse(assignmentBody, input))); }
  @Get(':id/matching-state')
  async state(@Req() req: TripRequest, @Param('id') id: string) {
    const trip = await this.context.store.transaction(tx => tx.findTrip(parse(uuid, id)));
    return envelope(req, trip ? { tripId: trip.tripId, status: trip.status, driverId: trip.driverId, version: trip.version } : null);
  }
}
@ApiTags('internal') @Controller('internal/trips')
export class DriverLookupController {
  constructor(@Inject(CONTEXT) private readonly context: TripContext) {}
  @Post('active-drivers/batch') @HttpCode(200)
  async activeDrivers(@Req() req: TripRequest, @Body() input: unknown) {
    verifyServiceCredential(req.header('X-Service-Token'), this.context.config.driverLookupToken ?? '');
    const { driverIds } = parse(z.object({ driverIds: z.array(uuid).min(1).max(100).refine(ids => new Set(ids).size === ids.length) }).strict(), input);
    const items = await this.context.store.transaction(async tx => {
      const result = []; for (const driverId of driverIds) { const trip = await tx.active({ sub: driverId, role: 'DRIVER' }); result.push({ driverId, tripId: trip?.tripId ?? null }); } return result;
    });
    return envelope(req, { items });
  }
}
@ApiTags('health') @Controller('health')
export class HealthController {
  constructor(@Inject(CONTEXT) private readonly context: TripContext) {}
  @Get('live') live() { return { status: 'ok' }; }
  @Get('ready') async ready(@Res() res: Response) { const ready = await this.context.store.ready(); res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'unavailable' }); }
}
