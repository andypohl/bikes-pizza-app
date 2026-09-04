# bikes.pizza website

Astro site that renders the posts in Sanity as a photo gallery, adapted from
[Astro Frame Shift](https://github.com/EmaSuriano/astro-frame-shift) by Ema
Suriano: masonry grid, category pages per feed, post pages with the full body
and related posts, view transitions, and a dark/light toggle.

```sh
npm install
npm run dev       # http://localhost:4321
npm run build     # static output in dist/, served by the `home` Hosting target
npm run preview
```

Posts are fetched at build time from the public Sanity dataset (project and
dataset in `astro.config.mjs`; override with `PUBLIC_SANITY_PROJECT_ID` and
`PUBLIC_SANITY_DATASET`), so no token is needed. Images are served from
Sanity's CDN with responsive `srcset`s. `src/lib/sanity.ts` holds the query
and image helpers; `src/pages/` has the index, `category/[category]` and
`post/[slug]` routes.

The header's Sign in / Account button uses the shared account page, which
`npm run build` copies from `../web/public` into `dist/account/` so both
share the site's origin and Firebase Auth session. The button's script reads
the Firebase web config from Hosting's `/__/firebase/init.json`, so it only
becomes session-aware when served by Firebase Hosting (locally:
`firebase emulators:start --only hosting` from the repo root, home site on
port 5055); under `astro preview` it stays on its neutral label.

The header also links to the store (`PUBLIC_STORE_URL`, default
`https://shop.bikes.pizza/`).

`/submit/` is the website's submission form ("Submit a bike or pizza" in the
header). It needs a signed-in member: signed-out visitors are sent to the
sign-in page and brought back afterwards. The form posts to the submissions
REST API (`PUBLIC_API_URL`, default `https://submissions.bikes.pizza`) with
the member's Firebase ID token, downscaling the photo to at most 2048 px on
its long side first; API errors, including the SafeSearch rejection, are
shown inline.
