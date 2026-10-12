import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, '.', '')

  return {
    plugins: [react()],
    // Development stays at `/`; production defaults to the GitHub Pages repo path.
    base: command === 'serve' ? '/' : env.VITE_BASE_PATH || '/freelance-escrow/',
  }
})
