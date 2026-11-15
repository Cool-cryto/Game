---
name: map-rendering
description: How this grand strategy game draws and interacts with its world map — country and province borders, map data formats, zooming and panning, map modes, selection and hover. Use when building or changing anything on the map, adding or editing map data, or fixing map performance or display bugs.
---

# Map rendering

The world map is the heart of the game. These rules keep it fast, correct and easy to change.

## Data

- Store map geometry as **TopoJSON** (shared borders, much smaller than GeoJSON). Convert to GeoJSON features at load time with `topojson-client`.
- Keep map data in `public/maps/` and game data separately in `src/data/`. Geometry describes *where* a province is; game data describes *what* it is.
- Every province has a stable string id (e.g. `"prov_0412"`). Geometry and game data join on this id only, never on names or array positions.
- Country ownership is **game state**, not map data. A country's shape is derived from the provinces it owns, so borders update when provinces change hands.
- Use only map sources whose license allows use in a game (e.g. Natural Earth, public domain). Record the source and license in `public/maps/SOURCES.md`.
- Simplify geometry before shipping (e.g. `mapshaper -simplify`). Keep a raw copy outside `public/` if needed for re-processing.

## Rendering

- Use a fixed projection (default: `d3-geo` Equal Earth or Mercator, chosen once and used everywhere).
- Start with **SVG** while the province count is small (< ~1,000). Move to **Canvas 2D** or **WebGL** (e.g. PixiJS, deck.gl, MapLibre) when SVG hover/zoom gets slow. Keep rendering behind one module so the switch doesn't touch game logic.
- Pre-project geometry once into screen-space paths; don't re-project on every frame.
- Zoom and pan with `d3-zoom` (or the chosen renderer's camera). Clamp zoom to sensible limits and keep the map from being dragged fully off-screen.
- **Level of detail:** show country borders and labels when zoomed out, province borders and labels only when zoomed in.
- Labels must not overlap badly; hide lower-priority labels first.

## Map modes

- A map mode is a pure function: `(provinceId, gameState) => color`. Examples: political, terrain, population, diplomacy.
- Changing map mode only recolors; it never rebuilds geometry.
- Every map mode has a legend in the UI.

## Interaction

- Hover highlights a province and shows a tooltip; click selects it and opens its panel.
- Use a single event handler on the map container and look up the province id (SVG `data-id` or a color-picking buffer for Canvas/WebGL), not one listener per province.
- React components never own map geometry. React holds UI state (selected province id, current map mode); the map module reads it.

## Performance checks

- Target 60 fps while panning and zooming on a mid-range laptop.
- Profile with the browser Performance panel before optimizing. Check for re-renders of the whole map on hover.

## Testing

- Unit-test map-mode functions and id joins (every province in the data has geometry and vice versa).
- Use a Playwright screenshot test for the default map view to catch broken rendering.
