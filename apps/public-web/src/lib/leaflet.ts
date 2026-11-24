// Shared Leaflet setup for the Map page and the small map in each collection.
// Imported only from dynamically loaded components, so Leaflet stays out of the
// main bundle.
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export { L };

export const MARKER_STYLE = {
  color: '#ffffff',
  weight: 3,
  fillColor: '#0b3d91',
  fillOpacity: 0.85,
} as const;

/** Marker radius grows with the number of photos; never smaller than a fingertip. */
export const markerRadius = (count: number, min = 20) => Math.min(min + 10, min + Math.log2(count) * 2.5);

/** OpenStreetMap tiles plus the OSM and GeoNames credits. */
export function addBaseLayer(map: L.Map): void {
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    // OpenStreetMap's tile policy asks for a referrer; send only our origin.
    referrerPolicy: 'strict-origin-when-cross-origin',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors · Places &copy; <a href="https://www.geonames.org/" target="_blank" rel="noopener">GeoNames</a>',
  }).addTo(map);
  map.attributionControl.setPrefix(false);
}

/** Fit the view to the given points (a single point gets a fixed city-level zoom). */
export function fitTo(map: L.Map, points: [number, number][], maxZoom = 9): void {
  if (points.length === 1) map.setView(points[0]!, maxZoom);
  else if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom });
}
