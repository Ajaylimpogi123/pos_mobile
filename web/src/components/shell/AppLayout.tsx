/**
 * The signed-in shell (MASTER §2.1, legacy `AuthenticatedLayout.jsx`): the
 * inset sidebar, then the inset panel with its 48 px header (sidebar toggle,
 * a vertical separator, the page title, and optional status text on the right).
 */
import { Outlet } from 'react-router';

import { Separator } from '@/components/ui/misc';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useTerminalHeartbeat } from '@/hooks/useTerminalHeartbeat';

import { AppSidebar } from './AppSidebar';
import { ShellHeaderProvider, useShellHeaderValue } from './ShellHeaderContext';

function SiteHeader() {
  const { title, status } = useShellHeaderValue();
  return (
    <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 rounded-t-xl border-b border-border bg-muted px-3 lg:px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mx-1 h-4" />
      <p className="min-w-0 flex-1 truncate text-base font-medium">{title}</p>
      {status ? <div className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground">{status}</div> : null}
    </header>
  );
}

export function AppLayout() {
  // Hardening & Pilot §I: the heartbeat runs while someone is signed in.
  useTerminalHeartbeat();
  return (
    <TooltipProvider>
      <ShellHeaderProvider>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset>
            <SiteHeader />
            <div className="flex min-w-0 flex-1 flex-col">
              <Outlet />
            </div>
          </SidebarInset>
        </SidebarProvider>
      </ShellHeaderProvider>
    </TooltipProvider>
  );
}
