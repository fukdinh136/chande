import "./bootstrap/telemetry";
import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { Request, Response, NextFunction } from "express";
import { AppModule } from "./bootstrap/modules/driver.module";
import { ErrorFilter } from "./presentation/http/filters/error.filter";
import { DriverContext, CONTEXT } from "./bootstrap/modules/driver-context";
import { driverGrpc } from "./presentation/grpc/internal.grpc";
import { grpcPort } from "./infrastructure/grpc";
export async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
  });
  app.use(
    (
      req: Request & { requestId?: string },
      res: Response,
      next: NextFunction,
    ) => {
      const id = req.header("X-Request-Id");
      req.requestId = id && /^[0-9a-f-]{36}$/i.test(id) ? id : randomUUID();
      res.setHeader("X-Request-Id", req.requestId);
      res.setHeader("Cache-Control", "no-store");
      next();
    },
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  const context = app.get<DriverContext>(CONTEXT);
  await app.listen(context.config.port);
  // The same internal API over gRPC (GRPC_PORT, default 50053); Matching picks it with INTERNAL_TRANSPORT=grpc.
  const grpcServer = driverGrpc(context);
  await grpcServer.listen("0.0.0.0", grpcPort("driver"));
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => {
      void grpcServer.close();
    });
  console.log(`Driver service is running at ${await app.getUrl()}`);
  return app;
}
if (require.main === module)
  void bootstrap().catch(() => {
    process.stderr.write(
      "Driver startup failed: check configuration and schema compatibility.\n",
    );
    process.exitCode = 1;
  });
