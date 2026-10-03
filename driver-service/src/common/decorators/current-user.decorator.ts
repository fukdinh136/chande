import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedDriver {
  id: string;
  phone: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedDriver => {
    const request = ctx.switchToHttp().getRequest();

    return request.user;
  },
);