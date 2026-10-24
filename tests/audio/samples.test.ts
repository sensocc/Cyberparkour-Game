/**
 * Recorded SFX loading.
 *
 * Same contract as the texture and prop loaders: a sample that cannot be decoded
 * is dropped rather than fatal, and the engine's synthesiser covers the cue.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  SFX_SAMPLE_URLS,
  decodeSfxSample,
  loadSfxSamples,
  type SfxSampleId,
} from '../../src/audio/samples.js';
import { logsFromAsync, messages } from '../helpers/logs.js';

const buffer = (): AudioBuffer =>
  ({ length: 0, getChannelData: () => new Float32Array(0), copyToChannel() {} }) as unknown as AudioBuffer;

const context = (): AudioContext => ({}) as AudioContext;

const ids = (): SfxSampleId[] => Object.keys(SFX_SAMPLE_URLS) as SfxSampleId[];

describe('loadSfxSamples', () => {
  it('decodes every registered sample', async () => {
    const decode = vi.fn(async () => buffer());
    const samples = await loadSfxSamples(context(), SFX_SAMPLE_URLS, decode);
    expect(samples.size).toBe(ids().length);
    expect(decode).toHaveBeenCalledTimes(ids().length);
  });

  it('drops the ones that fail rather than failing the whole load', async () => {
    const decode = async (_context: AudioContext, url: string) => {
      if (url.includes('jump')) throw new Error('corrupt ogg');
      return buffer();
    };
    const { result, logs } = await logsFromAsync(() => loadSfxSamples(context(), SFX_SAMPLE_URLS, decode));
    expect(result.size).toBe(ids().length - 1);
    expect(result.has('jump')).toBe(false);
    expect(messages(logs).filter((message) => message.includes('jump'))).toHaveLength(1);
  });
});

describe('decodeSfxSample', () => {
  it('rejects on a failed fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404 }) as Response),
    );
    await expect(decodeSfxSample(context(), 'x.ogg')).rejects.toThrow('404');
    vi.unstubAllGlobals();
  });

  it('decodes the body against the engine context', async () => {
    const body = new ArrayBuffer(4);
    const decodeAudioData = vi.fn(async () => buffer());
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => body }) as unknown as Response),
    );
    const audioContext = { decodeAudioData } as unknown as AudioContext;
    const decoded = await decodeSfxSample(audioContext, 'y.ogg');
    expect(decoded).toBeDefined();
    expect(decodeAudioData).toHaveBeenCalledWith(body);
    vi.unstubAllGlobals();
  });
});
