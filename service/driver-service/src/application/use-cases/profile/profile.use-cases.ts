import { Store } from "../../ports/unit-of-work.port";
import { Runtime } from "../../ports/runtime.port";
import { requireDriver } from "../../../domain/driver/driver";
import { DriverError } from "../../../domain/value-objects/error";
import { text } from "../../../domain/value-objects/text";
import { profileDto } from "./profile.dto";
import { EditPolicy } from "../vehicle/edit.policy";
export class ProfileUseCases {
  constructor(
    private readonly store: Store,
    private readonly runtime: Runtime,
    private readonly policy: EditPolicy,
  ) {}
  async profile(id: string) {
    return profileDto(
      requireDriver(await this.store.read((repo) => repo.driver(id))),
    );
  }
  updateProfile(
    id: string,
    input: {
      fullName?: string;
      avatarUrl?: string | null;
      licenseNumber?: string;
    },
    authorization: string,
  ) {
    return this.store.coordinate(id, async () => {
      if (!Object.keys(input).length) throw new DriverError("INVALID_REQUEST");
      if (input.licenseNumber !== undefined)
        await this.policy.requireEditable(id, authorization);
      await this.store.transaction(async (repo) => {
        const driver = requireDriver(await repo.driver(id, true));
        if (input.fullName !== undefined)
          driver.name = text(input.fullName, 100);
        if (input.licenseNumber !== undefined)
          driver.licenseNumber = text(input.licenseNumber, 20).toUpperCase();
        if (input.avatarUrl !== undefined) driver.avatarUrl = input.avatarUrl;
        driver.updatedAt = this.runtime.now();
        await repo.saveDriver(driver);
      });
      return this.profile(id);
    });
  }
}
