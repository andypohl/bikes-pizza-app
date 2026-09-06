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
`PUBLIC_SANITY_DATASET`), so no token is needed. Canonical and Open Graph
URLs use `PUBLIC_SITE_URL` (default `https://bikes.pizza`); the development
deploy sets it to its own domain. Images are served from
Sanity's CDN with responsive `srcset`s. `src/lib/sanity.ts` holds the query
and image helpers; `src/pages/` has the index, `category/[category]`,
`post/[slug]` and `member/[username]` routes. The last lists everything a
member has submitted and is linked from the credit on their posts; it is
built for each member with a username and at least one post, at the
lowercased username.

The header's Sign in / Account button uses the shared account page, which
`npm run build` copies from `../web/public` into `dist/account/` so both
share the site's origin and Firebase Auth session. The button's script reads
the Firebase web config from Hosting's `/__/firebase/init.json`, so it only
becomes session-aware when served by Firebase Hosting (locally:
`firebase emulators:start --only hosting` from the repo root, home site on
port 5055); under `astro preview` it stays on its neutral label.

`/shop/` is the store, built from the `product` and `productVariant`
documents that Sanity Connect for Shopify keeps in the dataset
(`src/lib/shop.ts`; the Studio's read-only `shopify.ts` types describe
them). It uses the gallery's grid and theme, with the product name and
price under each photo instead of a hover mask, and one filter chip per
Shopify product type next to "All products". A product page shows the
photo, price, description, a variant picker when there is a choice, a
quantity, and two buttons: Add to cart puts that many in the cart (the
header badge goes up by that many; the cart does not open), and Buy it now
goes straight to checkout with that many of this item, first asking whether
to bring the cart along when it is not empty. Checkout happens on the
store's own domain (`PUBLIC_STORE_URL`, default `https://shop.bikes.pizza/`),
so it stays with Shopify. The cart lives in the browser
(`src/scripts/cart.ts`, localStorage); the header's Cart button shows a
badge with the count and opens a drawer whose quantity controls reflect
what is in the cart, with a Checkout link that hands the whole cart to
Shopify as one cart permalink. The header's Store button goes to
`/shop/` when the build has products and to that domain otherwise. Product changes in Shopify reach the
site through the same rebuild webhook as posts.

`/submit/` is the website's submission form ("Submit a bike or pizza" in the
header). It needs a signed-in member: signed-out visitors are sent to the
sign-in page and brought back afterwards. The form posts to the submissions
REST API (`PUBLIC_API_URL`, default `https://submissions.bikes.pizza`) with
the member's Firebase ID token, downscaling the photo to at most 2048 px on
its long side first; API errors, including the SafeSearch rejection, are
shown inline.
