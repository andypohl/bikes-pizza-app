// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sanity from '@sanity/astro';

// Public identifiers of the Sanity project the site is built from. The
// dataset is public, so builds need no token.
const projectId = process.env.PUBLIC_SANITY_PROJECT_ID || 'nva9b0ia';
const dataset = process.env.PUBLIC_SANITY_DATASET || 'production';
// Where the built site is served from, used for canonical and Open Graph
// URLs. The development deploy overrides it with its own domain.
const site = process.env.PUBLIC_SITE_URL || 'https://bikes.pizza';

// https://astro.build/config
export default defineConfig({
  site,
  prefetch: { defaultStrategy: 'viewport' },
  integrations: [
    sanity({ projectId, dataset, apiVersion: '2025-02-19', useCdn: false }),
  ],
  vite: { plugins: [tailwindcss()] },
});
