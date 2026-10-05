import type { Location, DriverLocation, RouteRequest, MatrixRequest, Route, Cell, MapJob } from '../../domain/models';
export interface Clock { now(): number; iso(): string }
export interface Context { requestId: string; deadline: number; signal: AbortSignal }
export interface MapProvider { route(input: RouteRequest, context: Context): Promise<Route>; matrix(input: MatrixRequest, context: Context): Promise<Cell[]> }
export interface RealtimeLocationPort { findNearbyDriverLocations(center: Location, context: Context, vehicleType?: string): Promise<DriverLocation[]> }
export interface MapDispatcher { dispatch(job: { kind: 'route'; input: RouteRequest }, context: Context): Promise<Route>; dispatch(job: { kind: 'matrix'; input: MatrixRequest }, context: Context): Promise<Cell[]>; dispatch(job: MapJob, context: Context): Promise<Route | Cell[]> }
export const systemClock: Clock = { now: () => performance.now(), iso: () => new Date().toISOString() };
