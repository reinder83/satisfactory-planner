// The interface's typefaces (SIL OFL, see THIRD_PARTY.md), from the @fontsource packages:
// Saira Condensed and IBM Plex Mono, latin subset. style.css loads each as ./fonts/<name>;
// build.ts copies them into both editions under those names, and vite.config.ts serves them
// from the packages in development. The file names are part of style.css, so keep them.
import { fileURLToPath } from 'node:url';

const FONTS = {
  'saira-condensed-600.woff2':
    '@fontsource/saira-condensed/files/saira-condensed-latin-600-normal.woff2',
  'saira-condensed-700.woff2':
    '@fontsource/saira-condensed/files/saira-condensed-latin-700-normal.woff2',
  'ibm-plex-mono-400.woff2': '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2',
  'ibm-plex-mono-600.woff2': '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2',
} as const;
export type FontName = keyof typeof FONTS;

// Object.keys types its result as string[]; these are FONTS's own keys.
export const fontNames = Object.keys(FONTS) as FontName[];
export const isFontName = (name: string): name is FontName => Object.hasOwn(FONTS, name);
// The installed file behind one of the names above.
export const fontFile = (name: FontName) => fileURLToPath(import.meta.resolve(FONTS[name]));
