# Dikho CRM update service

A small Cloudflare Worker that tells the Android app whether a newer APK exists,
and serves that APK as a static file. It is independent of the CRM: no database,
no secret and no binding to business data.

```
Android app -> GET /api/update -> Worker reads releases/manifest.json
Android app -> GET /releases/dikho-crm-vX.Y.Z.apk -> static asset, no Worker run
Person      -> GET /download -> 302 to the current stable APK
```

There is no route that publishes. A release goes out only as a `wrangler deploy`
by someone logged in to the Cloudflare account.

Nothing here is deployed yet. Deploying needs the owner's approval.

## API

`GET /api/update?appId=in.dikho.crm&versionCode=1&channel=stable&platform=android`

`channel` and `platform` are optional. Any other parameter is rejected, so the
app cannot start sending more than this by accident.

| Case | Status | Body |
| --- | --- | --- |
| Up to date, or nothing published on the channel | 200 | `{"updateAvailable":false}` |
| Newer release exists | 200 | full metadata, see below |
| Bad input | 400 | `{"error":"invalid_version_code"}` and similar |
| Unknown channel | 404 | `{"error":"unknown_channel"}` |
| Manifest fails validation | 500 | `{"error":"release_metadata_invalid"}` |
| Not GET or HEAD | 405 | `{"error":"method_not_allowed"}` |
| Plain http off localhost | 403 | `{"error":"https_required"}` |

```json
{
  "updateAvailable": true,
  "version": "1.1.0",
  "versionCode": 2,
  "mandatory": false,
  "releaseNotes": "Bug fixes.",
  "apkUrl": "https://<host>/releases/dikho-crm-v1.1.0.apk",
  "sha256": "<64 hex characters>",
  "sizeBytes": 12345678,
  "publishedAt": "2026-11-04T00:00:00Z"
}
```

`mandatory` is worked out per caller: it is true only when the caller's version
code is below that release's `minSupportedVersionCode`. Raising the minimum never
affects anyone already above it. A mandatory update still cannot lock anyone out:
if it fails to install the app offers "Continue for now" and asks again at the
next launch.

## Where the service lives

`dikho.in`'s DNS is at Hostinger, not Cloudflare (checked 2026-11-04: nameservers
are `ns1.dns-parking.com` and `ns2.dns-parking.com`). A Worker Custom Domain needs
the zone on Cloudflare, so **a Worker cannot serve `updates.dikho.in` today**.
`manage.dikho.in` works because Cloudflare Pages accepts a CNAME from outside.

The app therefore defaults to `https://dikho-updates.fineeurox.workers.dev`, the
same account subdomain the API Worker uses. It needs no DNS change.

The address is compiled into the APK, so choose before the first real release. It
can still move later: ship an update with the new address while keeping the old
service alive until everyone has it. To use `updates.dikho.in` instead, either
move the `dikho.in` zone to Cloudflare, or deploy this same code as a Pages
project and add a CNAME at Hostinger. Both change production DNS and need the
owner's approval. Then build with
`tool/build-release.sh --update-base-url https://updates.dikho.in`.

## APK hosting

Static Assets allow 25 MiB per file. The measured size of the current APK is in
`docs/ANDROID.md`. Files are served with a one-year immutable cache, so a
versioned name must never be reused, and `add-release.mjs` refuses to.

A deploy replaces the whole asset set, so **keep the APK of every version people
may still be downloading in `public/releases/`** on the machine you deploy from.
APKs are ignored by Git, so back them up with your release records.

If an APK ever exceeds 25 MiB, host it elsewhere and pass its address with
`--apk-url`, then add that host to the app's `EXTRA_APK_HOSTS` build setting. An
R2 bucket on the existing account has no egress fees and stays free within its
storage allowance.

## Publishing a release

Full walkthrough in `docs/ANDROID.md`. In short:

```bash
source ~/.local/share/dikho-android/env.sh
```

```bash
node cloudflare-updater/scripts/add-release.mjs --apk dikho-mobile/build/app/outputs/flutter-apk/app-release.apk --notes "What changed, in plain words."
```

```bash
git diff cloudflare-updater/releases/manifest.json
```

```bash
npx wrangler deploy -c cloudflare-updater/wrangler.jsonc
```

`add-release.mjs` reads the version, version code, app ID and signing certificate
from the APK itself. It refuses a version code that is not higher than the
published one, an APK with a different application ID, and an APK signed by a
different certificate than the manifest pins. The first run pins the certificate,
so make sure the first release is signed with the production key.

The manifest is checked by `npm test`, and a broken one makes the Worker answer
500, which the app treats as "no update". A bad edit cannot push a bad install.

## Tests

```bash
node --test cloudflare-updater/test/*.test.js
```

These also run as part of `npm test`.

## Rolling back

Android cannot downgrade an app in place. To undo a bad release, publish a new
one with a higher version code containing the old code. To stop a bad release
reaching more people first, restore the previous `manifest.json` and redeploy:
anyone who already updated stays on the bad version until the fix ships.
