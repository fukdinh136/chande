import { IsUUID, IsIn } from "class-validator";
export class SelectDto {
  @IsUUID() vehicleId!: string;
}
export class AvailabilityDto {
  @IsIn(["ONLINE", "OFFLINE"]) desiredStatus!: "ONLINE" | "OFFLINE";
}
