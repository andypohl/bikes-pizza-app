# bikes.pizza Studio

Sanity Studio for the bikes.pizza content model, kept alongside the app so the
schema and the app's readers evolve together. The project is set in
`sanity.cli.ts` and `sanity.config.ts`. Two document types: `post`, and
`member`, which mirrors an app account (account id and username) and is
written by the app's functions rather than edited here; posts reference it
so the site shows the member's current username.

The Studio has two workspaces, one per dataset. `production` is what
bikes.pizza is built from. `development` is a copy that the development
deploy (bikes-pizza.dev) builds from and publishes submissions into, so code
can be tested without touching live content. Refresh the copy with
`npx sanity dataset copy production development` (server-side, Growth plan
and up) or, on any plan, `npx sanity dataset export production x.tar.gz`
followed by `npx sanity dataset import x.tar.gz development --replace`.
Both datasets are public, so the website builds need no token. CLI commands
default to `production`; add `--dataset development` to target the copy.

```sh
npm install
npx sanity login              # once per machine
npm run dev                   # Studio at http://localhost:3333
npx sanity schemas deploy     # after changing schemaTypes/ (needed by the MCP tools)
npx sanity deploy             # publish the hosted Studio
```

Import a post from the Ghost site (reads the Content API key from the app's
`config/local.json`, or `GHOST_CONTENT_API_KEY`):

```sh
npx sanity exec scripts/import-ghost-post.ts --with-user-token -- <ghost-slug>
```

It uploads the feature image as an asset, converts the HTML body to Portable
Text, maps Ghost's `biking`/`pizza` tags to the `feed` field, and records the
Ghost id and URL under `source` so the import can be traced. Re-running for a
slug that already exists is refused.
