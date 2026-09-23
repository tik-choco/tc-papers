import { defineConfig } from 'vitest/config'
import preact from '@preact/preset-vite'

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [preact()],
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'happy-dom',
    execArgv: ['--no-experimental-webstorage'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/**', '**/.git/**'],
  },
})
