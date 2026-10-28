import { useEffect, useState } from 'react';
import { tabello } from '@/lib/api';
import { setMusicEnabled } from '@/lib/menuMusic';
import { REPORT_URL, type AppInfo, type Preferences } from '../../../shared/ipc';

const link = 'underline-offset-2 hover:text-foreground hover:underline';

const Footer = () => {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null);

  useEffect(() => {
    tabello?.getAppInfo().then(setAppInfo).catch(() => setAppInfo(null));
    tabello?.getPreferences().then(setPreferences).catch(() => setPreferences(null));
  }, []);

  const toggle = async (key: keyof Preferences) => {
    if (!tabello || !preferences) return;
    const saved = await tabello.setPreferences({ ...preferences, [key]: !preferences[key] });
    setPreferences(saved);
    if (key === 'music') setMusicEnabled(saved.music);
  };

  return (
    <footer className="space-y-1.5 py-5 px-6 text-xs text-muted-foreground text-center">
      <p>TaBello{appInfo && ` v${appInfo.version}`} · © 2026 Giacomo Ferlaino (JackF007) · free software (GPL-3.0) · runs 100% on your computer</p>
      {tabello && (
        <p className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <a href={REPORT_URL} target="_blank" rel="noreferrer" className={link}>
            Report a problem
          </a>
          <span aria-hidden>·</span>
          <button type="button" className={link} onClick={() => void tabello?.openLogFolder()} title="The log of errors, to attach to a report (it stays on your computer)">
            Show the log
          </button>
          {preferences && (
            <>
              <span aria-hidden>·</span>
              <button
                type="button"
                className={link}
                onClick={() => void toggle('checkForUpdates')}
                title="At startup, TaBello asks GitHub whether a newer version is out (nothing else is sent)"
              >
                Check for updates: {preferences.checkForUpdates ? 'on' : 'off'}
              </button>
              <span aria-hidden>·</span>
              <button type="button" className={link} onClick={() => void toggle('music')} title="The soft tune TaBello plays in its menus; it stops whenever a song is open">
                Music: {preferences.music ? 'on' : 'off'}
              </button>
            </>
          )}
        </p>
      )}
    </footer>
  );
};

export default Footer;
