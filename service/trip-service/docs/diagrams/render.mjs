import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = process.argv[2] && resolve(process.argv[2]);
const browserConfig = process.argv[3] && resolve(process.argv[3]);
if (!cli || !existsSync(cli) || (browserConfig && !existsSync(browserConfig))) {
  console.error('Usage: node docs/diagrams/render.mjs <mermaid-cli/src/cli.js> [puppeteer.json]');
  process.exit(1);
}
const directory = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(directory, '../c4.md'), 'utf8').replaceAll('\r\n', '\n');
const names = ['01-context', '02-containers', '03-api-components', '04-worker-components',
  '05-domain-code', '06-trip-lifecycle', '07-application-code', '08-outbox-code', '09-booking-flow'];
const blocks = [...source.matchAll(/```mermaid\n([\s\S]*?)\n```/g)];
if (blocks.length !== names.length) throw new Error('Diagram count changed; update the export mapping first');
const tempRoot = resolve(tmpdir());
const temporary = mkdtempSync(join(tempRoot, 'trip-c4-export-'));
if (!resolve(temporary).startsWith(tempRoot + sep)) throw new Error('Unexpected temporary directory');
try {
  for (let i = 0; i < blocks.length; i++) {
    const input = join(temporary, `${names[i]}.mmd`);
    writeFileSync(input, `${blocks[i][1]}\n`, 'utf8');
    const args = [cli, '-i', input, '-o', join(directory, `${names[i]}.svg`),
      '-c', join(directory, 'mermaid.json'), '-b', 'white', '--size', '1800', '--no-font-embed'];
    if (browserConfig) args.push('-p', browserConfig);
    const result = spawnSync(process.execPath, args, { stdio: 'inherit' });
    if (result.error || result.status !== 0) throw result.error ?? new Error(`Cannot render ${names[i]}`);
    console.log(`Rendered ${names[i]}.svg`);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
