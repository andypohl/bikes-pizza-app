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
