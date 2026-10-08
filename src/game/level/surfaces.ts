/**
 * Surface materials.
 *
 * Every prop is textured rather than flat-shaded, so a model part names a
 * *surface* instead of a colour. A surface is a tileable detail texture plus a
 * tint that multiplies over it, which is what lets one texture serve many
 * different-looking props and lets a single prop be recoloured without
 * duplicating art.
 *
 * The detail maps are authored light on purpose: `tint x map` should read as the
 * tint, so the tint is the albedo and the map is only the detail on top.
 */

export type SurfaceTextureId =
  | 'deck-plate'
  | 'metal-panel'
  | 'concrete'
  | 'hazard'
  | 'grille'
  | 'glass';

export interface SurfaceDefinition {
  readonly id: string;
  readonly texture: SurfaceTextureId;
  /** Colour multiplied over the detail texture, as `#rrggbb`. */
  readonly tint: string;
  /** How many world metres one repeat of the texture covers. */
  readonly metresPerTile: number;
}

/** World metres covered by one tile, per texture. */
export const METRES_PER_TILE: Readonly<Record<SurfaceTextureId, number>> = {
  'deck-plate': 2.5,
  'metal-panel': 2,
  concrete: 3,
  hazard: 1.2,
  grille: 0.8,
  glass: 2,
};

export const SURFACES: readonly SurfaceDefinition[] = [
  // Structural
  { id: 'deck', texture: 'deck-plate', tint: '#4f5a6b', metresPerTile: METRES_PER_TILE['deck-plate'] },
  { id: 'deck-dark', texture: 'deck-plate', tint: '#3a4350', metresPerTile: METRES_PER_TILE['deck-plate'] },
  { id: 'concrete', texture: 'concrete', tint: '#6c737d', metresPerTile: METRES_PER_TILE.concrete },
  { id: 'concrete-dark', texture: 'concrete', tint: '#5b626b', metresPerTile: METRES_PER_TILE.concrete },

  // Plant and panels
  { id: 'metal', texture: 'metal-panel', tint: '#67717f', metresPerTile: METRES_PER_TILE['metal-panel'] },
  { id: 'metal-light', texture: 'metal-panel', tint: '#7b879a', metresPerTile: METRES_PER_TILE['metal-panel'] },
  { id: 'metal-dark', texture: 'metal-panel', tint: '#454e5c', metresPerTile: METRES_PER_TILE['metal-panel'] },
  { id: 'metal-warm', texture: 'metal-panel', tint: '#6b6154', metresPerTile: METRES_PER_TILE['metal-panel'] },
  { id: 'rust', texture: 'metal-panel', tint: '#7a5238', metresPerTile: METRES_PER_TILE['metal-panel'] },

  // Accents and specials
  { id: 'hazard', texture: 'hazard', tint: '#efe4d2', metresPerTile: METRES_PER_TILE.hazard },
  { id: 'grille', texture: 'grille', tint: '#78828f', metresPerTile: METRES_PER_TILE.grille },
  { id: 'glass', texture: 'glass', tint: '#d8f0f6', metresPerTile: METRES_PER_TILE.glass },
];

const BY_ID = new Map(SURFACES.map((surface) => [surface.id, surface]));

export function surfaceById(id: string): SurfaceDefinition | undefined {
  return BY_ID.get(id);
}

/** Texture ids the generator must provide. Kept in sync by a test. */
export function surfaceTextureIds(): SurfaceTextureId[] {
  return [...new Set(SURFACES.map((surface) => surface.texture))].sort();
}
