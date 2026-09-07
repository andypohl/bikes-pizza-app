import {defineCliConfig} from 'sanity/cli'
import {dataset, datasets, projectId} from './environment'

// One hosted Studio per dataset (see environment.ts). CLI commands such as
// `sanity dataset` default to production; pass --dataset to target the copy.
const target = datasets[dataset ?? 'production']

// An unattended deploy must say which dataset it means, rather than fall
// back to .env.production and publish the production Studio by default.
if (process.env.CI && process.argv.includes('deploy') && !process.env.SANITY_STUDIO_DATASET) {
  throw new Error('SANITY_STUDIO_DATASET must be set when deploying from CI.')
}

export default defineCliConfig({
  api: {
    projectId,
    dataset: dataset ?? 'production',
  },
  deployment: {
    appId: target.appId,
    /**
     * Enable auto-updates for studios.
     * Learn more at https://www.sanity.io/docs/studio/latest-version-of-sanity#k47faf43faf56
     */
    autoUpdates: true,
  },
})
