import {defineCliConfig} from 'sanity/cli'
import {dataset, datasets} from './environment'

// One deployed app per dataset (see environment.ts). The app id is what
// `sanity deploy` printed the first time each was deployed.
export default defineCliConfig({
  app: {
    organizationId: 'opsyhsyek',
    entry: './src/App.tsx',
  },
  deployment: {
    appId: datasets[dataset].appId,
  },
})
