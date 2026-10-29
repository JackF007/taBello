import type { ReactNode } from 'react';
import { AudioWaveform, Brain, Layers, Music, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useSeparationModel } from '@/lib/separationModel';

const megabytes = (bytes: number) => `${Math.round(bytes / 1e6)} MB`;

const Model = ({ icon, title, by, children }: { icon: ReactNode; title: string; by: string; children: ReactNode }) => (
  <section className="flex gap-3">
    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-gh-yellow">{icon}</span>
    <div className="space-y-1 text-sm">
      <h3 className="font-semibold">
        {title} <span className="font-normal text-muted-foreground">· {by}</span>
      </h3>
      {children}
    </div>
  </section>
);

/** What artificial intelligence TaBello uses, for what, and where it runs: plainly, for everyone. */
const AboutAi = ({ className }: { className?: string }) => {
  const { data: model } = useSeparationModel();
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className={className}>
          <Brain className="h-4 w-4 mr-1 text-gh-yellow" /> How TaBello listens
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>How TaBello listens</DialogTitle>
          <DialogDescription>
            Two AI models, both running on your computer. Your recordings are never uploaded, and nothing learns from them.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Model icon={<AudioWaveform className="h-4 w-4" />} title="Basic Pitch" by="Spotify, Apache-2.0">
            <p className="text-muted-foreground">
              Hears which notes are played and when, in every transcription. It is part of TaBello (under 1 MB) and always there.
            </p>
          </Model>
          <Model icon={<Layers className="h-4 w-4" />} title="Demucs, the separation model" by="Meta">
            <p className="text-muted-foreground">
              Splits a band recording into drums, bass, vocals and the rest, so <em>Isolate</em> can give the bass, or the guitars,
              alone. Used only with <em>Isolate</em>. Its weights are for personal and research use, so TaBello downloads them once
              by itself ({model ? megabytes(model.downloadBytes) : '…'}, {model ? megabytes(model.sizeBytes) : '…'} on disk)
              instead of shipping them.
            </p>
            <p className="text-muted-foreground">
              {model?.installed
                ? 'Installed. Removing it frees the space; Isolate then asks to download it again.'
                : 'Not installed: turning Isolate on offers to download it.'}
            </p>
          </Model>
          <Model icon={<Music className="h-4 w-4" />} title="The music, without AI" by="TaBello">
            <p className="text-muted-foreground">
              Tempo, bars, key, chords, tuning, capo and where each note goes on the neck are worked out by TaBello's own rules,
              the way a musician would. Every choice can be changed on the project page.
            </p>
          </Model>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-gh-green" /> Works offline: the only downloads are this model and, if you allow it,
            a check for new versions.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AboutAi;
