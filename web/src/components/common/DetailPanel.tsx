/**
 * A read-mostly detail (MASTER §6 Detail views; back-office.md → List pages §4):
 * a right **sheet** at ≥ 1280 px (`mode="sheet"`), or a **full page** below
 * that (`mode="page"`, with a Back button), from `useDetailMode()`.
 *
 * In page mode the list page hides its own content while the detail is open
 * (it stays mounted, so the filters and the loaded rows are kept).
 */
import { ArrowLeftIcon } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';

type DetailPanelProps = {
  mode: 'sheet' | 'page';
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** The sheet's width class (e.g. `sm:max-w-xl`). */
  sheetClassName?: string;
  /** The Back button's label in page mode ("Back to orders"). */
  backLabel?: string;
  children: ReactNode;
};

export function DetailPanel({ mode, open, onClose, title, description, sheetClassName, backLabel = 'Back', children }: DetailPanelProps) {
  if (mode === 'sheet') {
    return (
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <SheetContent className={sheetClassName}>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto p-5">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }
  if (!open) return null;
  return (
    <DetailPage onClose={onClose} title={title} description={description} backLabel={backLabel}>
      {children}
    </DetailPage>
  );
}

function DetailPage({
  onClose,
  title,
  description,
  backLabel,
  children,
}: {
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  backLabel: string;
  children: ReactNode;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  // A new page: focus its heading, and Esc goes back (like closing the sheet).
  useEffect(() => {
    headingRef.current?.focus();
    window.scrollTo({ top: 0 });
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) return;
      closeRef.current();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-start gap-3">
        <Button variant="outline" onClick={onClose}>
          <ArrowLeftIcon aria-hidden="true" />
          {backLabel}
        </Button>
        <div className="min-w-0 flex-1">
          <h1 ref={headingRef} tabIndex={-1} className="flex items-center gap-2 text-[22px] leading-tight font-bold">
            {title}
          </h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      <Card className="mx-auto w-full max-w-3xl p-5">{children}</Card>
    </div>
  );
}
