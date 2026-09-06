// Which Studio this build is. Read by both sanity.cli.ts and
// sanity.config.ts so the two never disagree.
//
// SANITY_STUDIO_DATASET names the dataset a hosted Studio serves. Unset (a
// local `sanity dev`) the Studio shows a workspace per dataset; set, it has
// a single workspace at the root for that dataset and deploys to that
// dataset's hostname. `.env.production` sets it for a plain `sanity deploy`
// (production mode); the deploy:dev script overrides it on the command line.

export const projectId = 'nva9b0ia'

export const datasets = {
  production: {title: 'bikes.pizza', appId: 'i4ccofd8epajvv85ttu6d8oh'},
  development: {title: 'bikes.pizza (development)', appId: 'hxksp1qnp5dtjshqppa1fsnc'},
}

export type Dataset = keyof typeof datasets

// An unattended deploy must say which dataset it means, rather than fall
// back to .env.production and publish the production Studio by default.
if (process.env.CI && !process.env.SANITY_STUDIO_DATASET) {
  throw new Error('SANITY_STUDIO_DATASET must be set when deploying from CI.')
}

const requested = process.env.SANITY_STUDIO_DATASET || undefined

if (requested !== undefined && !(requested in datasets)) {
  throw new Error(
    `SANITY_STUDIO_DATASET must be one of ${Object.keys(datasets).join(', ')}, got "${requested}"`,
  )
}

export const dataset = requested as Dataset | undefined
