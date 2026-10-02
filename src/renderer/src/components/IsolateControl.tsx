import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, FolderOpen, Layers, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { requireApi, tabello } from '@/lib/api';
import { useSeparationModel } from '@/lib/separationModel';
import type { SeparationModelStatus } from '../../../shared/ipc';

const megabytes = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

interface IsolateControlProps {
  /** e.g. "guitar". */
  instrumentName: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}

/**
 * The "isolate the instrument" switch. Turning it on the first time offers to download the
 * separation model (Demucs), which is not bundled because of its license.
 */
const IsolateControl = ({ instrumentName, checked, onCheckedChange, disabled }: IsolateControlProps) => {
  const { data: model } = useSeparationModel();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [download, setDownload] = useState<number | null>(null);

  useEffect(() => tabello?.onSeparationModelProgress(setDownload), []);

  const installed = (status: SeparationModelStatus) => {
    queryClient.setQueryData(['separation-model'], status);
    if (status.installed) {
      setDialogOpen(false);
      onCheckedChange(true);
      toast({ title: 'Separation model installed', description: 'Instruments can now be isolated from band recordings.' });
    }
  };

  const startDownload = async () => {
    setDownload(0);
    const result = await requireApi().downloadSeparationModel();
    setDownload(null);
    if (result.ok) installed(result.value);
    else if (result.error.code !== 'cancelled') toast({ title: 'Download failed', description: result.error.message, variant: 'destructive' });
  };

  const importFile = async () => {
    const result = await requireApi().importSeparationModel();
    if (!result.ok) toast({ title: 'Could not import the model', description: result.error.message, variant: 'destructive' });
    else if (result.value) installed(result.value);
  };

  const remove = async () => {
    queryClient.setQueryData(['separation-model'], await requireApi().deleteSeparationModel());
    onCheckedChange(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Switch
        id="isolate"
        checked={checked && !!model?.installed}
        disabled={disabled || !model}
        onCheckedChange={(on) => (on && !model?.installed ? setDialogOpen(true) : onCheckedChange(on))}
      />
      <label htmlFor="isolate" className="text-sm">
        <span className="font-medium">Isolate the {instrumentName}</span>
        <span className="text-muted-foreground"> from a band recording (slower: about the length of the song)</span>
      </label>
      {model?.installed && (
        <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={() => void remove()} disabled={disabled} title="Delete the separation model to free disk space">
          <Trash2 className="h-3.5 w-3.5 mr-1" /> Remove model ({megabytes(model.sizeBytes)})
        </Button>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => download === null && setDialogOpen(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Layers className="h-5 w-5 text-gh-yellow" /> Download the separation model
            </DialogTitle>
            <DialogDescription>
              To isolate an instrument from a mix, TaBello uses Demucs (Hybrid Transformer Demucs by Meta), which runs on your
              computer like everything else. Its model is downloaded once ({model && megabytes(model.downloadBytes)}, {model && megabytes(model.sizeBytes)} on
              disk) and checked before use.
            </DialogDescription>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            The model's weights come from Meta and are licensed for personal and research use only, so they are not included in
            TaBello itself. By downloading them you accept those terms.
          </p>
          {download !== null && (
            <div className="space-y-1" aria-live="polite">
              <Progress value={download * 100} aria-label="Model download" />
              <p className="text-xs text-muted-foreground">Downloading… {Math.round(download * 100)}%</p>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            {download === null ? (
              <>
                <Button variant="ghost" onClick={() => void importFile()}>
                  <FolderOpen className="h-4 w-4 mr-1" /> Import file…
                </Button>
                <Button className="btn-fire" onClick={() => void startDownload()}>
                  <Download className="h-4 w-4 mr-1" /> Download
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={() => void requireApi().cancelSeparationModelDownload()}>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Cancel
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default IsolateControl;
