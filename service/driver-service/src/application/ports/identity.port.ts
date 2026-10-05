import { Driver } from "../../domain/driver/driver";
import { Principal } from "../../domain/value-objects/identity";
export interface Tokens {
  issue(driver: Driver): string;
  verify(header: string | undefined): Promise<Principal>;
}
