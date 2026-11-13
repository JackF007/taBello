import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { requireApi } from '@/lib/api';
import { isVideoFile } from '@/lib/format';
import { projectMediaUrl, type HandVision, type Project } from '../../../../shared/ipc';
import { watchHand } from './handVision';

export type HandVisionState =
  | { state: 'none' } // no video to watch, or it could not be watched: the tab comes from the sound
  | { state: 'watching'; progress: number }
  | { state: 'done'; vision: HandVision };

/**
 * The fretting hand seen in a project's video: watched once, in the background, the first time the
 * project is opened, then kept with the project. It is only a help: where the hand is not seen, or
 * the video cannot be watched at all, the notes are placed from the sound alone, without a warning.
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
          // Not kept: the next time the project opens, the video is watched again.
          console.warn('The hand could not be watched in the video', error);
          setState({ state: 'none' });
        }
      });
    return () => controller.abort();
  }, [project.id, project.vision, video, queryClient]);

  return state;
}
