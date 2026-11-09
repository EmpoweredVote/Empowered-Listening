/// <reference types="vitest/globals" />
import { pickRecording } from './recording';

const pub = (id: string) => [{ id, policy: 'public' }];

describe('pickRecording', () => {
  it('returns no recording and not pending for an empty list', () => {
    expect(pickRecording([])).toEqual({ playbackId: null, pending: false });
  });

  it('returns the public playback ID of a ready asset', () => {
    expect(pickRecording([{ status: 'ready', duration: 60, playback_ids: pub('abc') }]))
      .toEqual({ playbackId: 'abc', pending: false });
  });

  it('prefers the longest ready asset', () => {
    expect(pickRecording([
      { status: 'ready', duration: 12, playback_ids: pub('short') },
      { status: 'ready', duration: 900, playback_ids: pub('long') },
    ]).playbackId).toBe('long');
  });

  it('reports pending when the only asset is still preparing', () => {
    expect(pickRecording([{ status: 'preparing', playback_ids: pub('x') }]))
      .toEqual({ playbackId: null, pending: true });
  });

  it('skips ready assets without a public playback ID', () => {
    expect(pickRecording([
      { status: 'ready', duration: 60, playback_ids: [{ id: 'signed', policy: 'signed' }] },
    ])).toEqual({ playbackId: null, pending: false });
  });

  it('ignores errored assets', () => {
    expect(pickRecording([{ status: 'errored', playback_ids: pub('bad') }]))
      .toEqual({ playbackId: null, pending: false });
  });
});
