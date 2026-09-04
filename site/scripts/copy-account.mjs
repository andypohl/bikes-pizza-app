// Copies the shared account page (web/public) into dist/account so the
// site and the account page share one origin, and therefore one Firebase
// Auth session. Runs after `astro build`.
import { cp } from 'node:fs/promises';
const from = new URL('../../web/public/', import.meta.url);
const to = new URL('../dist/account/', import.meta.url);
await cp(from, to, { recursive: true });
console.log('Copied account page to dist/account/');
