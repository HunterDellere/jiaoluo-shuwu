/**
 * indexability.mjs — the single rule for which pages Google may index.
 *
 * Context (local/seo/03-spam-recovery.md): on 2026-08-24 the site lost ~99%
 * of its Google impressions in one day, with no manual action and every page
 * still indexed. The site had ~900 URLs, almost all AI-drafted in three months,
 * and its "verified" flag was set by a script, not a person. Recovery depends
 * on Google seeing only pages a human has read and stands behind.
 *
 * A page is indexable only when:
 *   - status is 'complete', and
 *   - `human_reviewed: 'YYYY-MM-DD'` is set (by Hunter, never by a script or
 *     an AI session), and
 *   - the page has not been edited since that review (`updated` is not later
 *     than `human_reviewed`). An edit after review needs a fresh review.
 *
 * Everything else ships with noindex,follow: visitors still see it and crawlers
 * still follow its links, but it is not offered to the index.
 */

export const ROBOTS_NOINDEX_FOLLOW   = '<meta name="robots" content="noindex,follow">';
export const ROBOTS_NOINDEX_NOFOLLOW = '<meta name="robots" content="noindex,nofollow">';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function humanReviewDate(fm) {
  const v = fm && fm.human_reviewed;
  return typeof v === 'string' && ISO_DATE.test(v) ? v : null;
}

export function isIndexable(fm) {
  if (!fm || fm.status !== 'complete') return false;
  const reviewed = humanReviewDate(fm);
  if (!reviewed) return false;
  const updated = typeof fm.updated === 'string' ? fm.updated : '';
  return updated <= reviewed;
}

export function robotsMetaFor(fm) {
  if (fm.status === 'stub' || fm.status === 'draft') return ROBOTS_NOINDEX_NOFOLLOW;
  return isIndexable(fm) ? '' : ROBOTS_NOINDEX_FOLLOW;
}

/** True when an HTML document carries a robots meta containing noindex. */
export function hasNoindex(html) {
  const m = html.match(/<meta\s+name="robots"\s+content="([^"]*)"/i);
  return !!m && /noindex/i.test(m[1]);
}
