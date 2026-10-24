import { describe, expect, it } from 'vitest';
import { checkForUpdate, compareVersions, newestRelease } from './updates';

const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/JackF007/taBello/releases/tag/${tag}`,
  draft: false,
  prerelease: tag.includes('-'),
  ...extra,
});

describe('update check', () => {
  it('orders versions, betas before their release', () => {
    expect(compareVersions('0.1.0-beta.1', '0.1.0-beta.2')).toBeLessThan(0);
    expect(compareVersions('0.1.0-beta.2', '0.1.0-beta.10')).toBeLessThan(0);
    expect(compareVersions('0.1.0-beta.9', '0.1.0')).toBeLessThan(0);
    expect(compareVersions('0.1.0', '0.1.1')).toBeLessThan(0);
    expect(compareVersions('0.2.0', '0.10.0')).toBeLessThan(0);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
  });

  it('finds the newest release, betas only for beta users', () => {
    const releases = [release('v0.1.0-beta.1'), release('v0.1.0-beta.2'), release('v0.1.0'), release('v0.2.0-beta.1'), release('v0.3.0', { draft: true })];
    expect(newestRelease(releases, '0.1.0-beta.1')?.version).toBe('0.2.0-beta.1');
    expect(newestRelease(releases, '0.1.0')).toBeNull();
    expect(newestRelease([release('v0.1.0')], '0.1.0-beta.2')).toEqual({ version: '0.1.0', url: 'https://github.com/JackF007/taBello/releases/tag/v0.1.0' });
  });

  it('ignores anything that is not one of our release pages', () => {
    expect(newestRelease([release('v9.0.0', { html_url: 'https://example.com/malware' })], '0.1.0')).toBeNull();
    expect(newestRelease({ message: 'API rate limit exceeded' }, '0.1.0')).toBeNull();
    expect(newestRelease([{ tag_name: 42 }, release('not-a-version')], '0.1.0')).toBeNull();
  });

  it('treats a failed request as nothing new', async () => {
    const offline = (() => Promise.reject(new Error('offline'))) as unknown as typeof fetch;
    const limited = (() => Promise.resolve(new Response('{}', { status: 403 }))) as unknown as typeof fetch;
    expect(await checkForUpdate('0.1.0', offline)).toBeNull();
    expect(await checkForUpdate('0.1.0', limited)).toBeNull();
    const ok = (() => Promise.resolve(Response.json([release('v0.2.0')]))) as unknown as typeof fetch;
    expect((await checkForUpdate('0.1.0', ok))?.version).toBe('0.2.0');
  });
});
