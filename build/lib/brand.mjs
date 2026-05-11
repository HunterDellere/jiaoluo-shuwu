/**
 * Single source of truth for the site's brand strings.
 *
 * Anything user-facing that names the site, describes what it does, or
 * acts as a tagline lives here. Both build-time renderers (homepage OG
 * card, RSS feed, PWA manifest, page <head>) and the client-side share
 * builder read from this module — the client gets it via data/brand.json
 * which build.mjs emits below.
 *
 * Editing copy here updates every surface in one pass. Do not duplicate
 * these strings into other files.
 */
export const BRAND = {
  cn: '角落書屋',
  en: 'Jiǎoluò Shūwū',
  enShort: 'Shūwū',
  domain: 'jiaoshoo.com',
  url: 'https://jiaoshoo.com',

  // Tagline — short byline. Used on the homepage OG card, page <title>
  // suffix, og:title fallbacks, and the carousel-exporter closer slide.
  // Keep it under ~60 characters so it fits IG/X cards without truncation.
  tagline: 'A reading nook for Chinese language and civilisation',

  // Longer description — used in the PWA manifest, RSS feed, og:description
  // for the homepage. Tells what the site contains, not just what it is.
  description:
    'A reading nook for Chinese language and civilisation. ' +
    'Characters, vocabulary, grammar, history, philosophy, and the world they shaped.',
};
