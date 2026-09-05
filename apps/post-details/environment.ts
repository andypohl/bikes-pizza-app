// Which dataset this build of the app works on. Read by sanity.cli.ts (which
// app it deploys as) and src/App.tsx (which dataset it edits), so the two
// never disagree.
//
// SANITY_APP_DATASET names the dataset. Unset (a local `sanity dev`) it is
// the development copy, so nothing touches live content by accident; the
// deploy scripts set it explicitly.

export const projectId = 'nva9b0ia'

export const datasets = {
  production: {
    title: 'Post details',
    appId: 'vrq0n2d7nuvccw8sdqu04fsp' as string | undefined,
    studioUrl: 'https://bikes-pizza.sanity.studio',
  },
  development: {
    title: 'Post details (development)',
    appId: 'qmbotgakrhzkdf1xmn61s3q6' as string | undefined,
    studioUrl: 'https://bikes-pizza-dev.sanity.studio',
  },
}

export type Dataset = keyof typeof datasets

const requested = process.env.SANITY_APP_DATASET || 'development'

if (!(requested in datasets)) {
  throw new Error(
    `SANITY_APP_DATASET must be one of ${Object.keys(datasets).join(', ')}, got "${requested}"`,
  )
}

export const dataset = requested as Dataset
