/**
 * Toaster (ported from the legacy `Components/ui/sonner.jsx`): bottom-right,
 * success / error / info / warning each with an icon plus text (MASTER §3), coloured
 * from the status tokens.
 */
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      icons={{
        success: <CircleCheckIcon className="size-4 text-success" aria-hidden="true" />,
        error: <CircleAlertIcon className="size-4 text-danger" aria-hidden="true" />,
        info: <InfoIcon className="size-4 text-info" aria-hidden="true" />,
        warning: <TriangleAlertIcon className="size-4 text-warning" aria-hidden="true" />,
      }}
      toastOptions={{
        classNames: {
          toast: 'rounded-xl border border-border bg-card text-foreground shadow-tile font-sans',
          description: 'text-muted-foreground',
          success: 'border-success-border',
          error: 'border-danger-border',
          info: 'border-info-border',
          warning: 'border-warning-border',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
