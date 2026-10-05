import { clientAddress } from "../guards/client-address";
import { Body, Controller, Post, Req, Inject, HttpCode } from "@nestjs/common";
import {
  DriverContext,
  CONTEXT,
} from "../../../bootstrap/modules/driver-context";
import { envelope } from "../response";
import { DriverRequest } from "../http.types";
import { PhoneDto, VerifyOtpDto, RefreshDto } from "../dto/auth.dto";
@Controller("driver-auth")
export class AuthController {
  constructor(@Inject(CONTEXT) private readonly context: DriverContext) {}
  @Post("otp/request") @HttpCode(200) async request(
    @Req() req: DriverRequest,
    @Body() dto: PhoneDto,
  ) {
    return envelope(
      req,
      await this.context.auth.request(
        dto.phoneNumber,
        clientAddress(req, this.context.config.gatewayProxyToken),
      ),
    );
  }
  @Post("otp/verify") @HttpCode(200) async verify(
    @Req() req: DriverRequest,
    @Body() dto: VerifyOtpDto,
  ) {
    return envelope(
      req,
      await this.context.auth.verify(dto.phoneNumber, dto.challengeId, dto.otp),
    );
  }
  @Post("refresh") @HttpCode(200) async refresh(
    @Req() req: DriverRequest,
    @Body() dto: RefreshDto,
  ) {
    return envelope(req, await this.context.auth.refresh(dto.refreshToken));
  }
  @Post("logout") @HttpCode(200) async logout(
    @Req() req: DriverRequest,
    @Body() dto: RefreshDto,
  ) {
    return envelope(req, await this.context.auth.logout(dto.refreshToken));
  }
}
