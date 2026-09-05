import {defineCliConfig} from 'sanity/cli'
import {dataset, datasets, projectId} from './environment'

// One hosted Studio per dataset (see environment.ts). CLI commands such as
// `sanity dataset` default to production; pass --dataset to target the copy.
const target = datasets[dataset ?? 'production']

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
