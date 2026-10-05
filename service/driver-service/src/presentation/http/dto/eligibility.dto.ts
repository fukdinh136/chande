import { IsString, Matches } from "class-validator";
export class EligibilityQuery {
  @IsString() @Matches(/^[A-Za-z0-9_-]{1,20}$/) vehicleType!: string;
}
