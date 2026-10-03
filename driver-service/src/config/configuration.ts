export default () => ({
  app: {
    port: parseInt(process.env.PORT ?? '3001', 10),
    nodeEnv: process.env.NODE_ENV ?? 'development',
  },

  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    username: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
    database: process.env.DB_NAME ?? 'ride_hailing',
  },

  jwt: {
    secret: process.env.JWT_SECRET ?? 'development-secret',
    expiresIn: process.env.JWT_EXPIRES_IN ?? '1d',
  },

  otp: {
    mockCode: process.env.MOCK_OTP ?? '123456',
    expiresInSeconds: parseInt(
      process.env.OTP_EXPIRES_IN_SECONDS ?? '300',
      10,
    ),
  },
});