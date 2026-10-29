const fs = require('node:fs');
const path = require('node:path');

// with-native-build-budget selects GeoJSON/Turf 7 for navigation-core. MapLibre
// React Native 11.5.0 still assumes the Java 6 mutable/platform-nullable API here.
// Keep this patch versioned and fail on upstream changes instead of casting away
// nullability or installing both GeoJSON implementations (duplicate JVM classes).
const original = `    private fun toGeometryCollection(features: MutableList<Feature>): GeometryCollection {
        val geometries = ArrayList<Geometry?>()
        geometries.ensureCapacity(features.size)
        for (feature in features) {
            geometries.add(feature.geometry())
        }
        return GeometryCollection.fromGeometries(geometries)
    }`;
const patched = `    private fun toGeometryCollection(features: List<Feature>): GeometryCollection {
        val geometries = ArrayList<Geometry>()
        geometries.ensureCapacity(features.size)
        for (feature in features) {
            feature.geometry()?.let { geometries.add(it) }
        }
        return GeometryCollection.fromGeometries(geometries)
    }`;

function patchGeoJSON(source, version) {
  if (version !== '11.5.0') throw new Error(`Review the MapLibre GeoJSON patch for version ${version}; expected 11.5.0.`);
  const normalized = source.replaceAll('\r\n', '\n');
  const oldCount = normalized.split(original).length - 1;
  const newCount = normalized.split(patched).length - 1;
  if (oldCount === 0 && newCount === 1) return source;
  if (oldCount !== 1 || newCount !== 0) throw new Error('MapLibre GeoJSON source changed; refusing to apply a partial or ambiguous patch.');
  const result = normalized.replace(original, patched);
  return source.includes('\r\n') ? result.replaceAll('\n', '\r\n') : result;
}

function applyPatch() {
  const root = path.dirname(require.resolve('../package.json'));
  const manifest = require.resolve('@maplibre/maplibre-react-native/package.json', { paths: [root] });
  const { version } = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  const target = path.join(path.dirname(manifest), 'android/src/main/java/org/maplibre/reactnative/utils/GeoJSONUtils.kt');
  const source = fs.readFileSync(target, 'utf8');
  const result = patchGeoJSON(source, version);
  if (result !== source) fs.writeFileSync(target, result);
  console.info(`MapLibre ${version}: GeoJSON 7 compatibility patch ${result === source ? 'already applied' : 'applied'}.`);
}

module.exports = { patchGeoJSON };
if (require.main === module) applyPatch();
