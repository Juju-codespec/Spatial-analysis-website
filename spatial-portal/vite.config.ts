import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Ensure CJS default export interop for the plotly factory helper.
    needsInterop: ['react-plotly.js/factory'],
  },
})
