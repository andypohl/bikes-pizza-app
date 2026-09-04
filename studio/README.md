# bikes.pizza Studio

Sanity Studio for the bikes.pizza content model, kept alongside the app so the
schema and the app's readers evolve together. The project and dataset are set
in `sanity.cli.ts` and `sanity.config.ts`.

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
