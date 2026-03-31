import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { resolve } from 'path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      formats: ['es', 'cjs'],
      fileName: 'index',
    },
    rollupOptions: {
      external: ['fs', 'fs/promises', 'path', 'zod', 'nanoid'],
    },
  },
  plugins: [dts({ rollupTypes: true })],
})
