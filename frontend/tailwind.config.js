/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        anduril: {
          black: '#050505',
          dark: '#0a0a0a',
          surface: '#111111',
          card: '#161616',
          border: 'rgba(255, 255, 255, 0.08)',
          borderStrong: 'rgba(255, 255, 255, 0.18)',
          muted: '#737373',
          light: '#e5e5e5',
          laser: '#22c55e',
          amber: '#f59e0b',
        }
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      letterSpacing: {
        widest2: '0.25em',
        widest3: '0.35em',
      }
    },
  },
  plugins: [],
}
