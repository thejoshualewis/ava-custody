/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { card: '#0f172a0a' },
      boxShadow: { 'soft': '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)' },
      borderRadius: { 'xl2': '1rem' }
    },
  },
  plugins: [],
}
