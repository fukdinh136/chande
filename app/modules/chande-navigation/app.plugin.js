const { createRunOncePlugin, withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

// Cấu hình native cho module dẫn đường (thư mục android/ của app được sinh lại mỗi lần prebuild,
// nên mọi chỉnh sửa phải đi qua plugin này).
const MARKER = '// chande-navigation: Kotlin metadata';

function setProperty(properties, key, value) {
  const index = properties.findIndex((item) => item.type === 'property' && item.key === key);
  const entry = { type: 'property', key, value: String(value) };
  if (index >= 0) properties[index] = entry;
  else properties.push(entry);
}

function withChandeNavigation(config, props = {}) {
  config = withGradleProperties(config, (cfg) => {
    if (props.mapStyleUrl) setProperty(cfg.modResults, 'chande.navigation.mapStyleUrl', props.mapStyleUrl);
    if (props.sdkVersion) setProperty(cfg.modResults, 'chande.navigation.sdkVersion', props.sdkVersion);
    return cfg;
  });
  // Navigation SDK kéo kotlin-stdlib 2.4 vào classpath; AGP căn phiên bản compile theo runtime nên module :app
  // (Kotlin 2.1.20 của React Native 0.86) cũng cần bỏ qua kiểm tra phiên bản metadata.
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language === 'groovy' && !cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents += `
${MARKER}
tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).configureEach {
  compilerOptions.freeCompilerArgs.add('-Xskip-metadata-version-check')
}
`;
    }
    return cfg;
  });
}

module.exports = createRunOncePlugin(withChandeNavigation, 'chande-navigation', '0.1.0');
