// Validate repository-owned service documentation; never read .env or private keys.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const format = process.argv.includes('--format');
const reviewDate = process.argv.find(arg => arg.startsWith('--date='))?.slice(7) ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(reviewDate)) throw new Error('Expected --date=YYYY-MM-DD');
const services = fs.readdirSync(path.join(root, 'service'), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
const walk = dir => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.md') ? [path.join(dir, e.name)] : []) : [];
const files = [path.join(root, 'README.md'), ...walk(path.join(root, 'docs')), ...services.flatMap(s => [path.join(root, 'service', s, 'README.md'), ...walk(path.join(root, 'service', s, 'docs'))])].filter(fs.existsSync);
const errors = []; let links = 0, examples = 0;
const rules = path.join(root, 'docs', 'quy-uoc-tai-lieu.md');
for (const file of files) {
  const name = path.relative(root, file).replaceAll('\\', '/');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(file)).replaceAll('\r\n', '\n'); }
  catch { errors.push(name + ': invalid UTF-8'); continue; }
  if (format) {
    text = text.replace(/^\uFEFF/, '').split('\n').map(l => l.trimEnd()).join('\n');
    const service = name.match(/^service\/([^/]+)\//)?.[1] ?? 'Toàn hệ thống';
    const reference = path.relative(path.dirname(file), rules).replaceAll('\\', '/');
    if (!text.includes('| Rà soát |')) text = text.replace(/^(# .+)\n+/, '$1\n\n| Thuộc tính | Giá trị |\n| --- | --- |\n| Service | ' + service + ' |\n| Rà soát | ' + reviewDate + ' |\n| Quy ước | [Format và số liệu](' + reference + ') |\n\n');
    let fenced = false;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('```')) { if (!fenced && lines[i] === '```') lines[i] = '```text'; fenced = !fenced; }
      if (!fenced && /^\|(?:\s*:?-+:?\s*\|)+\s*$/.test(lines[i])) lines[i] = '| ' + lines[i].slice(1, -1).split('|').map(c => c.trim()).join(' | ') + ' |';
    }
    const spaced = []; fenced = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i], previous = spaced.at(-1) ?? '';
      if (!fenced && previous && (/^#{1,6} /.test(line) || /^```/.test(line) || (/^\|/.test(line) && !/^\|/.test(previous)) || (/^(?:[-*+] |\d+\. )/.test(line) && !/^(?:[-*+] |\d+\. |\s)/.test(previous)))) spaced.push('');
      spaced.push(line);
      if (/^```/.test(line)) { const closing = fenced; fenced = !fenced; if (closing && lines[i + 1]) spaced.push(''); }
      if (!fenced && /^#{1,6} /.test(line) && lines[i + 1]) spaced.push('');
      if (!fenced && /^\|/.test(line) && lines[i + 1] && !/^\|/.test(lines[i + 1])) spaced.push('');
    }
    text = spaced.join('\n').trimEnd() + '\n'; fs.writeFileSync(file, text, 'utf8');
  }
  const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '');
  if (!/^# .+/m.test(prose) || (prose.match(/^# /gm) ?? []).length !== 1) errors.push(name + ': require one H1');
  if (!text.includes('| Service |') || !text.includes('| Rà soát |')) errors.push(name + ': missing document metadata');
  if (!/^\| Rà soát \| \d{4}-\d{2}-\d{2} \|$/m.test(text)) errors.push(name + ': use ISO review date');
  if (text.includes('\uFFFD')) errors.push(name + ': replacement character');
  if ((text.match(/^```/gm) ?? []).length % 2) errors.push(name + ': unclosed code fence');
  for (const match of text.matchAll(/```json[ \t]*\n([\s\S]*?)\n```/g)) {
    try { JSON.parse(match[1]); examples++; } catch { errors.push(name + ': invalid JSON example (use text for pseudocode)'); }
  }
  for (const match of prose.matchAll(/\[[^\]\n]+\]\((<[^>]+>|[^)\n]+)\)/g)) {
    let target = match[1].replace(/^<|>$/g, '').split('#')[0];
    if (!target || /^(?:https?:|mailto:|data:)/.test(target)) continue;
    try { target = decodeURIComponent(target); } catch { errors.push(name + ': invalid link encoding'); continue; }
    if (path.isAbsolute(target) || /^[A-Za-z]:/.test(target)) { errors.push(name + ': machine-specific local link ' + target); continue; }
    if (!fs.existsSync(path.resolve(path.dirname(file), target))) errors.push(name + ': missing link ' + target); else links++;
  }
}
const baselinePath = path.join(root, 'docs', 'contract-baseline.json');
let facts = 0;
if (fs.existsSync(baselinePath)) for (const fact of JSON.parse(fs.readFileSync(baselinePath, 'utf8'))) {
  const source = fs.readFileSync(path.join(root, fact.source), 'utf8');
  if (fact.jsonPath) {
    const actual = fact.jsonPath.reduce((value, key) => value?.[key], JSON.parse(source));
    if (!require('node:util').isDeepStrictEqual(actual, fact.expected)) errors.push('Contract drift: ' + fact.id + ' in ' + fact.source);
  } else if (!new RegExp(fact.pattern, 'm').test(source)) errors.push('Contract drift: ' + fact.id + ' in ' + fact.source);
  const doc = fs.readFileSync(path.join(root, 'docs', 'hop-dong-lien-service.md'), 'utf8');
  if (!doc.includes(fact.doc)) errors.push('Missing documented fact: ' + fact.id);
  facts++;
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log(`${files.length} UTF-8 documents, ${links} local links, ${examples} JSON examples, ${facts} source contract checks pass.`);
