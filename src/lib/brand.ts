export const colors = {
  midnight:  '#001C29',
  denim:     '#2D75B2',
  gold:      '#cfaf6c',
  pepper:    '#ec4325',
  steel:     '#bcd0df',
  sky:       '#dbe6ee',
  stone:     '#f1e7d1',
  parchment: '#f9f4ec'
} as const;

export type ColorToken = keyof typeof colors;
