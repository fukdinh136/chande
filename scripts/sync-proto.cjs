#!/usr/bin/env node
// Copies proto/*.proto (the source of truth) into the proto/ folder of every Node service that serves or calls
// an internal gRPC API. Each service is built by Docker from its own folder, so it needs its own copy.
// --check: change nothing, exit 1 when a copy is missing, differs or is left over.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'proto');
const services = ['trip', 'matching', 'driver', 'realtime', 'routing', 'price'].map(name => path.join(root, 'service', `${name}-service`, 'proto'));
const check = process.argv.includes('--check');
const files = fs.readdirSync(source).filter(f => f.endsWith('.proto')).sort();
const problems = [];
for (const dir of services) {
  if (!check) fs.mkdirSync(dir, { recursive: true });
  const existing = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.proto')) : [];
  for (const file of files) {
    const want = fs.readFileSync(path.join(source, file));
    const target = path.join(dir, file);
    const same = fs.existsSync(target) && fs.readFileSync(target).equals(want);
    if (same) continue;
    if (check) problems.push(`${path.relative(root, target)} ${fs.existsSync(target) ? 'differs from' : 'is missing; copy of'} proto/${file}`);
    else fs.writeFileSync(target, want);
  }
  for (const file of existing.filter(f => !files.includes(f))) {
    if (check) problems.push(`${path.relative(root, path.join(dir, file))} has no source in proto/`);
    else fs.rmSync(path.join(dir, file));
  }
}
if (problems.length) { console.error(problems.join('\n') + '\nRun: node scripts/sync-proto.cjs'); process.exit(1); }
console.log(check ? `proto copies match (${files.length} files, ${services.length} services)` : `copied ${files.length} proto files into ${services.length} services`);
