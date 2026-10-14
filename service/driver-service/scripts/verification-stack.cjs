// Disposable integration stack using existing service implementations/images.
// No team database, deploy/.local secret, schema migration setting, or container
// is reused. The SQL is the repository's isolated smoke fixture, not production DDL.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { root, images, stack } = require('../../../deploy/stack.cjs');
if (process.env.DRIVER_TEST_STORAGE_ACK !== 'ISOLATED_DRIVER_TEST_ONLY') throw Error('Explicit isolated storage acknowledgement required');
const out = path.resolve(__dirname, '../node_modules/.cache/driver-verification-stack');
if (fs.existsSync(out)) throw Error('Verification directory exists; do not overwrite credentials or reuse data silently');
const graph = path.join(root, 'service/routing-service/osrm/data/hanoi-car');
if (!fs.existsSync(path.join(graph, 'hanoi.osrm.partition'))) throw Error('Prepared OSRM graph missing');
const port = Number(process.env.DRIVER_TEST_INGRESS_PORT ?? 18082);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || [18080, 18081].includes(port)) throw Error('Use a separate test ingress port');
fs.mkdirSync(out, { recursive: true });
const keys = ['rootPassword', 'userPassword', 'driverPassword', 'tripPassword', 'matchingPassword', 'rabbitPassword', 'userInternal', 'cursor', 'matchingTrip', 'driverTrip', 'tripRouting', 'tripPrice', 'tripMatching', 'tripGateway', 'driverMatching', 'realtimeMatching', 'matchingRouting', 'matchingDriver', 'realtimeDriver', 'routingRealtime', 'gatewayRouting'];
const secrets = Object.fromEntries(keys.map(key => [key, crypto.randomBytes(32).toString('hex')]));
const apps = stack(secrets);
for (const role of ['user', 'driver']) {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  fs.writeFileSync(path.join(out, role + '.pem'), pair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
}
const file = name => path.join(out, name).replaceAll('\\', '/');
fs.copyFileSync(path.join(root, 'service/matching-service/test/fixtures/driver-local.sql'), file('driver.sql'));
fs.writeFileSync(file('init.sh'), `#!/bin/bash
set -euo pipefail
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres --set=user_password="$USER_DB_PASSWORD" --set=driver_password="$DRIVER_DB_PASSWORD" --set=trip_password="$TRIP_DB_PASSWORD" --set=matching_password="$MATCHING_DB_PASSWORD" <<'SQL'
CREATE USER user_service WITH PASSWORD :'user_password';
CREATE USER driver_service WITH PASSWORD :'driver_password';
CREATE USER trip_service WITH PASSWORD :'trip_password';
CREATE USER matching_service WITH PASSWORD :'matching_password';
CREATE DATABASE user_db OWNER user_service;
CREATE DATABASE driver_db OWNER driver_service;
CREATE DATABASE trip_db OWNER trip_service;
CREATE DATABASE matching_db OWNER matching_service;
SQL
psql -v ON_ERROR_STOP=1 -U driver_service -d driver_db -f /bootstrap/driver.sql
`);
const health = test => ({ test, interval: '5s', timeout: '3s', retries: 30, start_period: '15s' });
const compose = { name: 'chande-driver-verification', services: {}, volumes: { postgres: {}, redis: {}, rabbit: {} } };
compose.services.postgres = { image: images.postgres, environment: { POSTGRES_USER: 'backend_test_root', POSTGRES_PASSWORD: secrets.rootPassword, USER_DB_PASSWORD: secrets.userPassword, DRIVER_DB_PASSWORD: secrets.driverPassword, TRIP_DB_PASSWORD: secrets.tripPassword, MATCHING_DB_PASSWORD: secrets.matchingPassword }, volumes: ['postgres:/var/lib/postgresql', `${file('init.sh')}:/docker-entrypoint-initdb.d/init.sh:ro`, `${file('driver.sql')}:/bootstrap/driver.sql:ro`], healthcheck: health(['CMD-SHELL', 'pg_isready -U backend_test_root -d postgres']) };
compose.services.redis = { image: images.redis, command: ['redis-server', '--appendonly', 'yes'], volumes: ['redis:/data'], healthcheck: health(['CMD', 'redis-cli', 'ping']) };
compose.services.rabbitmq = { image: images.rabbit, user: 'rabbitmq', hostname: 'rabbitmq', environment: { RABBITMQ_DEFAULT_USER: 'backend', RABBITMQ_DEFAULT_PASS: secrets.rabbitPassword, RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS: '+S 2:2 +A 4' }, volumes: ['rabbit:/var/lib/rabbitmq'], healthcheck: health(['CMD', 'rabbitmq-diagnostics', '-q', 'ping']) };
compose.services.osrm = { image: images.osrm, command: ['osrm-routed', '--algorithm', 'mld', '--threads', '2', '--max-table-size', '100', '/data/hanoi.osrm'], volumes: [`${graph.replaceAll('\\', '/')}:/data:ro`], healthcheck: health(['CMD', 'curl', '--fail', '--silent', '--max-time', '2', 'http://127.0.0.1:5000/route/v1/driving/105.8542,21.0285;105.8355,21.0272?overview=false']) };
for (const [name, app] of Object.entries(apps)) {
  if (name === 'realtime-api') {
    // Android WebSocket adds Origin from its endpoint, not from Metro. Keep
    // exact local origins for this disposable ingress; do not change service
    // defaults, JWT verification or another deployment's allowlist.
    app.env.SOCKET_CORS_ORIGINS = [
      'http://localhost:8081', 'http://127.0.0.1:8081',
      'http://localhost:5500', 'http://127.0.0.1:5500',
      ...['localhost', '127.0.0.1', '10.0.2.2'].map(host => `http://${host}:${port}`),
    ].join(',');
  }
  fs.writeFileSync(file(name + '.env'), Object.entries(app.env).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { mode: 0o600 });
  const dependencies = { postgres: { condition: 'service_healthy' }, redis: { condition: 'service_healthy' } };
  if (app.migration) dependencies[name.replace('-api', '-migrate')] = { condition: 'service_completed_successfully' };
  if (name === 'realtime-api') dependencies.rabbitmq = { condition: 'service_healthy' };
  for (const dependency of app.dependencies ?? []) dependencies[dependency] = { condition: 'service_healthy' };
  const probe = app.java ? ['CMD', 'curl', '--fail', '--silent', `http://127.0.0.1:${app.port}${app.ready}`] : ['CMD', 'node', '-e', `fetch('http://127.0.0.1:${app.port}${app.ready}',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))`];
  const image = app.service === 'driver' ? 'chande-driver-verification:local' : app.image;
  compose.services[name] = { image, init: true, env_file: [file(name + '.env')], depends_on: dependencies, healthcheck: health(probe), stop_grace_period: '30s', ...(app.command ? { command: app.command } : {}), ...(app.keys ? { volumes: [`${file(app.service + '.pem')}:/run/keys/${app.service}.pem:ro`] } : {}) };
  if (app.migration) compose.services[name.replace('-api', '-migrate')] = { image, env_file: [file(name + '.env')], command: ['node', 'dist/migrate.js'], depends_on: { postgres: { condition: 'service_healthy' } } };
}
compose.services.edge = { image: images.nginx, volumes: [`${path.join(root, 'deploy/nginx.conf').replaceAll('\\', '/')}:/etc/nginx/nginx.conf:ro`], ports: [`127.0.0.1:${port}:8088`], depends_on: { 'gateway-api': { condition: 'service_healthy' }, 'realtime-api': { condition: 'service_healthy' } } };
fs.writeFileSync(file('compose.json'), JSON.stringify(compose, null, 2));
console.info(`Isolated verification stack prepared; loopback ingress ${port}. Private generated files are under node_modules/.cache, ignored by Git.`);
