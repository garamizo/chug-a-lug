# References: open-source survey and verified facts

Surveyed 2026-09-19. Stars, licenses, and last-push dates were read from the GitHub API on that day
and are approximate. "Reuse" means we would depend on it; "study" means we read it for patterns only
(usually because of license or age). Sections mirror the app's components.

Quick picks are at the top; the long tables follow.

## Quick picks

| Need | Pick | Why |
|---|---|---|
| Backend (auth, realtime, files) | PocketBase | One MIT binary, SQLite, SSE realtime, S3-optional files; same binary locally and on Fly.io |
| Frontend | SvelteKit + `@vite-pwa/sveltekit` | Smallest bundles, simple mental model, first-class PWA plugin |
| Decode Metra feed | `gtfs-realtime-bindings` | Official protobuf bindings, same API in JS and Python |
| Static schedule queries | `node-gtfs` | One command imports Metra's zip into SQLite; "next train A to B" is a query |
| Line geometry | `gtfs-to-geojson` | Per-line GeoJSON from Metra's `shapes.txt` at build time |
| Schematic diagram | `d3-tube-map` | Client-side SVG from a small JSON you hand-author for three lines |
| Map | MapLibre GL JS + Protomaps PMTiles | Zero tile cost, `line-offset` for shared trackage, proven by transitstat.us |
| Bars near a station | Overpass API (OSM) | `amenity=bar|pub|restaurant` within a radius, free, cacheable forever |
| Venue search box | Photon | Search-as-you-type geocoder with `osm_tag` filters |
| Gallery | PhotoSwipe | MIT, touch-first lightbox, 10 KB |
| Compress before upload | `browser-image-compression` | Web-worker resize; keeps EXIF with `preserveExif` |
| Photo GPS/time | `exifr` (client), `exiftool-vendored` (server, videos) | Fast client read; server handles MOV/MP4 |
| Fake clock | `@sinonjs/fake-timers` (JS), `time-machine` (Python) | Ticking fake clocks for sim mode and tests |
| Fake GPS | `geolocation-simulator` pattern; Playwright `setGeolocation` in tests | Waypoint player behind a `?sim=1` flag |
| Mock HTTP in the PWA | MSW | Service-worker interception; same handlers in dev and tests |
| Leaderboard UI | Trophy UI (shadcn registry) | MIT podium, rankings, achievement toasts |
| Auth | PocketBase hook + Twilio Verify (phone OTP, then phone + PIN) | Verify needs no US 10DLC registration; ~$0.06 per successful verification |
| Home hosting | Cloudflare Tunnel (`cloudflared`) | Free, TLS at the edge (required for `.app`), no port forwarding |
| Large uploads | tus (`@tus/server`) | Chunked resumable uploads; Cloudflare free tier caps one request at 100 MB |
| Background tracking (later) | OwnTracks | Only maintained OSS stack with native iOS and Android background tracking to your own HTTP endpoint |

---

## 1. Metra and GTFS

### Metra-specific projects

| Repo | Lang | License | Stars | Last push | What it is |
|---|---|---|---|---|---|
| [spate141/metra-monitor](https://github.com/spate141/metra-monitor) | Python + TS | MIT | 1 | 2026-09 | Single-line commute monitor (MD-W) against the new API: Telegram alerts, delay/annul engine, JSON API, MapLibre dashboard |
| [benwittbrodt/Metra-Tracker](https://github.com/benwittbrodt/Metra-Tracker) | Python | MIT | 6 | 2025-12 | Home Assistant "next 3 trains A to B" merging TripUpdates onto static schedule, express-aware |
| [snadboy/ha-sb-metra](https://github.com/snadboy/ha-sb-metra) | Python | MIT | 1 | 2026-09 | Home Assistant integration for all 11 lines; service calendars N days ahead; map entities per line |
| [trackrat-dev/TrackRat](https://github.com/trackrat-dev/TrackRat) | Python + Swift | GPL-3.0 | 5 | 2026-09 | Multi-agency tracker with a Metra GTFS-RT collector and FastAPI backend |
| [transitstatus/transitstatus-react](https://github.com/transitstatus/transitstatus-react), [store](https://github.com/transitstatus/store) | JS | none | 11 | 2026-09 | Source of transitstat.us, which has a live Metra tracker on MapLibre + PMTiles |
| [transitland/transitland-atlas](https://github.com/transitland/transitland-atlas) | JSON | CC-BY-4.0 | 198 | 2026-09 | Canonical record of Metra's static and RT URLs (`feeds/metrarail.com.dmfr.json`) |
| [joerex1418/metra](https://github.com/joerex1418/metra), [yaseenmustapha/MetraPal](https://github.com/yaseenmustapha/MetraPal), [jhartwell/ExMetra](https://github.com/jhartwell/ExMetra), [atfinke/Metra](https://github.com/atfinke/Metra) | various | MIT/GPL | <10 | 2018–2024 | All target the retired `gtfsapi.metrarail.com` host; schedule-parsing ideas only |

Strengths and caveats:
- **metra-monitor** (reuse/study): closest to our stack; already handles annulments, delay bands, line geometry endpoint, and the "proxy through your own host" rule. Single line by design; generalize to three.
- **Metra-Tracker** (study): cleanest reference for merging TripUpdates with `schedule.zip`, express-aware filtering, and caching keyed on `published.txt`. Home Assistant shaped.
- **ha-sb-metra** (study): computes service calendars ahead of time, useful for a Christmas-week plan.
- **TrackRat** (study): production-grade collector, but GPL and heavy.
- **transitstatus** (study): the best UI reference for Metra on MapLibre, but no license file, so do not copy.

### GTFS and GTFS-realtime libraries

| Repo | Lang | License | Stars | Last push | What it is |
|---|---|---|---|---|---|
| [MobilityData/gtfs-realtime-bindings](https://github.com/MobilityData/gtfs-realtime-bindings) | JS, Python, Go, Java | Apache-2.0 | 440 | 2026-09 | Official protobuf bindings; `FeedMessage.decode(buffer)` |
| [BlinkTagInc/node-gtfs](https://github.com/BlinkTagInc/node-gtfs) | TS | MIT | 505 | 2026-08 | Import static + RT into SQLite/Postgres; query stops, trips, stoptimes with service-date filters |
| [BlinkTagInc/gtfs-to-geojson](https://github.com/BlinkTagInc/gtfs-to-geojson) | TS | MIT | 159 | 2026-08 | Route shapes and stops to GeoJSON |
| [BlinkTagInc/gtfs-to-html](https://github.com/BlinkTagInc/gtfs-to-html) | TS | MIT | 229 | 2026-09 | Printable timetables (handy for a paper backup) |
| [public-transport/gtfs-via-postgres](https://github.com/public-transport/gtfs-via-postgres) | JS | Prosperity-style | 146 | 2026-08 | GTFS into Postgres with arrival/departure views |
| [araichev/gtfs_kit](https://codeberg.org/araichev/gtfs_kit) | Python | MIT | 123 | 2026-08 | pandas/GeoPandas GTFS analysis (home moved to Codeberg) |
| [remix/partridge](https://github.com/remix/partridge) | Python | MIT | 185 | 2023-12 | Fast GTFS reader with service-date filtering |
| [jarondl/pygtfs](https://github.com/jarondl/pygtfs) | Python | MIT | 71 | 2026-04 | GTFS to SQLAlchemy |
| [MobilityData/gtfs-validator](https://github.com/MobilityData/gtfs-validator), [gtfs-realtime-validator](https://github.com/MobilityData/gtfs-realtime-validator) | Java | Apache-2.0 | 423 / 63 | 2026 | Validators, useful for checking our replay files |
| [MobilityData/awesome-transit](https://github.com/MobilityData/awesome-transit) | docs | CC0 | 1.8k | 2026-09 | Index of everything else |
| [jamespfennell/transiter](https://github.com/jamespfennell/transiter) + [realtimerail.nyc](https://github.com/jamespfennell/realtimerail.nyc) | Go, TS | MIT | 118 / 60 | 2026 | Static + RT ingestion service with a clean REST API, and a minimal "next trains at this stop" UI |
| [interline-io/transitland-lib](https://github.com/interline-io/transitland-lib) | Go | see LICENSE | 53 | 2026-09 | Transitland tooling; hosted API serves Metra static |

Strengths and caveats:
- **gtfs-realtime-bindings** (reuse): the one dependency we will certainly import; no Metra extensions needed.
- **node-gtfs** (reuse): server-side only; belongs in the proxy. Very active.
- **transiter** (study or reuse): exactly our "merge static and RT, ask for stop X" architecture; quiet since Feb 2026.
- **partridge / gtfs_kit** (study): one-off analysis of holiday service patterns in a notebook.

### Transit map rendering

| Repo | Lang | License | Stars | Last push | What it is |
|---|---|---|---|---|---|
| [johnwalley/d3-tube-map](https://github.com/johnwalley/d3-tube-map) | JS | BSD-3 | 188 | 2024-03 | London-style schematic from a JSON spec; pan/zoom |
| [railmapgen/rmp](https://github.com/railmapgen/rmp) | TS | GPL-3.0 | 206 | 2026-09 | Drag-and-drop metro map painter with SVG export; authoring tool, not a dependency |
| [ad-freiburg/loom](https://github.com/ad-freiburg/loom) | C++ | GPL-3.0 | 301 | 2026-07 | Automatic GTFS to octilinear schematic SVG; overkill for three lines |
| [richc117/legible-cities](https://github.com/richc117/legible-cities) | Python | GPL-3.0 | 5 | 2026-09 | GTFS to tube-map SVG with animated timetable |
| [maplibre/maplibre-gl-js](https://github.com/maplibre/maplibre-gl-js) | TS | BSD-3 | 11.7k | 2026-09 | Vector-tile WebGL maps; `line-offset` for parallel lines |
| [Leaflet/Leaflet](https://github.com/Leaflet/Leaflet) | JS | BSD-2 | 45.6k | 2026-09 | Lighter raster maps if WebGL is a problem |
| [perliedman/leaflet-realtime](https://github.com/perliedman/leaflet-realtime) | JS | ISC | 764 | 2022-11 | Poll GeoJSON and animate markers (train dots) |
| [bbecquet/Leaflet.PolylineOffset](https://github.com/bbecquet/Leaflet.PolylineOffset) | JS | MIT | 161 | 2020-11 | Parallel lines for shared trackage |
| [mapnificent/mapnificent](https://github.com/mapnificent/mapnificent) | JS | other | 407 | 2024-04 | Isochrones from GTFS, fun for "where can we reach in 30 min" |

Strengths and caveats:
- **d3-tube-map** (reuse): pure client SVG, tiny spec, ideal for three lines with waypoints highlighted. You hand-author coordinates; last release 2024.
- **rmp** (tool): draw the diagram once, export SVG, done.
- **MapLibre** (reuse): with Protomaps PMTiles there is no tile bill. Heavier bundle than Leaflet.

### Routing engines and open transit apps (study)

| Repo | License | Notes |
|---|---|---|
| [motis-project/motis](https://github.com/motis-project/motis) + [Transitous](https://github.com/public-transport/transitous) | MIT / mixed | Free hosted multimodal routing API; check whether Metra RT is in Transitous before relying on it |
| [opentripplanner/OpenTripPlanner](https://github.com/opentripplanner/OpenTripPlanner), [otp-ui](https://github.com/opentripplanner/otp-ui) | LGPL / MIT | Reference router; otp-ui has MIT React itinerary and stop components |
| [OneBusAway/wayfinder](https://github.com/OneBusAway/wayfinder) | AGPL-3.0 | Modern SvelteKit stop/arrival UI; needs the Java OBA server |
| [GIScience/openrouteservice](https://github.com/GIScience/openrouteservice) | GPL-3.0 | Hosted walking directions and a VROOM optimizer with a pub-crawl tutorial |

---

## 2. Planning, voting, comments

### Pub crawl planners

No maintained general-purpose OSS pub crawl planner exists; everything is student grade. Read for patterns.

| Repo | License | Notes |
|---|---|---|
| [maxencefrenette/pub-crawl-planner](https://github.com/maxencefrenette/pub-crawl-planner) | none | Multi-team staggered schedules, PDF handouts; 2017 |
| [DA-Mike/Bar-Hopper](https://github.com/DA-Mike/Bar-Hopper) | none | "End at a fixed point" routing on Leaflet; depends on Yelp, now paid |
| [ahwallace/galway-pub-crawl](https://github.com/ahwallace/galway-pub-crawl) | none | OR-Tools TSP over an OSMnx walking graph; the recipe for real walking distances |
| [oxcompsoc/TSP](https://github.com/oxcompsoc/TSP) | Apache-2.0 | Walking speed decays per pub visited; cute cost model |
| [Pub-Hub/401-Project](https://github.com/Pub-Hub/401-Project) | none | Express API with crawls, stops, and per-stop votes; a reasonable schema to crib |

### Group trip planners (self-hostable)

| Repo | Stack | License | Stars | Last push | Strengths | Caveat |
|---|---|---|---|---|---|---|
| [liketrek/TREK](https://github.com/liketrek/TREK) | NestJS + React + SQLite | AGPL-3.0 | 14k | 2026-09 | Polls, chat reactions, invite links, live sync, PWA, Leaflet/MapLibre by default | A whole product; fork or nothing |
| [seanmorley15/AdventureLog](https://github.com/seanmorley15/AdventureLog) | SvelteKit + Django/PostGIS | GPL-3.0 | 3.7k | 2026-09 | Collaborative collections, per-place notes and photos, Immich integration | Heavy; days not ordered stops; no voting |
| [itskovacs/trip](https://github.com/itskovacs/trip) | TS | MIT | 1.9k | 2026-09 | Minimal POI map + day plans, sharing, has an MCP server | No polls |
| [vahdamv0/wander](https://github.com/vahdamv0/wander) | Spring + Angular | AGPL-3.0 | 0 | 2026-09 | Account-less invite links, drag-reorder stops, expense split | Brand new, heavy stack |
| [clawnify/OpenTripPlanner](https://github.com/clawnify/OpenTripPlanner) | Hono + React on Cloudflare | MIT | 1 | 2026-09 | Tiny MIT scaffold with ordered stops and route lines | Template-grade |
| [zsollti/group-trip-planner](https://github.com/zsollti/group-trip-planner) | NestJS + React | all rights reserved | 0 | 2026-08 | Best voting UX design: advisory votes, stale-vote detection, recorded decisions | Not open source; study only |
| [Prot10/MyTripPlanner](https://github.com/Prot10/MyTripPlanner) | React + Leaflet | AGPL-3.0 | 10 | 2026-09 | Shows the Google-free stack: Nominatim + OSRM + Wikipedia geosearch photos | Solo user; scrapes sites |

### Voting and comments

| Repo | License | Stars | Last push | Strengths | Caveat |
|---|---|---|---|---|---|
| [lukevella/rallly](https://github.com/lukevella/rallly) | AGPL-3.0 | 5.3k | 2026-09 | Doodle-style date polls without accounts, comments, finalize and notify | Dates only; full Next.js app |
| [GRA0007/crab.fit](https://github.com/GRA0007/crab.fit) | GPL-3.0 | 530 | 2026-04 | When2meet grid, phone-friendly | Availability only |
| [nextcloud/polls](https://github.com/nextcloud/polls) | AGPL-3.0 | 284 | 2026-09 | Option polls, participant-added options, REST API | Needs Nextcloud |
| [umputun/remark42](https://github.com/umputun/remark42) | MIT | 5.6k | 2026-09 | Single-container comments with votes, anonymous mode, image upload | Blog-widget styling |
| [giscus/giscus](https://github.com/giscus/giscus) | MIT | 12k | 2026-05 | Zero-DB comments and reactions | Everyone needs GitHub |
| [dessalines/simple-vote](https://github.com/dessalines/simple-vote) | GPL-3.0 | 176 | archived 2022 | Live range voting; nice for rating candidate bars | Archived |

Verdict: for a crew of ten to twenty, votes and comments are two small tables in our own backend.
Rallly is worth embedding only if the date is undecided.

### Places data

| Source | License / cost | Strengths | Caveat |
|---|---|---|---|
| [Overpass API](https://github.com/drolbr/Overpass-API) (OSM) | ODbL attribution | Query `amenity=bar|pub|restaurant|brewery` within N m of each station; name, website, `opening_hours`; cache forever | Public instance rate-limited; suburban hours can be patchy |
| [komoot/photon](https://github.com/komoot/photon) | Apache-2.0 | Search-as-you-type with `osm_tag` filter and location bias; free demo endpoint | Planet index is 95 GB to self-host; a Chicago extract is small |
| [osm-search/Nominatim](https://github.com/osm-search/Nominatim) | GPL-3.0 | Geocoding, reverse geocoding | 1 req/s policy, no autocomplete |
| [Foursquare OS Places](https://opensource.foursquare.com/os-places/) | Apache-2.0 | 100M+ POIs with 1000+ categories; store forever; PMTiles mirror exists | No photos or ratings |
| [Overture Maps places](https://github.com/OvertureMaps/data) | CDLA-Permissive-2.0 (data) | GeoParquet, DuckDB-queryable, merges Meta and Microsoft POIs | No photos |
| Wikimedia Commons geosearch | CC licenses | Free photos near a point with license metadata | Photos of the area, rarely the venue |
| Google Places API (New) | per-SKU free tiers | Ratings, hours, photos | See ToS facts below; Place Photos are the Enterprise SKU |
| Yelp Fusion | $229+/mo after trial | Rich venue data | Out of budget |

Client libraries if Google is used anyway: [`@googlemaps/places`](https://github.com/googleapis/google-cloud-node/tree/main/packages/google-maps-places) (Apache-2.0) for the new API; the older `google-maps-services-js` is legacy-only for Places.

---

## 3. Drinks, scoreboard, gamification

| Repo | License | Stars | Last push | Strengths | Caveat |
|---|---|---|---|---|---|
| [trophyso/ui](https://github.com/trophyso/ui) | MIT | 145 | 2026-09 | 17 shadcn-registry components: leaderboard podium, rankings, achievement badges and toasts | UI only; assumes Tailwind |
| [doittherailway/Homebrewd](https://github.com/doittherailway/Homebrewd) | none | 13 | 2023-01 | Untappd clone; check-in schema (beer, rating, note, location, photo) and per-user counters | Unlicensed, Rails 5 |
| [Kyrremann/beers](https://github.com/Kyrremann/beers) | AGPL-3.0 | 6 | 2026-09 | Stats dashboard ideas for a recap | Needs Untappd export |
| [Gargant0373/BearHub](https://github.com/Gargant0373/BearHub) | Unlicense | 0 | 2024-06 | Simplest possible per-person tally | Toy |
| [isuru89/oasis](https://github.com/isuru89/oasis) | Apache-2.0 | 78 | 2024-08 | Real rules engine for badges and milestones | Needs Redis and RabbitMQ; overbuilt |

Verdict: Fuel Log is one table; Leaderboard is one query; Commendations are a dozen lines of rules. Borrow Trophy UI for the podium if the frontend is React; otherwise hand-roll.

---

## 4. Platform: backend, frontend, auth

### Backends

| Repo | License | Stars | Last push | Realtime | Files | Local-then-cloud story | Caveat |
|---|---|---|---|---|---|---|---|
| [pocketbase/pocketbase](https://github.com/pocketbase/pocketbase) | MIT | 61k | 2026-09 | SSE per collection | local or S3 | One binary + `pb_data`; copy to Fly volume | Server-to-client only; single node |
| [supabase/supabase](https://github.com/supabase/supabase) | Apache-2.0 | 110k | 2026-09 | WebSocket on Postgres replication, presence | S3 + RLS | Hosted free tier; self-host is 7+ containers, 4 GB RAM min | Heavy for 20 users |
| [get-convex/convex-backend](https://github.com/get-convex/convex-backend) | FSL-1.1-Apache | 12.6k | 2026-09 | Reactive queries over WebSocket | built in | SQLite default; Fly and Railway guides | TS-only functions; source-available license |
| [instantdb/instant](https://github.com/instantdb/instant) | Apache-2.0 | 10.5k | 2026-09 | Synced triple store, presence rooms | built in | Hosted is first-class; self-host is Clojure | Graph model, not SQL |
| [appwrite/appwrite](https://github.com/appwrite/appwrite) | BSD-3 | 57k | 2026-09 | WebSocket | built in | Multi-container | Same weight class as Supabase |
| [nhost/nhost](https://github.com/nhost/nhost) | MIT | 9.3k | 2026-09 | GraphQL subscriptions (Hasura) | built in | 6–8 containers | Memory hungry |
| [directus/directus](https://github.com/directus/directus) | MSCL-1.0 | 38k | 2026-09 | WebSocket subscriptions | local or S3 | One Node container + SQLite | Source-available; CMS shaped |
| [payloadcms/payload](https://github.com/payloadcms/payload) | MIT | 45k | 2026-09 | none built in | local, S3, R2 | Next.js only | No realtime |
| [rocicorp/mono](https://github.com/rocicorp/mono) (Zero) | Apache-2.0 | 3.4k | 2026-09 | Sync engine, local SQLite replica | none | Needs Postgres logical replication | No auth or files |
| [electric-sql/electric](https://github.com/electric-sql/electric), [pglite](https://github.com/electric-sql/pglite) | Apache-2.0 | 10k / 16k | 2026-09 | Partial Postgres sync into clients | none | One container + Postgres | Read-path only; overkill unless offline-first |

### Home hosting

| Tool | License | Notes |
|---|---|---|
| [cloudflare/cloudflared](https://github.com/cloudflare/cloudflared) | Apache-2.0 | Outbound-only tunnel from the home box to Cloudflare's edge; free tier; TLS certificate and DNS handled by Cloudflare; 100 MB request body cap on the free plan |
| [tailscale/tailscale](https://github.com/tailscale/tailscale) Funnel | BSD-3 | Alternative public exposure via Tailscale; fewer knobs, no request-size cap, but the domain must be a `ts.net` name unless you front it yourself |

Verdict: Cloudflare Tunnel, since `chugalug.app` is HSTS-preloaded and the tunnel gives a valid certificate with no port forwarding.

### Frontend

| Repo | License | Stars | Notes |
|---|---|---|---|
| [sveltejs/kit](https://github.com/sveltejs/kit) + [vite-pwa/sveltekit](https://github.com/vite-pwa/sveltekit) | MIT | 21k | Smallest bundles, simple model, PWA plugin; recommended |
| [vercel/next.js](https://github.com/vercel/next.js) + [serwist](https://github.com/serwist/serwist) | MIT | 142k | Largest ecosystem; RSC complexity is real for a solo non-JS dev |
| [nuxt/nuxt](https://github.com/nuxt/nuxt) | MIT | 61k | Vue middle ground with `@vite-pwa/nuxt` |
| [bigskysoftware/htmx](https://github.com/bigskysoftware/htmx) | 0BSD | 49k | Server-rendered with SSE extension; pairs with FastAPI; PWA is DIY |
| [zauberzeug/nicegui](https://github.com/zauberzeug/nicegui) | MIT | 16k | Pure Python with `ui.leaflet`; fastest prototype, but state lives on the server and it is not an installable offline PWA |
| [reflex-dev/reflex](https://github.com/reflex-dev/reflex) | Apache-2.0 | 29k | Pure Python compiled to React; same server-state caveat |
| [fastapi/fastapi](https://github.com/fastapi/fastapi) | MIT | 102k | Good home for a Python sidecar (GTFS analysis, EXIF, transcoding) |

### Auth

| Repo | License | Stars | Notes |
|---|---|---|---|
| [better-auth/better-auth](https://github.com/better-auth/better-auth) | MIT | 30k | Plugins: magic-link, email-otp, anonymous (guest session later linkable); any DB incl. SQLite |
| [nextauthjs/next-auth](https://github.com/nextauthjs/next-auth) | ISC | 28k | Magic-link providers; v5 long in beta |
| [lucia-auth/lucia](https://github.com/lucia-auth/lucia) | MIT | 10.5k | Deprecated as a library in 2025; now a 100-line session recipe worth copying for name + PIN |
| [fivestones/family-organizer](https://github.com/fivestones/family-organizer) | MIT | 20 | Working reference for "tap your name, enter PIN" on InstantDB |
| [ory/kratos](https://github.com/ory/kratos) | Apache-2.0 | 13.9k | Six services in the quickstart; too heavy |
| [Twilio Verify](https://www.twilio.com/en-us/user-authentication-identity/verify) | commercial | n/a | Hosted SMS OTP: about $0.05 per successful verification plus $0.0083 per US SMS; uses Twilio's own registered senders, so no A2P 10DLC registration |
| better-auth `phoneNumber` plugin ([docs](https://better-auth.com/docs/plugins/phone-number)) | MIT | see above | `sendOTP` and `sendPasswordResetOTP` hooks; you bring the SMS provider; note [issue 11297](https://github.com/better-auth/better-auth/issues/11297) on OTPs stored in clear |
| Firebase Authentication (phone) | proprietary | n/a | Free phone verification tier; adds a Google dependency and client SDK |

Verdict: PocketBase hook, roughly 80 lines: allowlisted `crew.phone`, Twilio Verify start/check, bcrypt PIN, long-lived token; recovery is the same OTP path.

---

## 5. Media

| Repo | License | Stars | Last push | Strengths | Caveat |
|---|---|---|---|---|---|
| [dimsemenov/PhotoSwipe](https://github.com/dimsemenov/PhotoSwipe) | MIT | 25k | 2025-12 | Touch lightbox, 10 KB, framework-free | Video needs a plugin; slow cadence |
| [sachinchoolur/lightGallery](https://github.com/sachinchoolur/lightGallery) | GPL-3.0 or paid | 7.1k | 2026-09 | HTML5 video, thumbnails, zoom | GPL or commercial license |
| [Donaldcwl/browser-image-compression](https://github.com/Donaldcwl/browser-image-compression) | MIT | 1.7k | 2024-03 | Web-worker resize; `preserveExif` | No HEIC; frozen since 2024 |
| [MikeKovarik/exifr](https://github.com/MikeKovarik/exifr) | MIT | 1.2k | 2024-03 | `exifr.gps(file)` in about 1 ms; parses HEIC | Read-only; frozen |
| [photostructure/exiftool-vendored.js](https://github.com/photostructure/exiftool-vendored.js) | MIT | 560 | 2026-09 | Server-side read/write for photos and MOV/MP4, timezone-aware | Node only; needs Perl in the image |
| [alexcorvi/heic2any](https://github.com/alexcorvi/heic2any), [catdad-experiments/libheif-js](https://github.com/catdad-experiments/libheif-js) | MIT / LGPL-3.0 | 890 / 120 | 2024 / 2026 | HEIC to JPEG in the browser | 1 MB WASM |
| [immich-app/immich](https://github.com/immich-app/immich) | AGPL-3.0 | 115k | 2026-09 | Full photo server with native apps and shared albums | 6 GB RAM, Postgres, ML container |
| [photoprism/photoprism](https://github.com/photoprism/photoprism) | AGPL-3.0 | 40k | 2026-09 | Single image + SQLite, PWA, map | Some features paid |
| [LycheeOrg/Lychee](https://github.com/LycheeOrg/Lychee) | MIT | 4.3k | 2026-09 | Lightweight albums with share links | PHP stack |
| [bpatrik/pigallery2](https://github.com/bpatrik/pigallery2) | MIT | 2.3k | 2026-08 | Directory-first gallery for a Pi | Read-only, no upload UI |
| [tus/tus-node-server](https://github.com/tus/tus-node-server) (`@tus/server`) + [tus-js-client](https://github.com/tus/tus-js-client) | MIT | ~1.8k / ~2.2k | active | Resumable chunked uploads to local disk; survives Safari dropping long requests and the 100 MB Cloudflare cap | Metadata lives in PocketBase; the file lives on disk |

Verdict: build the Mission Archive into the app with PhotoSwipe; the full photo servers are a separate hobby.

---

## 6. Location

| Repo | License | Stars | Last push | Strengths | Caveat |
|---|---|---|---|---|---|
| [owntracks/recorder](https://github.com/owntracks/recorder), [ios](https://github.com/owntracks/ios), [android](https://github.com/owntracks/android), [frontend](https://github.com/owntracks/frontend) | GPL-2.0 / MIT / EPL-1.0 / MIT | 1.2k / 450 / 1.8k / 550 | 2026-09 | Maintained native apps with true background tracking; HTTP mode posts to your own endpoint | Family must install an app and paste a URL |
| [traccar/traccar](https://github.com/traccar/traccar) | Apache-2.0 | 7.8k | 2026-09 | 200+ protocols, client apps, WebSocket live UI | Fleet-management shaped Java server |
| [Freika/dawarich](https://github.com/Freika/dawarich) | AGPL-3.0 | 10.4k | 2026-09 | Google Timeline alternative with family sharing | Rails + PostGIS + Redis; history focus |
| [bilde2910/Hauk](https://github.com/bilde2910/Hauk) | Apache-2.0 | 940 | 2024-06 | Simplest share-a-link live map | No iOS app; stale |
| [wheresfrank/openfamily](https://github.com/wheresfrank/openfamily) | AGPL-3.0 | 1 | 2026-08 | Flutter background location, WebSocket map | Single author; sign your own iOS build |

Verdict: foreground `watchPosition` plus wake lock in the PWA; OwnTracks later if background tracking earns its friction.

---

## 7. Simulation and mocking (Dress Rehearsal)

### GTFS-realtime recording and replay

No off-the-shelf replay server exists. Plan on about 100 lines: poll into `recordings/<event>/<epoch>.pb`, serve the snapshot nearest the virtual clock, rewrite `header.timestamp`.

| Repo | License | Stars | Last push | Strengths | Caveat |
|---|---|---|---|---|---|
| [Metropolitan-Council/gtfs_rt_tools](https://github.com/Metropolitan-Council/gtfs_rt_tools) | none | 4 | 2026-09 | `download` records `.pb` to date-partitioned folders; `parse` to CSV; `view` on a map | Playback is planned, not implemented; no license |
| [JarvusInnovations/gtfs-realtime-archiver](https://github.com/JarvusInnovations/gtfs-realtime-archiver) | AGPL-3.0 | 7 | 2026-09 | Resilient containerized poller with hour partitions | Targets GCS; swap for local disk |
| [tsdataclinic/gtfs-realtime-capsule](https://github.com/tsdataclinic/gtfs-realtime-capsule) | Apache-2.0 | 16 | archived 2025 | Normalizes protobuf to tables | Archived |
| [mattwigway/gtfsrdb](https://github.com/mattwigway/gtfsrdb) | none | 59 | 2015 | SQL-backed archive; "nearest snapshot" is one query | Python 2 era |
| [ccapriotti/trip_update2vehicle_positions](https://github.com/ccapriotti/trip_update2vehicle_positions), [alexmasselot/gtfs-simulation-web](https://github.com/alexmasselot/gtfs-simulation-web) | none | 0 / 4 | 2017 | Two ways to synthesize positions from the schedule; the pattern for our schedule-only fallback | Unmaintained |
| [TheTransitClock/transitime](https://github.com/TheTransitClock/transitime) | GPL-3.0 | 87 | 2024 | Real playback of archived AVL data | Heavy Java |

### GPS mocking

| Repo | License | Stars | Last push | Strengths | Caveat |
|---|---|---|---|---|---|
| [microsoft/playwright](https://github.com/microsoft/playwright) | Apache-2.0 | 96k | 2026-09 | `context.setGeolocation` in a loop walks a route in E2E tests | Tests only |
| [cypress-io/cypress](https://github.com/cypress-io/cypress) | MIT | 51k | 2026-09 | Stub `navigator.geolocation` in `onBeforeLoad` | Must stub `watchPosition` yourself |
| [russellsamora/geolocation-simulator](https://github.com/russellsamora/geolocation-simulator) | MIT | 37 | 2019 | Overrides `navigator.geolocation` and interpolates waypoints with speed and pauses; the `?sim=1` primitive | Straight-line interpolation; feed it the GTFS shape polyline |
| [2gis/mock-geolocation](https://github.com/2gis/mock-geolocation) | MIT | 28 | 2016 | Smallest possible mock to fork | No route playback |
| [Sriharan-S/gps-mock](https://github.com/Sriharan-S/gps-mock) | MIT | 15 | 2026-08 | Android mock-location app with route driving | Android only; iOS needs Xcode GPX simulation |
| [johncarpenter/Android-GPX-Mock-Location-Provider](https://github.com/johncarpenter/Android-GPX-Mock-Location-Provider) | none | 88 | 2021 | Stream a GPX into Android mock location | No license |

Chrome DevTools > Sensors sets a fixed position for free.

### Fake clocks

| Repo | License | Stars | Last push | Strengths | Caveat |
|---|---|---|---|---|---|
| [sinonjs/fake-timers](https://github.com/sinonjs/fake-timers) | BSD-3 | 859 | 2026-09 | `install({now, shouldAdvanceTime: true})` gives a ticking fake `Date` usable in a dev build | Global monkey-patch; gate behind sim flag |
| [adamchainz/time-machine](https://github.com/adamchainz/time-machine) | MIT | 1k | 2026-09 | C-level Python time travel with `tick=True`; pytest fixture | C extension |
| [spulec/freezegun](https://github.com/spulec/freezegun) | Apache-2.0 | 4.5k | 2025-08 | Ubiquitous `@freeze_time` | Slower, misses C-level calls |
| [wolfcw/libfaketime](https://github.com/wolfcw/libfaketime) | GPL-2.0 | 3.1k | 2026-09 | Fake time for any process, rate-scaled | Not on macOS SIP binaries or browsers |
| [DvdGiessen/virtual-clock](https://github.com/DvdGiessen/virtual-clock) | MIT | 15 | 2021 | 200-line pausable, rate-scaled clock to inline | Dormant |
| [travisjeffery/timecop](https://github.com/travisjeffery/timecop) | MIT | 3.4k | 2026-09 | The `freeze / travel / scale` API worth copying | Ruby |

SimClock pattern: `now() = epochStart + (Date.now() - wallStart) * rate`, served from `GET /sim/clock` so all clients agree.

### HTTP mock and replay

| Repo | License | Stars | Strengths | Caveat |
|---|---|---|---|---|
| [mswjs/msw](https://github.com/mswjs/msw) | MIT | 18k | Intercepts fetch inside the PWA via service worker; same handlers in Vitest and Playwright; can return recorded protobuf bytes | Does not record for you |
| [mockoon/mockoon](https://github.com/mockoon/mockoon) | MIT | 8.4k | GUI + CLI; proxy mode records real traffic; serves binary | Time-based selection is fiddly |
| [Netflix/pollyjs](https://github.com/Netflix/pollyjs) | Apache-2.0 | 10k | Record once against Metra, replay forever | Slower cadence |
| [kevin1024/vcrpy](https://github.com/kevin1024/vcrpy) | MIT | 3k | Cassettes for a Python recorder's tests | Test scope only |
| [SpectoLabs/hoverfly](https://github.com/SpectoLabs/hoverfly) | Apache-2.0 | 2.5k | Capture/simulate proxy with latency and failure injection for "feed down" UX | Less browser-native |
| [wiremock/wiremock](https://github.com/wiremock/wiremock), [stoplightio/prism](https://github.com/stoplightio/prism) | Apache-2.0 | 7.4k / 5k | Mature record-playback; OpenAPI validation | JVM; not a recorder |

---

## Verified facts that shape the design

### Metra developer API (metra.com/developers, checked 2026-09-19)
- The old `gtfsapi.metrarail.com` host was shut off **2025-11-01**. Any repo using key+secret basic auth against it is broken.
- Static GTFS, no key: `https://schedules.metrarail.com/gtfs/schedule.zip` (~700 KB) and `published.txt` with the last publish time. Updates land at 3 AM; poll `published.txt` and re-download on change.
- Realtime, key required: `https://gtfspublic.metrarr.com/gtfs/public/{positions,tripupdates,alerts}`, protobuf only. Auth by `Authorization: Bearer <token>` or `?api_token=`. Updated every 30 s; do not poll faster.
- Semantics: no TripUpdate for a trip that should have started means it is on schedule; alerts in the feed are active regardless of `active_period`; positions drop out at terminals.
- License: redistribute through your own host (browser never hits Metra), show "not affiliated with Metra", show last-updated time, no accuracy claims, no Metra trademarks.
- Transitland lists the feed as `f-metra~rt`.

### Metra lines, terminals, and the Dec 26 timetable (feed published 2026-09-18, checked 2026-09-19)
- UP-W: Ogilvie Transportation Center (OTC) to Elburn. MD-W: Union Station (CUS) to Big Timber Road, weekend trains turn at Elgin. BNSF: Union Station to Aurora. OTC and CUS are about 0.3 mi apart.
- GTFS route colors: UP-W `#FE8D81`, MD-W `#F1AD0E`, BNSF `#29C233`.
- **Saturday, Dec 26, 2026** uses service ids `A2A` (Sat+Sun) plus `A3A` (Saturday-only extras), both valid 2026-10-26 to 2026-12-31. No December exceptions are in `calendar_dates.txt` yet; Metra usually publishes holiday-week changes in mid-December.
- The realtime key was verified the same day: positions, trip updates, and alerts all returned HTTP 200 protobuf (154, 24, and 19 entities), and a request without the token returned 401. 128 of the 154 position entities had no route id, so filter on `trip.route_id`.

Saturday trips per line and direction, first stop to last stop:

| Line | Outbound (from downtown) | Inbound (to downtown) |
|---|---|---|
| UP-W | 10 trips from OTC: 8:40, 10:40, 12:40, 14:40, 16:40, 17:40, 18:40, 20:40, 22:40, 00:40; 1 h 28 m to Elburn | 10 trips from Elburn: 6:25, 7:25, 8:25, then every 2 h 10:25 to 22:25 |
| MD-W | 12 trips from CUS to Elgin: 7:30, 8:30, 10:30, 12:30, 14:30, 15:30, 16:30, 17:30, 18:40, 20:40, 22:40, 00:40; 1 h 15 m | 12 trips from Elgin: hourly 5:55 to 11:55, then 13:55, 15:55, 17:55, 20:10, 22:10 |
| BNSF | 20 trips from CUS to Aurora: 6:33, then hourly at :33 from 8:33 to 00:33, plus 17:30 and 22:30 expresses; 1 h 18 m | 20 trips from Aurora: hourly at :05 from 5:05 to 21:05, plus 9:00 and 15:00 expresses, then 23:05 |

Holiday context from Metra's Dec 2025 release: Christmas Eve is a reduced weekday schedule, Christmas Day is a Sunday schedule, and New Year's Eve bans alcohol on trains after 7 PM with free rides after 6 PM. None of that applies on Dec 26, which is a plain Saturday. In 2025 Metra sold a $7 holiday-day pass; the weekend pass price should be checked on metra.com before the Tickets checklist is written.

### Google Places terms and pricing (checked 2026-09-19)
- Free tier is per SKU per month: Essentials 10,000, Pro 5,000, Enterprise 1,000. The old $200 pooled credit ended 2025-02-28.
- Place Photos are an Enterprise SKU ($7 per 1,000, 1,000 free). Nearby Search and Text Search are Pro ($32 per 1,000). A field mask that includes rating, hours, or photos bills at Enterprise.
- Caching: `place_id` indefinitely; lat/lng for 30 days; nothing else, and photo names expire.
- Section 14.2: Places content **may not be used with a non-Google map**. Section 15.1: Places UI Kit components are the exception and may sit on any map.
- Yelp Fusion has no free tier: $229 per month and up after a 30-day trial.

### Browser and PWA constraints
- No browser tracks location in the background. Chromium suspends `watchPosition` for background tabs; iOS re-prompts PWAs for geolocation each session.
- Screen Wake Lock works in Chrome 84+, Safari 16.4+, and in iOS home-screen web apps since iOS 18.4. Released when backgrounded.
- Web Push on iOS: 16.4+, installed to home screen, user gesture, standard VAPID. Declarative Web Push on 18.4+. No Background Sync or Background Fetch on iOS.
- iOS Safari evicts site storage after 7 days of non-use unless installed.
- **iPhones strip GPS from photos chosen through the browser file picker by default** (WebKit bug 207088; other EXIF fields are kept since iOS 16.4). iOS 17+ shows an "Options > Location" toggle in the picker that the user must flip per upload. Photos taken through an in-app `<input capture>` or `getUserMedia` have no EXIF at all, so the app must attach the phone's current Geolocation reading itself.
- HEIC: Safari converts to JPEG on file input only when `accept` lists `image/jpeg` and not `image/heic`. Use `accept="image/jpeg,image/png"` plus a server fallback.
- Cloudflare's free plan rejects request bodies over 100 MB, so video uploads must be chunked (tus) or capped.
- Video: iOS caps `<input capture>` at 10 minutes and often re-encodes to 720p. Use chunked or resumable uploads.

### Domains (IANA root and RDAP, checked 2026-09-19)
- **Chosen and purchased: `chugalug.app`.** The whole `.app` TLD is on the HSTS preload list, so browsers refuse plain HTTP; a valid certificate is required from day one.
- `.choo`, `.train`, `.rail` do not exist. `.beer`, `.express`, `.pub`, `.bar`, `.club`, `.party`, `.fun`, `.rocks`, `.ninja` do.
- Unregistered on that day: `chugalugchoochoo.com`, `chugalugchoo.com`, `chugalug.beer`, `chugalug.express`, `chug.express`, `choochoo.beer`, `allaboard.beer`, `lastcall.express`, `barcar.express`, `tipsytrain.club`. `chugalug.com` and `choochoo.club` are taken.
- Approximate renewal per year: `.com` $11, `.party` $6, `.club` $16, `.rocks` $18, `.beer` $26, `.express` $31, `.bar` $52. First-year promos are much cheaper on `.beer`, `.bar`, `.fun`.
