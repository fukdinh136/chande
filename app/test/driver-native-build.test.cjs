const { test } = require('node:test');
const assert = require('node:assert/strict');
const { patchGeoJSON } = require('../scripts/patch-maplibre-geojson.cjs');

// Upstream 11.5.0 fixture: Feature.geometry() may be null, and GeoJSON 7
// FeatureCollection.features() returns List<Feature>, not MutableList<Feature>.
const upstream = `package org.maplibre.reactnative.utils
object GeoJSONUtils {
    private fun toGeometryCollection(features: MutableList<Feature>): GeometryCollection {
        val geometries = ArrayList<Geometry?>()
        geometries.ensureCapacity(features.size)
        for (feature in features) {
            geometries.add(feature.geometry())
        }
        return GeometryCollection.fromGeometries(geometries)
    }
    fun bounds(collection: FeatureCollection) = toGeometryCollection(collection.features()!!)
}
`;

test('Driver native MapLibre patch accepts read-only features and excludes null geometries without unsafe casts', () => {
  const result = patchGeoJSON(upstream, '11.5.0');
  assert.match(result, /toGeometryCollection\(features: List<Feature>\)/);
  assert.match(result, /ArrayList<Geometry>\(\)/);
  assert.match(result, /feature\.geometry\(\)\?\.let \{ geometries\.add\(it\) \}/);
  assert.doesNotMatch(result, /MutableList|Geometry\?|\bas\b|@Suppress/);
  assert.ok(result.endsWith('    fun bounds(collection: FeatureCollection) = toGeometryCollection(collection.features()!!)\n}\n'));
});

test('Driver native MapLibre patch is idempotent and preserves Windows line endings', () => {
  for (const source of [upstream, upstream.replaceAll('\n', '\r\n')]) {
    const result = patchGeoJSON(source, '11.5.0');
    assert.equal(patchGeoJSON(result, '11.5.0'), result);
    assert.equal(result.includes('\r\n'), source.includes('\r\n'));
    if (source.includes('\r\n')) assert.doesNotMatch(result, /(?<!\r)\n/);
  }
});

test('Driver native MapLibre patch rejects an unreviewed library version or changed/ambiguous source', () => {
  assert.throws(() => patchGeoJSON(upstream, '11.6.0'), /Review.*11\.6\.0/);
  assert.throws(() => patchGeoJSON(upstream.replace('geometries.ensureCapacity(features.size)', '// upstream changed'), '11.5.0'), /refusing/);
  assert.throws(() => patchGeoJSON(upstream + upstream, '11.5.0'), /ambiguous/);
  assert.throws(() => patchGeoJSON(upstream + patchGeoJSON(upstream, '11.5.0'), '11.5.0'), /ambiguous/);
});
