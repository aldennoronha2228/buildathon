/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'Inter',
          'Noto Sans Kannada',
          'Noto Sans Devanagari',
          'Noto Sans Tamil',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
      },
      colors: {
        obsidian: '#09090B',
        surface: '#121215',
        borderSubtle: '#27272A',
        muted: '#A1A1AA',
      },
    },
  },
  plugins: [],
};
