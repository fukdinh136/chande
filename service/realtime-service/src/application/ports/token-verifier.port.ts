export const TOKEN_VERIFIER = Symbol('TOKEN_VERIFIER');
export interface DriverIdentity { driverId: string; expiresAt: number }
export interface TokenVerifier { verify(token: string): Promise<DriverIdentity> }
