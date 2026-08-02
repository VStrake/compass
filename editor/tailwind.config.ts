import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        editor: {
          bg: '#0f1115',
          panel: '#15181e',
          raised: '#1c2027',
          border: '#262b34',
          text: '#e5e7eb',
          muted: '#9aa3b2',
          accent: '#4f9cf9',
        },
      },
      fontFamily: {
        ui: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
