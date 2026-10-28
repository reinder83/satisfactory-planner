// The world map (#1283): the image the map page draws and where its edges are in the game's world.
// Positions on the map (markers and factory places, later slices of #1283) are kept in the game's
// own world coordinates, game units (centimetres), so the image can be swapped for another one by
// changing WORLD_MAP alone: nothing stored moves.

// One point in the game's world: x grows to the east, y to the south (north is up on the map).
export interface WorldPoint {
  x: number;
  y: number;
}
// One point on the image, in px of its natural size from its top-left corner.
export interface ImagePoint {
  x: number;
  y: number;
}
export interface WorldMapImage {
  src: string;
  width: number;
  height: number;
  // The world coordinates of the image's four edges: west and east are x, north and south y.
  bounds: { west: number; east: number; north: number; south: number };
}

// The owner's map image (2000 × 2000 WebP, the whole map, north up, with the ocean margins; the
// owner's JPG of the same framing that replaced the first 1280 × 1280 one, re-encoded at WebP
// quality 0.85), and
// its calibration: the square of 750,000 game units that the community's interactive maps draw
// the whole world in, x from about −324,699 (west edge) to 425,302 (east edge) and y from −375,000
// (north edge) to 375,000 (south edge). The repository holds no world positions to check it
// against, so these are the commonly used bounds, not measured on this image; swap the image or
// correct the bounds here. The path is page-relative, so it works under the Pages edition's
// /satisfactory-planner/ as under the Docker server's /.
export const WORLD_MAP: WorldMapImage = {
  src: './images/satisfactory-map.webp',
  width: 2000,
  height: 2000,
  bounds: { west: -324_698.832, east: 425_301.832, north: -375_000, south: 375_000 },
};

// Where world point `point` is on the image (px of its natural size). A point outside the bounds
// lands outside the image.
export function worldToImage(point: WorldPoint, map: WorldMapImage = WORLD_MAP): ImagePoint {
  const { west, east, north, south } = map.bounds;
  return {
    x: ((point.x - west) / (east - west)) * map.width,
    y: ((point.y - north) / (south - north)) * map.height,
  };
}

// The world point at image point `point`: the inverse of worldToImage.
export function imageToWorld(point: ImagePoint, map: WorldMapImage = WORLD_MAP): WorldPoint {
  const { west, east, north, south } = map.bounds;
  return {
    x: west + (point.x / map.width) * (east - west),
    y: north + (point.y / map.height) * (south - north),
  };
}
