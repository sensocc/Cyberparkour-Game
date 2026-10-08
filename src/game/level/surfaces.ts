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
 *
 * V0.4 grows the table three ways: an **emissive** surface (for neon signs), a
 * **sign** texture, and an **acoustic** mapping, so what a surface sounds like
 * underfoot follows from what it is made of.
 */

export type SurfaceTextureId =
  | 'deck-plate'
  | 'metal-panel'
  | 'concrete'
  | 'hazard'
  | 'grille'
  | 'glass'
  | 'sign';

export interface SurfaceDefinition {
  readonly id: string;
  readonly texture: SurfaceTextureId;
  /** Colour multiplied over the detail texture, as `#rrggbb`. */
  readonly tint: string;
  /** How many world metres one repeat of the texture covers. */
  readonly metresPerTile: number;
  /**
   * Whether the surface lights itself.
   *
   * A neon sign is not lit by the sun; it *is* the light. Marking the surface
   * rather than the prop means one `neon` surface serves every sign, and a prop
   * can recolour it without needing to restate that it glows.
   */
  readonly emissive?: boolean;
}

/** World metres covered by one tile, per texture. */
export const METRES_PER_TILE: Readonly<Record<SurfaceTextureId, number>> = {
  'deck-plate': 2.5,
  'metal-panel': 2,
  concrete: 3,
  hazard: 1.2,
  grille: 0.8,
  glass: 2,
  sign: 2,
};

/**
 * What a surface *sounds* like underfoot.
 *
 * The visual palette and the acoustic palette are not the same thing, and V0.4
 * is where the difference starts to matter: the game has seven textures, but a
 * footstep only needs to know whether it landed on metal, concrete, a grate, or
 * glass. Tying the two together here - rather than in the audio code - means a
 * prop's sound follows from what it is made of, decided in one place.
 */
export type AcousticMaterial = 'metal' | 'concrete' | 'grate' | 'glass';

export const ACOUSTIC_MATERIALS: readonly AcousticMaterial[] = ['metal', 'concrete', 'grate', 'glass'];

export const ACOUSTIC_BY_TEXTURE: Readonly<Record<SurfaceTextureId, AcousticMaterial>> = {
  // Tread plate and panelling both ring like sheet metal under a boot.
  'deck-plate': 'metal',
  'metal-panel': 'metal',
  concrete: 'concrete',
  // A painted hazard rail is still a steel rail.
  hazard: 'metal',
  grille: 'grate',
  glass: 'glass',
  // A sign is a glass tube in a metal frame; it rings like glass.
  sign: 'glass',
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

  // Neon signage. The tint is the gas colour; a prop recolours it per sign.
  { id: 'neon', texture: 'sign', tint: '#57e0ff', metresPerTile: METRES_PER_TILE.sign, emissive: true },
];

const BY_ID = new Map(SURFACES.map((surface) => [surface.id, surface]));

export function surfaceById(id: string): SurfaceDefinition | undefined {
  return BY_ID.get(id);
}

/** Whether a surface lights itself. */
export function isEmissiveSurface(id: string): boolean {
  return surfaceById(id)?.emissive === true;
}

/** What a surface sounds like underfoot, or `undefined` for an unknown surface. */
export function acousticForSurface(id: string): AcousticMaterial | undefined {
  const surface = BY_ID.get(id);
  return surface ? ACOUSTIC_BY_TEXTURE[surface.texture] : undefined;
}

/** Texture ids the generator must provide. Kept in sync by a test. */
export function surfaceTextureIds(): SurfaceTextureId[] {
  return [...new Set(SURFACES.map((surface) => surface.texture))].sort();
}
