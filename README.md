# AquaLab

AquaLab is a static water-analysis application built with HTML, CSS, and browser JavaScript. It includes strip scanning, calibration, sensor pages, and optional weather context fetched directly from Open-Meteo.

## Cloudflare Workers deployment

Run commands from the repository root using a supported Node.js release and npm. Authenticate with `npx wrangler login` when deploying locally, or configure Cloudflare credentials in your deployment environment.

- Build command: none (the repository contains the deployable files).
- Production deploy command: `npx wrangler deploy`.
- Non-production version upload command: `npx wrangler versions upload`.
- Local preview: `npx wrangler dev`.

`wrangler.jsonc` names the Worker `aqualab` and serves static assets from `.`. There is no server-side Worker entry point or generated `dist` directory. `.assetsignore` excludes deployment configuration and development-only files while retaining the browser calibration utility.

The browser service worker (`service-worker.js`) provides PWA caching; it is separate from Cloudflare Workers hosting. Keep its asset list and cache version current when application assets change.

Before merging deployment changes, validate a preview built from the latest default branch: open the home, sensors, and calibration pages; exercise scanner startup with weather available and unavailable; and check PWA installation and offline loading. Confirm which Cloudflare project and domain are production: a successful Pages preview does not verify the Workers deployment.
