/**
 * Route guards. They read the same module list as the sidebar
 * (`@/constants/modules`): a signed-out visitor goes to `/login`; a module
 * the user can't use shows a "no permission" page (the server stays the authority).
 */
import { LoaderCircleIcon } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';

import { EmptyState, ErrorState } from '@/components/common/ListStates';
import { Button } from '@/components/ui/button';
import { moduleByKey, type ModuleKey } from '@/constants/modules';
import { useSessionBootstrap } from '@/hooks/useAuth';
import { canUseModule, firstReadyModule } from '@/hooks/useModules';
import { setNavigator } from '@/lib/navigation';
import { useSessionStore } from '@/stores/session';

/** Registers React Router's navigate for the API client's 401 handler. */
export function NavigationBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    setNavigator((to, options) => void navigate(to, options));
    return () => setNavigator(null);
  }, [navigate]);
  return null;
}

function FullScreenMessage({ children }: { children: ReactNode }) {
  return <div className="flex min-h-dvh items-center justify-center bg-background p-6">{children}</div>;
}

/** Restores the session on start-up (any route), then renders the app. */
export function SessionGate({ children }: { children: ReactNode }) {
  const status = useSessionStore((state) => state.status);
  const bootstrap = useSessionBootstrap();
  if (status !== 'restoring') return children;
  if (bootstrap.error) {
    return (
      <FullScreenMessage>
        <ErrorState title="Couldn't restore your session" message={bootstrap.error} onRetry={bootstrap.retry} />
      </FullScreenMessage>
    );
  }
  return (
    <FullScreenMessage>
      <p className="flex items-center gap-2 text-muted-foreground" aria-live="polite">
        <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
        Signing you in…
      </p>
    </FullScreenMessage>
  );
}

/** Signed-in routes: a signed-out visitor goes to login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useSessionStore((state) => state.status);
  const location = useLocation();
  if (status !== 'signedIn') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

/** A module page: shown only when the user holds one of its permissions. */
export function RequireModule({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const user = useSessionStore((state) => state.user);
  const navigate = useNavigate();
  if (canUseModule(user, moduleByKey(module))) return children;
  const home = firstReadyModule(user);
  return (
    <EmptyState
      title="You don't have permission to open this page"
      message="Ask a manager if you need access."
      action={
        home ? (
          <Button variant="outline" onClick={() => navigate(home.path)}>
            Go to {home.label}
          </Button>
        ) : null
      }
    />
  );
}

/** `/`: the first module this user can open. */
export function HomeRedirect() {
  const user = useSessionStore((state) => state.user);
  const home = firstReadyModule(user);
  if (!home) {
    return (
      <EmptyState
        title="Nothing to open yet"
        message="Your role has no modules in this version of the web POS. Ask a manager for access."
      />
    );
  }
  return <Navigate to={home.path} replace />;
}
