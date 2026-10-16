import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { requireApi, tabello } from '@/lib/api';

/**
 * The source-separation model's status (shared by the switch and the samples), kept up to date while
 * TaBello downloads it in the background.
 */
export const useSeparationModel = () => {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      tabello?.onSeparationModelChange((status) => {
        queryClient.setQueryData(['separation-model'], status);
      }),
    [queryClient],
  );
  return useQuery({ queryKey: ['separation-model'], queryFn: () => requireApi().getSeparationModel(), enabled: tabello !== undefined });
};
