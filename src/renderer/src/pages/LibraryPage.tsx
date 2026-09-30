import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, FileMusic, Loader2, Plus, Trash2 } from 'lucide-react';
import InstrumentIcon from '@/components/InstrumentIcon';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { requireApi } from '@/lib/api';
import { formatDate, formatDuration } from '@/lib/format';
import type { ProjectSummary } from '../../../shared/ipc';
import { INSTRUMENTS } from '../../../shared/instruments';

const ProjectCard = ({ project, index, onDelete }: { project: ProjectSummary; index: number; onDelete: () => void }) => {
  const instrument = INSTRUMENTS[project.settings.instrument];
  return (
    <div
      className="group relative overflow-hidden rounded-2xl border bg-card/80 p-5 pl-6 transition-all duration-200 hover:-translate-y-1 hover:border-[color:var(--instrument)] hover:shadow-[0_12px_40px_-12px_var(--instrument)] animate-rise-in"
      style={{ '--instrument': instrument.color, animationDelay: `${index * 60}ms` } as CSSProperties}
    >
      <span className="absolute inset-y-0 left-0 w-1.5 bg-[color:var(--instrument)]" aria-hidden="true" />
      <Link to={`/project/${project.id}`} className="block after:absolute after:inset-0" aria-label={`Open ${project.title}`}>
        <div className="flex items-center gap-3 mb-2 pr-8">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--instrument)_18%,transparent)] text-[color:var(--instrument)]">
            <InstrumentIcon instrument={instrument.id} className="h-5 w-5" />
          </span>
          <h2 className="font-display text-lg truncate">{project.title}</h2>
        </div>
      </Link>
      <p className="text-sm text-muted-foreground truncate">{project.sourceName}</p>
      <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="px-2 py-0.5 rounded-full font-medium text-black bg-[color:var(--instrument)]">{instrument.name}</span>
        <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatDuration(project.durationSeconds)}</span>
        <span>{project.noteCount} notes</span>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{formatDate(project.createdAt)}</p>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="ghost" size="icon" className="absolute right-2 top-2 z-10 rounded-full opacity-50 hover:opacity-100 hover:text-gh-red" aria-label={`Delete ${project.title}`}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{project.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The transcription is removed from your library. Your original file ({project.sourceName}) is not touched.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const LibraryPage = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: projects, isLoading } = useQuery({ queryKey: ['projects'], queryFn: () => requireApi().listProjects() });

  const deleteProject = async (project: ProjectSummary) => {
    const result = await requireApi().deleteProject(project.id);
    if (!result.ok) toast({ title: 'Could not delete', description: result.error.message, variant: 'destructive' });
    await queryClient.invalidateQueries({ queryKey: ['projects'] });
    queryClient.removeQueries({ queryKey: ['project', project.id] });
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl">Library</h1>
          <p className="text-sm text-muted-foreground">Your transcriptions, stored on this computer.</p>
        </div>
        <Button asChild className="btn-fire h-11 rounded-full px-6">
          <Link to="/"><Plus className="h-4 w-4 mr-1" /> New transcription</Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Loading…
        </div>
      ) : projects && projects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project, index) => (
            <ProjectCard key={project.id} project={project} index={index} onDelete={() => void deleteProject(project)} />
          ))}
        </div>
      ) : (
        <div className="panel border-dashed p-12 text-center">
          <FileMusic className="h-10 w-10 mx-auto mb-3 text-gh-orange" />
          <p className="font-medium">No transcriptions yet</p>
          <p className="text-sm text-muted-foreground mb-5">Open an audio or video file to create your first one.</p>
          <Button asChild className="btn-fire rounded-full px-6"><Link to="/">Transcribe a file</Link></Button>
        </div>
      )}
    </div>
  );
};

export default LibraryPage;
