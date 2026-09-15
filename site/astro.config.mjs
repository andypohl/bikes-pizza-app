// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';

// The Firebase project the posts are read from (src/lib/firestore.ts).
// Deploys set it to the environment's project; a build without it uses
// the development project from .firebaserc, so local builds and pull
// request checks see the development content.
process.env.PUBLIC_FIREBASE_PROJECT ||= JSON.parse(readFileSync(new URL('../.firebaserc', import.meta.url), 'utf8')).projects.dev;

// Where the built site is served from, used for canonical and Open Graph
// URLs. The development deploy overrides it with its own domain.
const site = process.env.PUBLIC_SITE_URL || 'https://bikes.pizza';

// https://astro.build/config
export default defineConfig({
  site,
  prefetch: { defaultStrategy: 'viewport' },
  vite: { plugins: [tailwindcss()] },
});
