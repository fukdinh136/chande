const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const crypto = require('node:crypto');
const root = path.dirname(require.resolve('../../package.json'));

// Each fixture gets an isolated TS module graph. Only native/storage boundaries
// are replaced; coordinators, HTTP adapters and decoders execute production code.
function loader(mocks = {}) {
  const cache = new Map();
  const defaults = {
    'expo-crypto': { randomUUID: crypto.randomUUID, CryptoDigestAlgorithm: { SHA256: 'sha256' }, digestStringAsync: async (_, value) => crypto.createHash('sha256').update(value).digest('hex') },
    'react-native': { Platform: { OS: 'android' } },
    'expo-secure-store': {},
    'src/features/backend/command-storage.ts': { commandStorage: () => ({ read: async () => null, write: async () => {} }) },
  };
  const replacements = { ...defaults, ...mocks };
  function load(relative) {
    const file = path.resolve(root, relative), key = path.relative(root, file).replaceAll('\\', '/');
    if (Object.hasOwn(replacements, key)) return replacements[key];
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    const local = id => {
      if (Object.hasOwn(replacements, id)) return replacements[id];
      if (!id.startsWith('.')) return require(id);
      const base = path.resolve(path.dirname(file), id);
      const resolved = [base, base + '.ts', base + '.tsx', path.join(base, 'index.ts')].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
      if (!resolved) throw new Error('Cannot resolve ' + id + ' in ' + key);
      return load(resolved);
    };
    new Function('require', 'module', 'exports', '__DEV__', code)(local, module, module.exports, true);
    return module.exports;
  }
  return load;
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
const ids = { driver: '10000000-0000-4000-8000-000000000001', other: '10000000-0000-4000-8000-000000000002', trip: '30000000-0000-4000-8000-000000000001', offer: '40000000-0000-4000-8000-000000000001' };
const tokens = (patch = {}) => ({ accessToken: 'test-access', refreshToken: 'test-refresh', tokenType: 'Bearer', expiresIn: 900, refreshExpiresAt: '2099-01-01T00:00:00.000Z', driver: { driverId: ids.driver }, ...patch });
function owner() {
  let epoch = 1, state = { usable: true, session: tokens() }; const listeners = new Set();
  return {
    getOwnerEpoch: () => epoch, getSnapshot: () => state,
    accessToken: async () => state.session.accessToken,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    update: patch => { state = { ...state, ...patch }; for (const fn of [...listeners]) fn(); },
    change: driverId => { epoch++; state = { usable: !!driverId, session: driverId ? tokens({ driver: { driverId } }) : null }; for (const fn of [...listeners]) fn(); },
  };
}
function memoryStorage() {
  let credential = null; const records = new Map();
  const key = (environment, driver, item = 'current') => JSON.stringify([environment, driver, item]);
  return {
    read: async () => credential,
    write: async value => { credential = value; },
    readOfferState: async (...args) => records.get(key(...args)) ?? null,
    writeOfferState: async (environment, driver, item, value) => { records.set(key(environment, driver, item), value); },
    records,
  };
}
module.exports = { loader, deferred, flush, ids, tokens, owner, memoryStorage };
