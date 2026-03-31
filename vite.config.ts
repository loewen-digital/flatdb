import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        svelte: resolve(__dirname, 'src/adapters/svelte.ts'),
        vue: resolve(__dirname, 'src/adapters/vue.ts'),
        solid: resolve(__dirname, 'src/adapters/solid.ts'),
      },
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: [
        'fs',
        'fs/promises',
        'path',
        'zod',
        'nanoid',
        'vue',
        'solid-js',
        'svelte',
        'svelte/store',
      ],
    },
  },
  plugins: [dts()],
})
