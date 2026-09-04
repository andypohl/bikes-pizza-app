// The site's Firebase app, initialised once from Hosting's reserved config
// URL with the SDK loaded from Google's CDN. Resolves to null on a plain
// `astro preview`, where there is no config.
const CDN = 'https://www.gstatic.com/firebasejs/12.18.0';

let app: Promise<unknown | null> | undefined;

export function firebaseApp(): Promise<unknown | null> {
  app ??= (async () => {
    try {
      const res = await fetch('/__/firebase/init.json');
      if (!res.ok) return null;
      const config = await res.json();
      const { initializeApp } = await import(`${CDN}/firebase-app.js`);
      return initializeApp(config);
    } catch {
      return null;
    }
  })();
  return app;
}

export const sdk = (name: string) => import(`${CDN}/firebase-${name}.js`);
