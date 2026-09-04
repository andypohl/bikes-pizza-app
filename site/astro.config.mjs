// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sanity from '@sanity/astro';

// Public identifiers of the Sanity project the site is built from. The
// dataset is public, so builds need no token.
const projectId = process.env.PUBLIC_SANITY_PROJECT_ID || 'nva9b0ia';
const dataset = process.env.PUBLIC_SANITY_DATASET || 'production';

// https://astro.build/config
export default defineConfig({
  site: 'https://bikes.pizza',
  prefetch: { defaultStrategy: 'viewport' },
  integrations: [
    sanity({ projectId, dataset, apiVersion: '2025-02-19', useCdn: false }),
  ],
  vite: { plugins: [tailwindcss()] },
});
