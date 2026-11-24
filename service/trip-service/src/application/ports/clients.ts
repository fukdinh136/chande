import type { Location, QuoteFare, RouteSummary } from '../../domain/models';
export interface RoutingPort { estimate(pickup: Location, destination: Location, vehicleType: string, requestId: string): Promise<RouteSummary> }
export interface PricingPort { estimate(route: RouteSummary, vehicleType: string, requestId: string): Promise<QuoteFare> }
import type { Destination } from './store';
/** `eventDestinations`: who receives trip events besides Matching; unset means the Gateway and notification. */
export interface Runtime { now(): Date; id(): string; eventDestinations?: readonly Destination[] }
