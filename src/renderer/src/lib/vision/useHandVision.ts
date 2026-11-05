import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { requireApi } from '@/lib/api';
import { isVideoFile } from '@/lib/format';
import { projectMediaUrl, type HandVision, type Project } from '../../../../shared/ipc';
import { watchHand } from './handVision';

export type HandVisionState =
  | { state: 'none' } // no video to watch
  | { state: 'watching'; progress: number }
  | { state: 'failed' }
  | { state: 'done'; vision: HandVision };

/**
 * The fretting hand seen in a project's video: watched once, in the background, the first time the
 * project is opened, then kept with the project.
 */
export function useHandVision(project: Project): HandVisionState {
  const queryClient = useQueryClient();
  const video = project.sourceAvailable && isVideoFile(project.sourceName);
  const [state, setState] = useState<HandVisionState>(() =>
    project.vision ? { state: 'done', vision: project.vision } : video ? { state: 'watching', progress: 0 } : { state: 'none' },
  );

  useEffect(() => {
    if (project.vision || !video) return;
    const controller = new AbortController();
    watchHand(projectMediaUrl(project.id), { signal: controller.signal, onProgress: (progress) => setState({ state: 'watching', progress }) })
      .then(async (vision) => {
        setState({ state: 'done', vision });
        await requireApi().saveProjectVision(project.id, vision);
        queryClient.setQueryData<Project>(['project', project.id], (old) => (old ? { ...old, vision } : old));
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('Watching the hand failed', error);
          setState({ state: 'failed' });
        }
      });
    return () => controller.abort();
  }, [project.id, project.vision, video, queryClient]);

  return state;
}
