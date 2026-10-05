import { readFileSync } from "node:fs";
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const secret = (name: string) =>
    env[`${name}_FILE`]
      ? readFileSync(env[`${name}_FILE`]!, "utf8").trim()
      : (env[name]?.trim() ?? "");
  const required = (name: string) => {
    const value = secret(name);
    if (!value) throw new Error(`${name} required`);
    return value;
  };
  const integer = (name: string, fallback: number, max = 2147483647) => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isInteger(value) || value < 1 || value > max)
      throw new Error(`Invalid ${name}`);
    return value;
  };
  const url = (name: string) => {
    const value = required(name).replace(/\/$/, "");
    const parsed = new URL(value);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      throw new Error(`Invalid ${name}`);
    return value;
  };
  const production = env.NODE_ENV === "production";
  const otpMode = env.OTP_MODE ?? "mock";
  const tripMode = env.TRIP_MODE ?? "real";
  if (!["mock", "provider"].includes(otpMode))
    throw new Error("Invalid OTP adapter mode");
  if (tripMode !== "real")
    throw new Error("TRIP_MODE must be real; configure a direct Trip service URL");
  if (production && otpMode === "mock")
    throw new Error("Mock forbidden in production");
  if (otpMode === "provider" && env.OTP_PROVIDER_CONTRACT_CONFIRMED !== "true")
    throw new Error("OTP provider contract requires confirmation");
  if (env.DRIVER_STATUS_MODE && env.DRIVER_STATUS_MODE !== "intent")
    throw new Error("Driver requires ONLINE/OFFLINE intent status");
  const vehicleTypes = (env.SUPPORTED_VEHICLE_TYPES ?? "BIKE,CAR_4,CAR_7")
    .split(",")
    .map((value) => value.trim());
  if (
    !vehicleTypes.length ||
    vehicleTypes.some((value) => !/^[A-Za-z0-9_-]{1,20}$/.test(value))
  )
    throw new Error("Invalid vehicle types");
  const issuer = required("AUTH_JWT_ISSUER");
  const audience = (
    env.AUTH_JWT_AUDIENCES ?? "driver-service,trip-service,realtime-service"
  )
    .split(",")
    .map((value) => value.trim());
  if (!audience.includes("driver-service"))
    throw new Error("driver-service audience required");
  if (production && !env.AUTH_SIGNING_KEY_FILE)
    throw new Error("Production signing key required");
  const mockCode = env.OTP_MOCK_CODE ?? "";
  if (otpMode === "mock" && !/^\d{6}$/.test(mockCode))
    throw new Error("Local OTP_MOCK_CODE required");
  const databaseUrl = required("DATABASE_URL");
  if (!["postgres:", "postgresql:"].includes(new URL(databaseUrl).protocol))
    throw new Error("Invalid driver database URL");
  const redisUrl = required("REDIS_URL");
  if (!["redis:", "rediss:"].includes(new URL(redisUrl).protocol))
    throw new Error("Invalid Redis URL");
  const matchingToken = required("MATCHING_INBOUND_TOKEN");
  const realtimeToken = secret("REALTIME_INBOUND_TOKEN");
  if (realtimeToken && (realtimeToken.length < 32 || realtimeToken.startsWith("REPLACE_") || realtimeToken === matchingToken))
    throw new Error("Configure a separate REALTIME_INBOUND_TOKEN of at least 32 characters");
  return {
    production,
    port: integer("PORT", 3003, 65535),
    databaseUrl,
    databaseTimeout: integer("DATABASE_TIMEOUT_MS", 5000, 60000),
    driverLockWait: integer("DRIVER_LOCK_WAIT_MS", 10000, 60000),
    redisUrl,
    issuer,
    audience,
    keyFile: env.AUTH_SIGNING_KEY_FILE,
    keyId: env.AUTH_KEY_ID ?? "driver-local",
    accessTtl: integer("ACCESS_TOKEN_TTL_SECONDS", 900),
    refreshTtl: integer("REFRESH_TOKEN_TTL_SECONDS", 2592000),
    otpMode,
    mockCode,
    otpTtl: integer("OTP_TTL_SECONDS", 300),
    otpCooldown: integer("OTP_RESEND_SECONDS", 60),
    otpAttempts: integer("OTP_MAX_ATTEMPTS", 5, 20),
    otpUrl: otpMode === "provider" ? url("OTP_PROVIDER_URL") : "",
    otpToken: otpMode === "provider" ? required("OTP_PROVIDER_TOKEN") : "",
    tripUrl: url("TRIP_BASE_URL"),
    tripMode,
    httpTimeout: integer("HTTP_TIMEOUT_MS", 5000, 60000),
    gatewayProxyToken: secret("GATEWAY_PROXY_TOKEN"),
    matchingToken,
    realtimeToken,
    vehicleTypes,
    maxVehicles: integer("MAX_VEHICLES", 20, 100),
  };
}
export type Config = ReturnType<typeof loadConfig>;
