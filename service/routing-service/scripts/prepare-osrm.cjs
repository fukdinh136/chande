const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const settings = JSON.parse(fs.readFileSync(path.join(root, 'osrm/settings.json'), 'utf8'));
const data = path.join(root, 'osrm/data/hanoi-car');
const manifestPath = path.join(data, 'manifest.json');
const input = path.join(data, 'vietnam.osm.pbf');
const hanoi = path.join(data, 'hanoi.osm.pbf');
function docker(args) {
  const result = spawnSync('docker', args, { cwd: root, stdio: 'inherit', timeout: 30 * 60 * 1000 });
  if (result.status !== 0) throw new Error('Docker operation failed: ' + args[0]);
}
async function hash(file, algorithm) {
  const digest = createHash(algorithm);
  for await (const chunk of fs.createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
async function main() {
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.prepared && manifest.image === settings.image && JSON.stringify(manifest.bbox) === JSON.stringify(settings.bbox) && manifest.profile === settings.profile && manifest.algorithm === settings.algorithm && await hash(hanoi, 'sha256') === manifest.hanoiSha256) {
      for (const suffix of ['partition', 'cells', 'cell_metrics', 'mldgr']) if (!fs.existsSync(path.join(data, 'hanoi.osrm.' + suffix))) throw new Error('Prepared graph is incomplete. Restore the dataset before starting OSRM.');
      console.info('Prepared Hanoi CAR dataset already exists; no download/rebuild.'); return;
    }
    throw new Error('Existing dataset differs from settings or is incomplete. Use a separate dataset directory for rebuilding; do not overwrite a running graph.');
  }
  if (fs.existsSync(data) && fs.readdirSync(data).length) throw new Error('Dataset directory contains an unfinished build. Preserve it for diagnosis, then move it aside before retrying.');
  fs.mkdirSync(data, { recursive: true });
  const checksumResponse = await fetch(settings.checksumUrl, { signal: AbortSignal.timeout(30000) });
  if (!checksumResponse.ok) throw new Error('Cannot obtain dataset checksum');
  const checksum = (await checksumResponse.text()).match(/^([a-f0-9]{32})\b/i)?.[1]?.toLowerCase();
  if (!checksum) throw new Error('Invalid dataset checksum');
  const response = await fetch(settings.sourceUrl, { signal: AbortSignal.timeout(15 * 60 * 1000) });
  const max = 512 * 1024 * 1024;
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > max) throw new Error('Invalid or oversized source dataset');
  let size = 0;
  console.info('Downloading Vietnam OSM source, then clipping Hanoi...');
  await pipeline(Readable.fromWeb(response.body), async function* (source) {
    for await (const chunk of source) { size += chunk.length; if (size > max) throw new Error('Source dataset exceeds 512 MiB'); yield chunk; }
  }, fs.createWriteStream(input, { flags: 'wx' }));
  if (await hash(input, 'md5') !== checksum) throw new Error('Dataset checksum mismatch; do not preprocess');
  const sourceSha256 = await hash(input, 'sha256');
  docker(['build', '--target', 'prepare', '-t', 'chande-osrm-prepare:local', 'osrm']);
  const mount = ['run', '--rm', '--memory', '2g', '--cpus', '2', '--mount', `type=bind,source=${data},target=/data`];
  docker(['run', '--rm', '--memory', '4g', '--memory-swap', '4g', '--cpus', '2', '--mount', `type=bind,source=${data},target=/data`, 'chande-osrm-prepare:local', 'osmium', 'extract', '-v', '-b', settings.bbox.join(','), '-s', 'complete_ways', '/data/vietnam.osm.pbf', '-o', '/data/hanoi.osm.pbf']);
  docker([...mount, settings.image, 'osrm-extract', '--threads', '2', '-p', settings.profile, '/data/hanoi.osm.pbf']);
  docker([...mount, settings.image, 'osrm-partition', '--threads', '2', '/data/hanoi.osrm']);
  docker([...mount, settings.image, 'osrm-customize', '--threads', '2', '/data/hanoi.osrm']);
  // OSRM's mmap-created fileIndex initially has mode 0700; publish read access for the runtime UID.
  docker([...mount, settings.image, 'sh', '-c', 'chmod 644 /data/hanoi.osrm.* /data/hanoi.osm.pbf']);
  const manifest = { prepared: true, preparedAt: new Date().toISOString(), ...settings, sourceBytes: size, sourceMd5: checksum, sourceSha256, hanoiSha256: await hash(hanoi, 'sha256'), attribution: '© OpenStreetMap contributors, ODbL 1.0; source Geofabrik' };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  fs.unlinkSync(input); // Only the verified, task-owned temporary country download.
  console.info('Hanoi CAR MLD graph prepared; Vietnam download removed. Manifest: osrm/data/hanoi-car/manifest.json');
}
main().catch(error => { console.error('OSRM preparation failed:', error.message); process.exitCode = 1; });
