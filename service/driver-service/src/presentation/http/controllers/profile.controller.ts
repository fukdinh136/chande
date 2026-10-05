import {
  Body,
  Controller,
  Get,
  Patch,
  Req,
  UseGuards,
  Inject,
} from "@nestjs/common";

import {
  DriverContext,
  CONTEXT,
} from "../../../bootstrap/modules/driver-context";
import { UserGuard } from "../guards/user.guard";
import { envelope } from "../response";
import { DriverRequest } from "../http.types";
import { ProfileDto } from "../dto/profile.dto";

@Controller("drivers/me")
@UseGuards(UserGuard)
export class ProfileController {
  constructor(@Inject(CONTEXT) private readonly context: DriverContext) {}
  @Get() async profile(@Req() req: DriverRequest) {
    return envelope(req, await this.context.profile.profile(req.principal.sub));
  }
  @Patch() async update(@Req() req: DriverRequest, @Body() dto: ProfileDto) {
    return envelope(
      req,
      await this.context.profile.updateProfile(
        req.principal.sub,
        dto,
        req.header("Authorization")!,
      ),
    );
  }
}
