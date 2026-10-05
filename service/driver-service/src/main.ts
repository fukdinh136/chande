import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { randomUUID } from "node:crypto";
import { Request, Response, NextFunction } from "express";
import { AppModule } from "./bootstrap/modules/driver.module";
import { ErrorFilter } from "./presentation/http/filters/error.filter";
import { DriverContext, CONTEXT } from "./bootstrap/modules/driver-context";
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
  await app.listen(app.get<DriverContext>(CONTEXT).config.port);
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
