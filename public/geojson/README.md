# Texas Counties GeoJSON

## Current Status

This directory contains a **placeholder** GeoJSON file (`texas-counties-simplified.json`) with minimal data for development.

## Production Setup

For production, replace with the full 254-county Texas GeoJSON:

### Source

Download from U.S. Census Bureau TIGER/Line (public domain):
- **URL**: https://www.census.gov/cgi-bin/geo/shapefiles/index.php
- **Dataset**: Counties (and equivalent)
- **State**: Texas
- **Year**: 2025 or latest

### Processing

1. Download the shapefile (.shp)
2. Convert to GeoJSON using `ogr2ogr` or QGIS:
   ```bash
   ogr2ogr -f GeoJSON -t_srs EPSG:4326 texas-counties.json tl_2025_48_county.shp
   ```

3. Simplify geometry to reduce file size (optional):
   ```bash
   npm install -g mapshaper
   mapshaper texas-counties.json -simplify 10% -o texas-counties-simplified.json
   ```

4. Ensure FIPS codes are in properties as `FIPS` or `GEOID` (5-digit, e.g. "48201")

5. Place in `/workspace/public/geojson/texas-counties.json`

### Requirements

- **254 features** (one per county)
- **FIPS code** in properties (5-digit string starting with "48")
- **Simplified geometry** (<2MB recommended)
- **EPSG:4326** projection (lat/lon)

### Example Feature Structure

```json
{
  "type": "Feature",
  "properties": {
    "FIPS": "48201",
    "NAME": "Harris",
    "GEOID": "48201"
  },
  "geometry": {
    "type": "Polygon",
    "coordinates": [[[lng, lat], ...]]
  }
}
```

The CRM will automatically match counties by FIPS code and color by outreach_status.
