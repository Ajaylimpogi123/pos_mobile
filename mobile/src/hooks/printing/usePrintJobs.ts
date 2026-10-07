import { useMemo } from 'react';

import { usePrintingStore, type PrintJobView } from '@/stores/printing';

/** The jobs with these ids, in that order (missing ones are skipped). They update as the queue runs. */
export function usePrintJobs(ids: readonly string[]): PrintJobView[] {
  const jobs = usePrintingStore((state) => state.jobs);
  return useMemo(() => ids.map((id) => jobs[id]).filter((job): job is PrintJobView => job !== undefined), [ids, jobs]);
}
