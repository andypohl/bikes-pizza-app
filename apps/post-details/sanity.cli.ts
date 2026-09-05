import {defineCliConfig} from 'sanity/cli'
import {dataset, datasets} from './environment'

// One deployed app per dataset (see environment.ts). The app id is what
// `sanity deploy` printed the first time each was deployed; without it a
// deploy creates another app, so an unattended deploy refuses to run.
const target = datasets[dataset]
if (process.env.CI && !target.appId) {
  throw new Error(
    `No app id recorded for the ${dataset} dataset. Deploy it once by hand (npm run deploy) and add the id to environment.ts.`,
  )
}

export default defineCliConfig({
  app: {
    organizationId: 'opsyhsyek',
    entry: './src/App.tsx',
  },
  deployment: {
    appId: target.appId,
  },
})
