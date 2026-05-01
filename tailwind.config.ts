import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,html}'],
  theme: {
    extend: {
      colors: {
        midnight:  '#001C29',
        denim:     '#2D75B2',
        gold:      '#cfaf6c',
        pepper:    '#ec4325',
        steel:     '#bcd0df',
        sky:       '#dbe6ee',
        stone:     '#f1e7d1',
        parchment: '#f9f4ec'
      },
      fontFamily: {
        serif: ['Georgia', 'serif'],
        sans:  ['Arial', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
} satisfies Config;
