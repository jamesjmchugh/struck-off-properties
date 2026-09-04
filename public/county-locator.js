// County locator map
function initCountyLocator(countyFips) {
  const mapContainer = document.getElementById('county-locator-map');
  if (!mapContainer) return;

  const map = L.map('county-locator-map').setView([31.5, -99.5], 6);
  
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(map);

  fetch('/geojson/texas-counties.json')
    .then(r => r.json())
    .then(geojson => {
      L.geoJSON(geojson, {
        style: feature => {
          const isCurrentCounty = feature.properties.FIPS === countyFips;
          return {
            fillColor: isCurrentCounty ? '#002147' : '#f5f5f5',
            fillOpacity: isCurrentCounty ? 0.8 : 0.3,
            color: '#002147',
            weight: isCurrentCounty ? 2 : 1,
            opacity: isCurrentCounty ? 1 : 0.3
          };
        },
        onEachFeature: (feature, layer) => {
          if (feature.properties.FIPS === countyFips) {
            // Fit bounds to the highlighted county
            map.fitBounds(layer.getBounds(), {
              maxZoom: 8,
              padding: [20, 20]
            });
          }
        }
      }).addTo(map);
    })
    .catch(err => {
      console.error('Failed to load GeoJSON:', err);
      // If county not found or error, show statewide muted view
    });
}
