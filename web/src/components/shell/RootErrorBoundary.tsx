/**
 * The root React error boundary (Hardening & Pilot §I): a render crash shows a
 * friendly "Something went wrong" page with **Reload**, and the error is queued
 * (`fatal`) for the error log; it is sent on the next flush.
 */
import { CircleAlertIcon, RotateCwIcon } from 'lucide-react';
import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { captureError, describeThrown } from '@/diagnostics/errorQueue';

type Props = { children: ReactNode };
type State = { failed: boolean };

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    const { message, stack } = describeThrown(error);
    captureError({
      level: 'fatal',
      message,
      stack,
      extra: { handler: 'error_boundary', component_stack: (info.componentStack ?? '').trim().slice(0, 500) },
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background p-6">
        <div role="alert" className="flex max-w-md flex-col items-center gap-3 rounded-xl border border-border bg-card p-8 text-center shadow-card">
          <CircleAlertIcon className="size-10 text-danger" aria-hidden="true" />
          <h1 className="text-xl font-bold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            The page hit an unexpected problem. The error was saved for the manager. Reload the page to carry on.
          </p>
          <Button variant="green" size="lg" onClick={() => window.location.reload()} autoFocus>
            <RotateCwIcon aria-hidden="true" />
            Reload
          </Button>
        </div>
      </main>
    );
  }
}
