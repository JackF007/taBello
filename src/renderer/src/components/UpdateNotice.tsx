import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { tabello } from '@/lib/api';
import type { UpdateInfo } from '../../../shared/ipc';

/** A bar at the top when a newer TaBello is out: a link to download it, nothing installed by itself. */
const UpdateNotice = () => {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    tabello?.getUpdate().then(setUpdate).catch(() => setUpdate(null));
  }, []);

  if (!update) return null;
  const stopChecking = async () => {
    await tabello?.setPreferences({ checkForUpdates: false });
    setUpdate(null);
  };
  return (
    <div role="status" aria-label="Update available" className="flex flex-wrap items-center justify-center gap-3 border-b border-gh-green/40 bg-gh-green/10 px-6 py-2 text-sm">
      <span>
        <span className="font-semibold text-gh-green">TaBello {update.version}</span> is available.
      </span>
      <Button asChild size="sm" className="h-8 rounded-full">
        <a href={update.url} target="_blank" rel="noreferrer">
          <Download className="mr-1 h-4 w-4" /> Download
        </a>
      </Button>
      <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={() => void stopChecking()}>
        Don't check for updates
      </Button>
      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setUpdate(null)} aria-label="Dismiss">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
};

export default UpdateNotice;
