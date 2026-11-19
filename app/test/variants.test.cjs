const {test}=require('node:test'),assert=require('node:assert/strict');
const configure=require('../app.config.js');
test('Android variants have separate identity and cleartext requires explicit local-demo opt-in',()=>{
  const prior={variant:process.env.APP_VARIANT,demo:process.env.EXPO_PUBLIC_LOCAL_DEMO};
  try {
    const build=config=>config.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-build-properties')[1];
    const originalSplash=['expo-splash-screen',{backgroundColor:'#208AEF',image:'./assets/images/splash-icon.png'}];
    const ids=[];for(const role of ['customer','driver']){process.env.APP_VARIANT=role;delete process.env.EXPO_PUBLIC_LOCAL_DEMO;const config=configure({config:{plugins:['expo-build-properties',originalSplash]}});ids.push(config.android.package);assert.equal(config.extra.appRole,role);assert.equal(build(config).android.usesCleartextTraffic,false);
      const splash=config.plugins.find(p=>Array.isArray(p)&&p[0]==='expo-splash-screen');
      if(role==='customer'){assert.equal(splash[1].backgroundColor,'#00685f');assert.equal(splash[1].image,'./assets/images/velox-customer-foreground.png');}
      else assert.deepEqual(splash,originalSplash);
    }
    assert.notEqual(ids[0],ids[1]);process.env.EXPO_PUBLIC_LOCAL_DEMO='true';assert.equal(build(configure({config:{}})).android.usesCleartextTraffic,true);process.env.APP_VARIANT='typo';assert.throws(()=>configure({config:{}}));
  } finally {for(const [key,value] of [['APP_VARIANT',prior.variant],['EXPO_PUBLIC_LOCAL_DEMO',prior.demo]]){if(value===undefined)delete process.env[key];else process.env[key]=value}}
});
