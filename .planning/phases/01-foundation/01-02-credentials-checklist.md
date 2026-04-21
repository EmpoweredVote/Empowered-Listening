# Phase 01 Credentials Checklist

**Last updated:** 2026-04-20

## Status

| Service | Status | Credential Name | Storage Location |
|---|---|---|---|
| LiveKit Cloud URL | [x] | LIVEKIT_URL | Password manager / `.dev.vars` |
| LiveKit API Key | [x] | LIVEKIT_API_KEY | Password manager / `.dev.vars` |
| LiveKit API Secret | [x] | LIVEKIT_API_SECRET | Password manager / `.dev.vars` |
| Mux Token ID | [x] | MUX_TOKEN_ID | Password manager / `.dev.vars` |
| Mux Token Secret | [x] | MUX_TOKEN_SECRET | Password manager / `.dev.vars` |
| AWS Access Key ID | [x] | AWS_ACCESS_KEY_ID | Password manager / `.dev.vars` |
| AWS Secret Access Key | [x] | AWS_SECRET_ACCESS_KEY | Password manager / `.dev.vars` |
| AWS S3 Bucket Name | [x] | AWS_S3_BUCKET_NAME | empowered-listening-recordings |
| AWS Region | [x] | AWS_REGION | us-east-1 |
| Deepgram API Key | [x] | DEEPGRAM_API_KEY | Password manager / `.dev.vars` |
| Accounts CORS allowlist entry | [x] | (config, not a secret) | CORS_ORIGIN on ev-accounts-api Render |
| Accounts role slugs registered | [x] | (config, not a secret) | public.roles in Supabase (migration applied) |
| Listening gem service key | [x] | LISTENING_GEM_KEY | GEMS_SERVICE_KEYS on ev-accounts-api Render |
| Listening XP service key | [x] | LISTENING_XP_KEY | Password manager / `.dev.vars` + ev-accounts-api Render |

## Architecture Note

Originally planned to use Cloudflare Stream (video) and Cloudflare R2 (storage).  Switched to Mux + AWS S3 because empowered.vote DNS is on AWS/GoDaddy — incompatible with Cloudflare Workers custom domains.  Hosting also switched from Cloudflare Workers to Render.

## Notes

- All secrets live in operator's password manager and are pasted into `.dev.vars` during plan 01-03.
- `.dev.vars` is gitignored.
- `.env.example` documents variable names with REDACTED values.
- No credential value is committed to git, ever.
- AWS IAM user: `empowered-listening-s3` with AmazonS3FullAccess policy.
- Mux environment: Production (empowered-listening).
- AWS S3 bucket: `empowered-listening-recordings` in us-east-1.
- IAM key rotation target: 2027-04-20 — add to calendar.
