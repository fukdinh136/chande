export interface TripActive {
  active(
    authorization: string,
  ): Promise<{ tripId: string; vehicleId: string | null } | null>;
}
