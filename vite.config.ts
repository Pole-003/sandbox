import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vitest/config';
import { injecterCsp } from './config/csp.ts';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/** Injecte la CSP stricte dans le index.html de production (pas en développement : le HMR de Vite injecte des styles en ligne). */
function cspProduction(): Plugin {
  return {
    name: 'pole003-csp',
    apply: 'build',
    transformIndexHtml: { order: 'post', handler: injecterCsp },
  };
}

export default defineConfig(({ mode }) => {
  const canal = mode === 'beta' ? 'beta' : 'production';
  return {
    base: canal === 'beta' ? '/sandbox/beta/' : '/sandbox/',
    define: {
      __APP_VERSION__: JSON.stringify(version),
      __CANAL__: JSON.stringify(canal),
    },
    plugins: [cspProduction()],
    build: {
      // Aucune ressource en data: URI (font-src 'self' interdit les polices en data:).
      assetsInlineLimit: 0,
      target: 'es2022',
    },
    test: {
      include: ['tests/**/*.test.ts'],
      environment: 'node',
    },
  };
});
