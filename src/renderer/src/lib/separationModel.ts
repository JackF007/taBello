import { useQuery } from '@tanstack/react-query';
import { requireApi, tabello } from '@/lib/api';

/** Whether the source-separation model is installed (shared by the switch and the samples). */
export const useSeparationModel = () =>
  useQuery({ queryKey: ['separation-model'], queryFn: () => requireApi().getSeparationModel(), enabled: tabello !== undefined });
