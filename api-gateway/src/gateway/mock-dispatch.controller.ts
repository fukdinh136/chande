import {
  Body,
  Controller,
  Headers,
  HttpCode,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { LocationGateway } from './location.gateway';

@Controller('mock-dispatch')
export class MockDispatchController {
  constructor(private readonly locationGateway: LocationGateway) {}

  @Post()
  @HttpCode(200)
  dispatch(
    @Headers('x-mock-dispatch-key') key: string | undefined,
    @Body() body: unknown,
  ) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.ENABLE_MOCK_DISPATCH !== 'true'
    ) {
      throw new NotFoundException();
    }

    const expected = process.env.MOCK_DISPATCH_KEY;

    if (!expected || key !== expected) {
      throw new UnauthorizedException('Invalid mock dispatch key');
    }

    return this.locationGateway.dispatchMockRide(body);
  }
}