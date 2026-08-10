/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7ff',
          100: '#d9edff',
          500: '#2b7de9',
          600: '#1f66c9',
          700: '#1a52a3',
        },
      },
    },
  },
  plugins: [],
};
