import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { requireApi } from '@/lib/api';
import { ISOLATE_STAGES, overallPercent, STAGES } from '@/lib/progress';
import type { Project, TranscriptionProgress } from '../../../shared/ipc';
import { INSTRUMENTS, type InstrumentId } from '../../../shared/instruments';

interface SwitchPartDialogProps {
  project: Pick<Project, 'id' | 'isolated'>;
  from: InstrumentId;
  /** The instrument chosen, of another part; null when closed. */
  to: InstrumentId | null;
  onClose: () => void;
}

/**
 * Switching to an instrument that plays another part (the bass of a guitar tab) cannot reuse the
 * notes: TaBello listens to the recording again for that part and opens it as a new project.
 */
const SwitchPartDialog = ({ project, from, to, onClose }: SwitchPartDialogProps) => {
  const [progress, setProgress] = useState<TranscriptionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const running = progress !== null;

  useEffect(() => {
    if (!to) return;
    setError(null);
    return requireApi().onTranscriptionProgress(setProgress);
  }, [to]);

  if (!to) return null;
  const target = INSTRUMENTS[to].name.toLowerCase();
  const current = INSTRUMENTS[from].name.toLowerCase();
  const stages = project.isolated ? ISOLATE_STAGES : STAGES;

  const start = async () => {
    setError(null);
    setProgress({ stage: 'starting', fraction: 0 });
    try {
      const result = await requireApi().transcribeProjectAgain(project.id, to);
      if (result.ok) {
        await queryClient.invalidateQueries({ queryKey: ['projects'] });
        onClose();
        navigate(`/project/${result.value.id}`);
      } else if (result.error.code !== 'cancelled') {
        setError(result.error.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !running && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Transcribe the {target}?</DialogTitle>
          <DialogDescription>
            The {target} plays another part than the {current}, so its notes cannot be rewritten from this tab. TaBello listens to
            the recording again for the {target}
            {project.isolated ? ', isolating it from the band as before,' : ''} and opens it as a new project. This {current} tab
            stays in your Library.
          </DialogDescription>
        </DialogHeader>
        {running && (
          <div className="space-y-2" role="status">
            <Progress value={overallPercent(stages, progress)} className="h-2" />
            <p className="text-sm text-muted-foreground">{stages.find((s) => s.stage === progress.stage)?.label}…</p>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          {running ? (
            <Button variant="outline" onClick={() => void requireApi().cancelTranscription()}>
              Stop
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                Keep the {current}
              </Button>
              <Button onClick={() => void start()}>
                Transcribe the {target}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default SwitchPartDialog;
