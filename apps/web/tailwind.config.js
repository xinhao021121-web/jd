/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#2f6bff', dark: '#1f52d6', soft: '#eef3ff' }
      },
      boxShadow: {
        card: '0 1px 2px rgba(20,30,60,.04), 0 10px 26px rgba(20,30,60,.06)'
      }
    }
  },
  plugins: []
};
