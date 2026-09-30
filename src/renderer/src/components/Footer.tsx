import { useEffect, useState } from 'react';
import { tabello } from '@/lib/api';
import type { AppInfo } from '../../../shared/ipc';

const Footer = () => {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    tabello?.getAppInfo().then(setAppInfo).catch(() => setAppInfo(null));
  }, []);

  return (
    <footer className="py-5 px-6 text-xs text-muted-foreground text-center">
      TaBello{appInfo && ` v${appInfo.version}`} · open source · runs 100% on your computer
    </footer>
  );
};

export default Footer;
