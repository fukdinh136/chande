const fs = require('node:fs');
const path = require('node:path');
const roots = [path.resolve('docs'), path.resolve('../price-service/docs')];
const files = [path.resolve('README.md'), path.resolve('../price-service/README.md'), path.resolve('../../docs/README.md')];
for (const root of roots) for (const name of fs.readdirSync(root)) if (name.endsWith('.md')) files.push(path.join(root, name));
let links = 0; let examples = 0;
for (const file of files) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file));
  for (const match of text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1]; if (/^(https?:|#)/.test(target)) continue;
    if (!fs.existsSync(path.resolve(path.dirname(file), target.split('#')[0]))) throw new Error('Missing link in ' + path.relative(process.cwd(), file) + ': ' + target);
    links++;
  }
  for (const match of text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)) { JSON.parse(match[1]); examples++; }
}
console.log(files.length + ' UTF-8 documents, ' + links + ' local links, ' + examples + ' JSON examples checked.');
