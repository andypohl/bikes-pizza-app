# Future features

Ideas that have been thought through but deliberately not built yet. Each
entry says what it would give us, what it would cost, and when it would be
worth doing, so the decision can be revisited without redoing the thinking.

## Render the website at the edge

**Today.** The website is static: Astro runs its GROQ queries against
Sanity on the GitHub Actions runner and writes plain HTML, which Firebase
Hosting serves from its CDN. Content changes reach the site through a
rebuild (the Sanity webhook and the post queues trigger the "Rebuild
website" workflow). Parts of a page that must be fresh are "islands" that
query Sanity or Firebase from the browser, search being the first.

**The idea.** Render pages on request instead, on Cloudflare Workers
(Astro's Cloudflare adapter), querying Sanity each time. Cloudflare's cache
sits in front of the Worker and Sanity's API CDN behind it, so traffic
spikes are still absorbed; the Sanity webhook purges the cache rather than
rebuilding. Every page is then always current, with no rebuild step.

**What it costs.** About a day to set up: the adapter, a Worker deployment
alongside (or instead of) Firebase Hosting for the apex, cache headers and
a purge call in the webhook, and moving the account page copy. Afterwards
there is one more running thing to operate, and page freshness depends on
cache policy rather than on a build having finished.

**When it is worth it.** When the site needs per-visit content across
whole pages: comments, likes, personalisation, or content that changes
more often than a rebuild can follow. For a few posts a day and islands
for the live parts, static pages remain the better trade: faster first
paint, nothing to keep running, and unkillable when a post gets shared.
