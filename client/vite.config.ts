// Optional exact host override for a local development environment; wildcards are not used.
import { defineConfig, mergeConfig } from 'vite'
import originalConfig from './vite.config.original'

const allowedHost = process.env.OHMX_VITE_ALLOWED_HOST?.trim()
const localConfig = {
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    ...(allowedHost ? { allowedHosts: [allowedHost] } : {})
  },
  preview: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    ...(allowedHost ? { allowedHosts: [allowedHost] } : {})
  }
}

export default defineConfig((env) => {
  const base = typeof originalConfig === 'function'
    ? originalConfig(env)
    : originalConfig

  return mergeConfig(base || {}, localConfig)
})
