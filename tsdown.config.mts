import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  platform: 'node',
  target: 'node20',
  dts: true,
  sourcemap: true,
  // Strapi does `require(provider).init(...)`, so the CJS build must expose `init` on module.exports.
  cjsDefault: true,
});
