const {test}=require('node:test'),assert=require('node:assert/strict');
const configure=require('../app.config.js');
test('Android variants have separate identity and cleartext requires explicit local-demo opt-in',()=>{
  const prior={variant:process.env.APP_VARIANT,demo:process.env.EXPO_PUBLIC_LOCAL_DEMO};
  try {
    const build=config=>config.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-build-properties')[1];
    const ids=[];for(const role of ['customer','driver']){process.env.APP_VARIANT=role;delete process.env.EXPO_PUBLIC_LOCAL_DEMO;const config=configure({config:{plugins:['expo-build-properties']}});ids.push(config.android.package);assert.equal(config.extra.appRole,role);assert.equal(build(config).android.usesCleartextTraffic,false)}
    assert.notEqual(ids[0],ids[1]);process.env.EXPO_PUBLIC_LOCAL_DEMO='true';assert.equal(build(configure({config:{}})).android.usesCleartextTraffic,true);process.env.APP_VARIANT='typo';assert.throws(()=>configure({config:{}}));
  } finally {for(const [key,value] of [['APP_VARIANT',prior.variant],['EXPO_PUBLIC_LOCAL_DEMO',prior.demo]]){if(value===undefined)delete process.env[key];else process.env[key]=value}}
});
