# Repository Guidelines

## Project Structure & Module Organization

- `app/`: shared Expo/React Native Customer and Driver app. Routes live in `src/app/`, feature logic in `src/features/`, assets in `assets/`, and tests in `test/`. Follow `app/AGENTS.md` for mobile-specific rules.
- `service/`: eight independently built backends. Trip, Routing, Price, Matching, Driver, and Realtime use TypeScript/NestJS; API Gateway uses Java/Spring; User uses Java with `user-core`, `user-adapters`, and `user-app` modules.
- `deploy/` and `scripts/`: local Docker/Kubernetes orchestration and repository checks. `docs/` and service-local `docs/` describe contracts and runbooks; `stitch_ride_hailing_customer_app_ui/` holds design references.

## Build, Test, and Development Commands

Use Node.js 24 for Node packages and Java 21 for Java services. There is no root npm workspace; run commands inside the relevant package. On PowerShell, use `npm.cmd` if required.

- `npm ci`: install locked dependencies in `app/` or a Node service.
- In `app/`: `npm start` runs Expo; `npm run web` starts the browser preview. Set `APP_VARIANT=customer` or `driver` to select the app.
- In Node services: `npm run start:dev` starts development; `npm run build` compiles production output.
- `npm run lint`, `npm run typecheck`, and `npm test`: run package checks; use additional test scripts where available.
- In either Java service: `./mvnw verify` builds and tests (`.\mvnw.cmd verify` on Windows).
- From root: `node scripts/validate-docs.cjs` checks documentation; `node --test deploy/*.test.cjs` checks deployment helpers. Follow `docs/deploy-backend.md` for stack startup.

## Coding Style & Naming Conventions

Match surrounding formatting: generally two-space TypeScript and four-space Java indentation. Use PascalCase types/components, camelCase functions, and existing filename patterns such as `home.tsx` or `session-manager.ts`. Run package ESLint; avoid explicit `any`. Keep business rules separate from transport and persistence adapters.

## Testing Guidelines

Node packages use `node:test` with `*.test.ts` or `*.test.cjs`; Java uses JUnit. Add regression coverage for changed behavior. No repository-wide coverage percentage is configured. Integration/live tests require isolated infrastructure; consult package runbooks before enabling them. Report skipped tests and distinguish API checks from native-device validation.

## Commit & Pull Request Guidelines

Follow history's `type(scope): description` style, for example `fix(customer): restore active trip`. Keep commits focused. PRs should describe behavior, link relevant issues, list validation and limitations, and include screenshots for UI changes. Update contracts/docs alongside behavior changes.

## Security & Configuration

Use environment examples; preserve local configuration. Never commit credentials, signing keys, or generated build output. Treat `EXPO_PUBLIC_*` values as public and keep service secrets out of the app.
