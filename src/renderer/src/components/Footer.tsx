
import { useEffect, useState } from 'react';
import { Music } from 'lucide-react';
import type { AppInfo } from '../../../shared/ipc';

const Footer = () => {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    window.tabello?.getAppInfo().then(setAppInfo).catch(() => setAppInfo(null));
  }, []);

  return (
    <footer className="bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800">
      <div className="max-w-7xl mx-auto py-12 px-6 md:px-10">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
          <div className="col-span-1 md:col-span-2">
            <div className="flex items-center space-x-2 mb-4">
              <Music className="h-6 w-6 text-tabgenius-700" />
              <span className="font-semibold text-lg">TaBello</span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-6">
              Convert your audio and video recordings into guitar and bass tablature. Open source, and 100% local: your files never leave your computer.
            </p>
          </div>
          
        </div>
        
        <div className="pt-8 mt-8 border-t border-gray-200 dark:border-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
            © {new Date().getFullYear()} TaBello contributors.
            {appInfo && ` · v${appInfo.version} · Electron ${appInfo.versions.electron}`}
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
