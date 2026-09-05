import {defineConfig} from 'sanity'
import {structureTool} from 'sanity/structure'
import {visionTool} from '@sanity/vision'
import {schemaTypes} from './schemaTypes'

const projectId = 'nva9b0ia'

// One workspace per dataset. `production` is what bikes.pizza is built
// from; `development` is a copy used by the development deploy at
// bikes-pizza.dev, so code can be tested against content without touching
// the live site. Switch between them with the workspace menu in the Studio.
const workspace = (dataset: string, title: string, basePath: string) => ({
  name: dataset,
  title,
  basePath,
  projectId,
  dataset,
  plugins: [structureTool(), visionTool()],
  schema: {
    types: schemaTypes,
  },
})

export default defineConfig([
  workspace('production', 'bikes.pizza', '/production'),
  workspace('development', 'bikes.pizza (development)', '/development'),
])
