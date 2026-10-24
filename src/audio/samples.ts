/**
 * Recorded SFX loading.
 *
 * The engine's soundbank is synthesised up front, but a handful of cues -
 * the jump, the landing, the menu click, the pickup bell - are the sounds a
 * player hears most, and the Kenney packs cover them with real recordings.
 * Each cue keeps its synthesiser as the fallback, so a missing sample is a
 * slightly different jump, never a silent one.
 *
 * Decoding needs the engine's own `AudioContext`, so the loader takes the
 * context and both the URL map and the decoder are injectable for tests.
 */

import { logger } from '../core/log.js';
import jumpUrl from '../assets/audio/jump.ogg?url';
import landSoftUrl from '../assets/audio/land-soft.ogg?url';
import landMediumUrl from '../assets/audio/land-medium.ogg?url';
import landHardUrl from '../assets/audio/land-hard.ogg?url';
import uiClickUrl from '../assets/audio/ui-click.ogg?url';
import pickupUrl from '../assets/audio/pickup.ogg?url';

/** The recorded samples the engine may play instead of its synthesiser. */
export type SfxSampleId = 'jump' | 'land-soft' | 'land-medium' | 'land-hard' | 'ui-click' | 'pickup';

/** Where each sample lives in the bundle. */
export const SFX_SAMPLE_URLS: Readonly<Record<SfxSampleId, string>> = {
  jump: jumpUrl,
  'land-soft': landSoftUrl,
  'land-medium': landMediumUrl,
  'land-hard': landHardUrl,
  'ui-click': uiClickUrl,
  pickup: pickupUrl,
};

/** Decodes one sample against the engine's context. */
export type SfxSampleDecoder = (context: AudioContext, url: string) => Promise<AudioBuffer>;

/** Fetch and decode the way a browser does; injectable for tests. */
export async function decodeSfxSample(context: AudioContext, url: string): Promise<AudioBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const data = await response.arrayBuffer();
  return await context.decodeAudioData(data);
}

/**
 * Decodes every registered sample, dropping whatever fails rather than
 * rejecting: one bad OGG must not silence the whole cue set.
 */
export async function loadSfxSamples(
  context: AudioContext,
  urls: Readonly<Record<SfxSampleId, string>> = SFX_SAMPLE_URLS,
  decode: SfxSampleDecoder = decodeSfxSample,
): Promise<ReadonlyMap<SfxSampleId, AudioBuffer>> {
  const entries = Object.entries(urls) as [SfxSampleId, string][];
  const results = await Promise.all(
    entries.map(async ([id, url]) => {
      try {
        return [id, await decode(context, url)] as const;
      } catch (error) {
        logger.debug('audio', `sample "${id}" could not be decoded`, { url, error: String(error) });
        return null;
      }
    }),
  );
  return new Map(results.filter((entry): entry is readonly [SfxSampleId, AudioBuffer] => entry !== null));
}
