// Tells the user when a newer TaBello is out. It is the app's only request to the Internet besides
// the separation model: one look at the public list of releases on GitHub at startup, which the user
// can turn off. Nothing is downloaded or installed by itself; the user gets a link to the release.
import type { UpdateInfo } from '../shared/ipc';

export const RELEASES_API = 'https://api.github.com/repos/JackF007/taBello/releases?per_page=20';

interface Version {
  core: number[];
  /** Pre-release identifiers ("beta", 1), empty for a release. */
  pre: (string | number)[];
}

function parse(version: string): Version | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(version.trim());
  if (!match) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] ? match[4].split('.').map((id) => (/^\d+$/.test(id) ? Number(id) : id)) : [],
  };
}

/** Semantic-version order: negative when a < b. A pre-release comes before its release (1.0.0-beta.2 < 1.0.0). */
export function compareVersions(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (x.pre.length === 0 || y.pre.length === 0) return y.pre.length - x.pre.length;
  for (let i = 0; i < Math.min(x.pre.length, y.pre.length); i++) {
    const [p, q] = [x.pre[i], y.pre[i]];
    if (p === q) continue;
    if (typeof p === 'number' && typeof q === 'number') return p - q;
    // Numeric identifiers come before alphanumeric ones.
    if (typeof p === 'number') return -1;
    if (typeof q === 'number') return 1;
    return p < q ? -1 : 1;
  }
  return x.pre.length - y.pre.length;
}

interface Release {
  tag_name?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
}

/**
 * The newest published release after `current`, if any. Someone on a beta hears about newer betas
 * too; someone on a release only about releases.
 */
export function newestRelease(releases: unknown, current: string): UpdateInfo | null {
  if (!Array.isArray(releases)) return null;
  const onBeta = (parse(current)?.pre.length ?? 0) > 0;
  let best: UpdateInfo | null = null;
  for (const release of releases as Release[]) {
    if (release.draft === true || typeof release.tag_name !== 'string' || typeof release.html_url !== 'string') continue;
    if (release.prerelease === true && !onBeta) continue;
    if (!release.html_url.startsWith('https://github.com/JackF007/taBello/releases/')) continue;
    const version = release.tag_name.replace(/^v/, '');
    if (!parse(version) || compareVersions(version, current) <= 0) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { version, url: release.html_url };
  }
  return best;
}

/** Asks GitHub for the releases; any failure (offline, rate limit) simply means "nothing new". */
export async function checkForUpdate(current: string, fetch: typeof globalThis.fetch): Promise<UpdateInfo | null> {
  try {
    const response = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!response.ok) return null;
    return newestRelease(await response.json(), current);
  } catch {
    return null;
  }
}
