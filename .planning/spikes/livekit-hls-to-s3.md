---
spike: livekit-hls-to-s3
date: 2026-11-16
status: findings — not implemented, not tested
question: Can LiveKit Egress write HLS straight to S3 and remove the Mux dependency?
---

# Spike: LiveKit Egress → S3 HLS, instead of → RTMP → Mux

## Why

The live pipeline has never run. Phase 3's Task 4 was deferred in April 2026 pending a
Mux Growth plan, a nonprofit discount request went in at the same time, and seven months
later it is still the oldest unresolved item on the board. `latency_mode` — `reduced` or
`low` — has been open just as long, for the same reason: nobody can test it.

Today's path is `LiveKit Egress → RTMP → Mux → HLS → hls.js`. Mux is the only link in
that chain we neither control nor can unblock ourselves.

**The question is whether LiveKit can write the HLS itself**, into the S3 bucket
provisioned back in 01-02, and cut Mux out.

## What the docs establish

From the LiveKit Egress [outputs](https://docs.livekit.io/home/egress/outputs/) and
[API](https://docs.livekit.io/home/egress/api/) references:

- **HLS output exists and is first-class.** `segment_outputs` (`segmentOutputs`) takes a
  `SegmentedFileOutput[]`, documented as "currently only supports a single entry".
- **`SegmentedFileOutput` fields:** `protocol` (`HLS_PROTOCOL`), `filename_prefix`,
  `playlist_name`, `live_playlist_name`, `segment_duration` (seconds),
  `filename_suffix` (`INDEX` or `TIMESTAMP`), `disable_manifest`. The API reference marks
  every field optional.
- **`live_playlist_name` is the one that matters for live viewing** — it produces "a
  playlist containing only the last few segments", i.e. a sliding window, as opposed to
  `playlist_name` which is the full one.
- **Storage** goes in a request-level `StorageConfig`. The per-output `s3`/`gcp` fields
  are **deprecated**. S3 takes `access_key`, `secret`, `bucket`, `region`, optional
  `endpoint` (must start with `https://`) and `force_path_style` for S3-compatible
  providers.
- 🟢 **A stream output and a segment output can run at the same time.** "A request can
  combine one file output, one stream output, one segment output, and any number of image
  outputs. Egress transcodes once and writes to all of them." This is the finding that
  shapes the whole plan — see Migration below.
- **Limits** (LiveKit Cloud Build plan): HLS segments 12 hours, RTMP streaming 12 hours,
  file output 3 hours; 2 concurrent egress per project. A 32-minute LD debate is nowhere
  near any of these. Whether combining a file output with a segment output drops the whole
  job to the 3-hour file limit is **not stated**; we would not combine them anyway.

## The thing that decides it, and it is not documented

🔴 **The docs never state that the live playlist is readable while the egress is still
running.** They say `live_playlist_name` holds "the last few segments" and they list
`live_playlist_location` in the result — but nothing says a player can poll that object
during recording and get a working stream, and nothing describes the expected latency.

Everything else here is a detail. This is the spike. Until someone points hls.js at a
live playlist mid-egress and sees video, this is a plausible plan, not a solution.

Two more unknowns the LiveKit docs do not cover, because they are ours and not theirs:

- **How the browser reads the bucket.** The playlist and every segment need to be
  fetchable by hls.js: public-read, or CloudFront in front, or presigned URLs (awkward,
  since the player fetches segment URLs itself). CORS has to allow the player's origin.
  Right now nothing serves anything out of that bucket.
- **Latency.** Mux "reduced" is roughly 5-10s, which the observer UI already admits to
  with its "Live (delayed)" badge. Segment duration drives HLS latency — every example in
  the docs uses `2` seconds, and no recommendation is given. Plain S3 + CloudFront with
  2s segments should land in a similar range, but that is reasoning, not a measurement.

## What it would change in this repo

Small, which is the encouraging part.

**`lib/livekit/egress-service.ts`** — `startDebateEgress` currently passes a single
`StreamOutput` with `urls: ['mux://<key>']`. It would pass a segment output as well, or
instead.

⚠️ **`startRoomCompositeEgress` is deprecated** per the API reference, in favour of
`StartEgress` with a `TemplateSource` and an `outputs` array. Worth knowing before
building on it. Also: the Node SDK example in the docs only shows `{ stream: streamOutput }`
— **the key for a segment output in the Node call is not documented**. `{ segments: … }`
is an inference from the `StartEgress` JSON shape, not something the docs state, and is
the first thing to check against the installed SDK's types.

**`ObserverShell.tsx:75`** — builds `https://stream.mux.com/${mux_playback_id}.m3u8`. It
would build the bucket/CloudFront URL of the live playlist instead. The observer already
runs hls.js with Safari native fallback, so **the player does not change at all**.

**Schema** — `mux_playback_id` and `mux_stream_id` would be joined or replaced by an
HLS URL (or a key prefix). `mux_stream_key` is already nulled right after egress starts.

**`lib/env.ts`** — `MUX_TOKEN_ID` and `MUX_TOKEN_SECRET` are `z.string().min(1)`,
fail-fast at boot. Dropping Mux means relaxing those and adding the S3 credentials, which
01-02 provisioned but which this service does not currently read.

## Migration

Because a stream and a segment output coexist in one egress, this does not have to be a
switch:

1. **Add** `segment_outputs` to the existing egress alongside the Mux RTMP stream. One
   transcode, two destinations. Nothing about the current path changes, and if HLS-to-S3
   produces nothing, the Mux path is untouched.
2. Point a scratch player at the live playlist and watch it. **This is the actual spike**,
   and it answers the undocumented question above.
3. If it works: switch `ObserverShell` to the S3 URL, keep Mux running in parallel for a
   debate or two, then drop the stream output and the Mux env vars.

Step 1 is the cheap one and it is testable the moment there is a live room — which there
can be today, since the speaker room has worked since the Phase 2 E2E and only the
*observer video* was ever Mux-dependent.

## Recommendation

**Worth doing, and worth doing before paying Mux anything.** It removes a vendor we can't
unblock, removes a per-minute cost, makes the `reduced`-vs-`low` question moot, and the
client-side change is a URL.

But the honest status is: **the central assumption is undocumented.** Budget the spike as
"get a live playlist written to S3 and see whether a player can read it mid-debate", not
as "implement HLS egress". If the live playlist turns out to be written only on
completion, this whole path collapses to a recording mechanism and Mux stays.

## Not established here

- Whether live playback works during egress — **the whole question**
- Real latency versus Mux `reduced`
- S3 and CloudFront cost at EV's volume
- The Node SDK's actual key for segment outputs, and whether to move to `StartEgress`
- Bucket access model (public-read vs CloudFront vs presigned) and CORS
- Whether the free Mux tier even blocks live ingest — sources conflict, and the account
  is the only authority. Worth five minutes before any of the above.
