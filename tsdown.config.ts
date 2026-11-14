import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/express/index.ts', 'src/bin/neode.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  target: 'es2022',
})
