const {withProjectBuildGradle}=require('@expo/config-plugins');
module.exports=config=>withProjectBuildGradle(config,c=>{
  const marker='// Velox: bound native compiler memory';
  if(!c.modResults.contents.includes(marker))c.modResults.contents+='\n'+marker+`\nsubprojects { project ->
  project.configurations.configureEach {
    resolutionStrategy.dependencySubstitution {
      substitute module('org.maplibre.gl:android-sdk-geojson') using module('org.maplibre.gl:geojson-jvm:7.0.0-pre0')
      substitute module('org.maplibre.gl:android-sdk-turf') using module('org.maplibre.gl:turf-jvm:7.0.0-pre0')
    }
  }
  ['com.android.library', 'com.android.application'].each { plugin ->
    project.plugins.withId(plugin) {
      project.extensions.getByName('android').defaultConfig.externalNativeBuild.cmake.arguments.addAll([
        '-DCMAKE_JOB_POOLS=velox_compile=1', '-DCMAKE_JOB_POOL_COMPILE=velox_compile'
      ])
    }
  }
}
`;
  return c;
});
