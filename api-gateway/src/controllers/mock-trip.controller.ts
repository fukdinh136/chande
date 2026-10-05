import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { LocationGateway } from '../gateway/location.gateway';

const TRIP_STATUSES = [
  'HEADING_TO_PICKUP',
  'ARRIVED_AT_PICKUP',
  'ON_TRIP',
  'COMPLETED',
] as const;

@Controller('mock-trip')
export class MockTripController {
  constructor(
    private readonly jwtService: JwtService,
    private readonly locationGateway: LocationGateway,
  ) {}

  @Put(':tripId/status')
  @HttpCode(200)
  async updateStatus(
    @Param('tripId', new ParseUUIDPipe()) tripId: string,
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    if (
      process.env.ENABLE_MOCK_TRIP !== 'true' ||
      process.env.NODE_ENV === 'production'
    ) {
      throw new NotFoundException();
    }

    const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')?.[1];

    if (!token) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    let driverId: string;

    try {
      const claims = await this.jwtService.verifyAsync<{
        sub: string;
        exp: number;
      }>(token, { algorithms: ['HS256'] });

      if (
        typeof claims.sub !== 'string' ||
        !claims.sub ||
        typeof claims.exp !== 'number'
      ) {
        throw new Error('Invalid token');
      }

      driverId = claims.sub;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body)
    ) {
      throw new BadRequestException('Expected { status: string }');
    }

    const payload = body as Record<string, unknown>;

    if (
      Object.keys(payload).some((key) => key !== 'status') ||
      typeof payload.status !== 'string' ||
      !TRIP_STATUSES.some((status) => status === payload.status)
    ) {
      throw new BadRequestException('Invalid trip status');
    }

    if (payload.status === 'COMPLETED') {
      this.locationGateway.finishMockRide(driverId, tripId);

      return {
        success: true,
        receipt: {
          fare: 50000,
          distance: 5.2,
          paymentMethod: 'CASH',
        },
      };
    }

    return { success: true };
  }
}