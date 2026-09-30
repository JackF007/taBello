import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Clock, FileMusic, Loader2, Plus, Trash2 } from 'lucide-react';
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

const ProjectCard = ({ project, onDelete }: { project: ProjectSummary; onDelete: () => void }) => (
  <div className="group relative rounded-xl border bg-card p-5 shadow-sm transition-shadow hover:shadow-md">
    <Link to={`/project/${project.id}`} className="block after:absolute after:inset-0" aria-label={`Open ${project.title}`}>
      <div className="flex items-center gap-2 mb-2">
        <FileMusic className="h-5 w-5 text-tabello-600 shrink-0" />
        <h2 className="font-semibold truncate">{project.title}</h2>
      </div>
    </Link>
    <p className="text-sm text-muted-foreground truncate">{project.sourceName}</p>
    <div className="mt-4 flex items-center gap-3 text-xs text-muted-foreground">
      <span className="px-2 py-0.5 rounded-full bg-tabello-100 text-tabello-800">{INSTRUMENTS[project.settings.instrument].name}</span>
      <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatDuration(project.durationSeconds)}</span>
      <span>{project.noteCount} notes</span>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">{formatDate(project.createdAt)}</p>

    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="icon" className="absolute right-2 top-2 z-10 opacity-60 hover:opacity-100" aria-label={`Delete ${project.title}`}>
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
          <h1 className="text-2xl font-bold">Library</h1>
          <p className="text-sm text-muted-foreground">Your transcriptions, stored on this computer.</p>
        </div>
        <Button asChild>
          <Link to="/"><Plus className="h-4 w-4 mr-1" /> New transcription</Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Loading…
        </div>
      ) : projects && projects.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} onDelete={() => void deleteProject(project)} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-12 text-center">
          <FileMusic className="h-10 w-10 mx-auto mb-3 text-tabello-400" />
          <p className="font-medium">No transcriptions yet</p>
          <p className="text-sm text-muted-foreground mb-5">Open an audio or video file to create your first one.</p>
          <Button asChild><Link to="/">Transcribe a file</Link></Button>
        </div>
      )}
    </div>
  );
};

export default LibraryPage;
