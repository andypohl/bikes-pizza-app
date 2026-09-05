import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {schemaTypes} from './schemaTypes'
import {dataset, datasets, projectId, type Dataset} from './environment'

// One workspace per dataset. `production` is what bikes.pizza is built
// from; `development` is a copy used by the development deploy at
// bikes-pizza.dev, so code can be tested against content without touching
// the live site. Each hosted Studio serves one dataset; a local `sanity dev`
// shows both, switchable with the workspace menu.
const workspace = (name: Dataset, basePath: string) => ({
  name,
  title: datasets[name].title,
  basePath,
  projectId,
  dataset: name,
  plugins: [structureTool(), visionTool()],
  schema: {
    types: schemaTypes,
  },
})

export default defineConfig(
  dataset
    ? workspace(dataset, '/')
    : [workspace('production', '/production'), workspace('development', '/development')],
)
