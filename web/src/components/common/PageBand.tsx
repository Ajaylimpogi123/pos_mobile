/**
 * The MASTER §2.3 header band: a decorative gradient (`aria-hidden`) behind
 * the top of a page, with the page title and subtitle in white over its dark
 * left side (≥ 14 px / 600), and the page actions on the right on white controls.
 * Content cards overlap it.
 *
 * MASTER §6 Band: the subtitle is the branch and the business date (plus an
 * optional short `note`), and the text block is capped at half the band
 * width so the white text stays on the dark side.
 */
import type { ReactNode } from 'react';

import { useBranchDay } from '@/hooks/useBranchDay';
import { formatBusinessDate } from '@/utils/dates';

type PageBandProps = {
  title: string;
  /** The business day to show (`YYYY-MM-DD`), e.g. the one the server reported; defaults to the branch's today. */
  businessDate?: string | null;
  /** A short extra after the branch and date ("Terminal T01", "12 tracked products"). */
  note?: string | null;
  actions?: ReactNode;
  children: ReactNode;
};

export function PageBand({ title, businessDate, note, actions, children }: PageBandProps) {
  const { branchName, today } = useBranchDay();
  const day = businessDate ?? today;
  const subtitle = [branchName, day ? formatBusinessDate(day) : null, note].filter(Boolean).join(' · ');
  return (
    <div className="relative">
      <div aria-hidden="true" className="pos-band pointer-events-none absolute inset-x-0 top-0 h-[280px] rounded-md" />
      <div className="relative flex flex-col gap-5 p-4 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="max-w-[50%] min-w-0">
            <h1 className="text-[26px] leading-tight font-bold text-on-band">{title}</h1>
            {subtitle ? <p className="mt-1 text-sm font-semibold text-on-band">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

type PlainPageProps = {
  title: string;
  subtitle?: string | null;
  actions?: ReactNode;
  children: ReactNode;
};

/** A form or detail page: no band, a white card at most 720 px wide (back-office.md → Forms). */
export function PlainPage({ title, subtitle, actions, children }: PlainPageProps) {
  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] leading-tight font-bold">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}
