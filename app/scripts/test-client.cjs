const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const root=path.resolve(__dirname,'..'),cache=new Map();
// Execute the same pure TS client files in Node; no React Native/Expo native module mock is involved.
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file).exports;const mod={exports:{}};cache.set(file,mod);const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;const local=id=>id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(file),id+'.ts'))):require(id);new Function('require','module','exports',code)(local,mod,mod.exports);return mod.exports}
module.exports={load};
