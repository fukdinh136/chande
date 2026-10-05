import { randomUUID } from 'node:crypto';
import type { Config } from './config';
import type { Store } from '../application/ports/store';
import { EstimateTrip } from '../application/use-cases/estimate';
import { CreateTrip } from '../application/use-cases/create';
import { ReceiveAssignment } from '../application/use-cases/assignment';
import { GetTrip, HistoryCursor } from '../application/use-cases/get';
import { UpdateTrip } from '../application/use-cases/update';
import { CancelTrip } from '../application/use-cases/cancel';
import { JsonHttpClient } from '../infrastructure/clients/http';
import { RoutingClient } from '../infrastructure/clients/routing';
import { PricingClient } from '../infrastructure/clients/pricing';
import { JwtVerifier, type IdentityVerifier } from '../api/auth';
import type { Runtime } from '../application/ports/clients';
export class TripContext {
  readonly estimate: EstimateTrip; readonly create: CreateTrip; readonly assignment: ReceiveAssignment;
  readonly get: GetTrip; readonly update: UpdateTrip; readonly cancel: CancelTrip;
  readonly identity: IdentityVerifier;
  constructor(readonly config: Config, readonly store: Store, runtime: Runtime = { now: () => new Date(), id: randomUUID }, identity?: IdentityVerifier) {
    this.estimate = new EstimateTrip(store, new RoutingClient(new JsonHttpClient(config.routingUrl, config.routingToken, config.httpTimeout)), new PricingClient(new JsonHttpClient(config.pricingUrl, config.pricingToken, config.httpTimeout)), runtime, config.vehicleTypes);
    this.create = new CreateTrip(store, runtime); this.assignment = new ReceiveAssignment(store, runtime);
    this.get = new GetTrip(store, new HistoryCursor(config.cursorKey)); this.update = new UpdateTrip(store, runtime); this.cancel = new CancelTrip(store, runtime);
    this.identity = identity ?? new JwtVerifier(config);
  }
}
