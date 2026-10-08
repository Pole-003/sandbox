/// <reference types="vite/client" />

/** Version de l'application (semver de package.json), injectée au build. */
declare const __APP_VERSION__: string;
/** Canal de publication : 'production' (/sandbox/) ou 'beta' (/sandbox/beta/). */
declare const __CANAL__: 'production' | 'beta';
