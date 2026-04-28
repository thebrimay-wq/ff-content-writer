import { defineConfig } from 'vite'

export default defineConfig({
  base: '/ff-content-writer/',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          lit: ['lit', 'lit/decorators.js', 'lit/directives/unsafe-html.js'],
          marked: ['marked'],
        },
      },
    },
  },
})
