// Generate simplified 254-county Texas GeoJSON from seed data
const { texasCounties } = require('./scripts/seed');
const fs = require('fs');

// Approximate Texas bounds
const TX_MIN_LAT = 25.84;
const TX_MAX_LAT = 36.50;
const TX_MIN_LNG = -106.65;
const TX_MAX_LNG = -93.51;

// Generate simple rectangular polygons for each county
// In production, use real TIGER/Line data
const features = texasCounties.map((county, index) => {
  // Distribute counties across Texas in a grid pattern
  const cols = 17;
  const rows = Math.ceil(254 / cols);
  const col = index % cols;
  const row = Math.floor(index / cols);
  
  const lngStep = (TX_MAX_LNG - TX_MIN_LNG) / cols;
  const latStep = (TX_MAX_LAT - TX_MIN_LAT) / rows;
  
  const minLng = TX_MIN_LNG + (col * lngStep);
  const maxLng = minLng + lngStep * 0.9; // 90% to avoid overlap
  const minLat = TX_MIN_LAT + (row * latStep);
  const maxLat = minLat + latStep * 0.9;
  
  return {
    type: 'Feature',
    properties: {
      FIPS: county.fips,
      NAME: county.name,
      SEAT: county.seat
    },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [minLng, minLat],
        [minLng, maxLat],
        [maxLng, maxLat],
        [maxLng, minLat],
        [minLng, minLat]
      ]]
    }
  };
});

const geojson = {
  type: 'FeatureCollection',
  features: features
};

fs.writeFileSync(
  './public/geojson/texas-counties.json',
  JSON.stringify(geojson, null, 2)
);

console.log(`✓ Generated GeoJSON with ${features.length} Texas counties`);
console.log('Note: Uses simplified rectangular boundaries for development.');
console.log('For production, replace with Census Bureau TIGER/Line data.');
