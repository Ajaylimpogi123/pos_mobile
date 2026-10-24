/**
 * Sidebar (a lean TSX port of the legacy shadcn `Components/ui/sidebar.jsx`),
 * the MASTER §2.1 **inset** variant:
 * - 256 px on the `sidebar` background, collapsible to a 56 px icon rail
 *   (Ctrl/Cmd + B, or the header toggle); the choice is kept in localStorage.
 * - Below 1024 px it becomes an off-canvas drawer.
 * - The content sits in the inset panel: 8 px margin, 12 px radius, `inset` background.
 */
import { PanelLeftIcon } from 'lucide-react';
import { Slot } from 'radix-ui';
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useMediaQuery } from '@/hooks/useMediaQuery';

const STORAGE_KEY = 'pos.sidebar_open';
const DRAWER_QUERY = '(max-width: 1023px)';

type SidebarContextValue = {
  /** Desktop: expanded (`true`) or the icon rail. */
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Below 1024 px: the drawer. */
  isDrawer: boolean;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  toggle: () => void;
};

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useSidebar(): SidebarContextValue {
  const context = React.useContext(SidebarContext);
  if (!context) throw new Error('useSidebar must be used within a SidebarProvider.');
  return context;
}

function readStoredOpen(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'false';
  } catch {
    return true;
  }
}

function SidebarProvider({ children, className }: { children: React.ReactNode; className?: string }) {
  const isDrawer = useMediaQuery(DRAWER_QUERY);
  const [open, setOpenState] = React.useState(readStoredOpen);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const setOpen = React.useCallback((value: boolean) => {
    setOpenState(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // Storage unavailable: the choice lasts for this page only.
    }
  }, []);

  const toggle = React.useCallback(() => {
    if (isDrawer) setDrawerOpen((current) => !current);
    else setOpen(!open);
  }, [isDrawer, open, setOpen]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'b' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  const value = React.useMemo(
    () => ({ open, setOpen, isDrawer, drawerOpen, setDrawerOpen, toggle }),
    [open, setOpen, isDrawer, drawerOpen, toggle],
  );

  return (
    <SidebarContext.Provider value={value}>
      <div data-slot="sidebar-wrapper" className={cn('flex min-h-dvh w-full bg-sidebar', className)}>
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

function Sidebar({ children, label }: { children: React.ReactNode; label: string }) {
  const { open, isDrawer, drawerOpen, setDrawerOpen } = useSidebar();

  if (isDrawer) {
    return (
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="left" className="w-64 bg-sidebar p-0">
          <SheetTitle className="sr-only">{label}</SheetTitle>
          <SheetDescription className="sr-only">Main navigation</SheetDescription>
          <nav aria-label={label} className="flex h-full flex-col" data-state="expanded">
            {children}
          </nav>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <nav
      aria-label={label}
      data-state={open ? 'expanded' : 'collapsed'}
      className={cn(
        'group/sidebar sticky top-0 flex h-dvh shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out',
        open ? 'w-64' : 'w-14',
      )}
    >
      {children}
    </nav>
  );
}

function SidebarInset({ className, ...props }: React.ComponentProps<'main'>) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn('relative m-2 flex min-w-0 flex-1 flex-col rounded-xl bg-muted shadow-inset', className)}
      {...props}
    />
  );
}

function SidebarTrigger({ className }: { className?: string }) {
  const { toggle, open, isDrawer, drawerOpen } = useSidebar();
  const expanded = isDrawer ? drawerOpen : open;
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('size-9', className)}
      onClick={toggle}
      aria-label={expanded ? 'Collapse the sidebar' : 'Expand the sidebar'}
      aria-expanded={expanded}
    >
      <PanelLeftIcon aria-hidden="true" />
    </Button>
  );
}

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-header" className={cn('flex flex-col gap-3 p-3', className)} {...props} />;
}

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-content" className={cn('flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2', className)} {...props} />;
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-footer" className={cn('flex flex-col gap-2 p-2', className)} {...props} />;
}

function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="sidebar-group" className={cn('flex flex-col gap-0.5 py-1', className)} {...props} />;
}

function SidebarGroupLabel({ className, ...props }: React.ComponentProps<'h2'>) {
  const { open, isDrawer } = useSidebar();
  if (!open && !isDrawer) return <div className="mx-2 my-2 h-px bg-border" aria-hidden="true" />;
  return <h2 className={cn('px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground', className)} {...props} />;
}

function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return <ul data-slot="sidebar-menu" className={cn('flex flex-col gap-0.5', className)} {...props} />;
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return <li data-slot="sidebar-menu-item" className={cn('relative', className)} {...props} />;
}

type SidebarMenuButtonProps = React.ComponentProps<'button'> & {
  asChild?: boolean;
  isActive?: boolean;
  /** Shown as a tooltip while collapsed to the icon rail. */
  tooltip?: string;
};

function SidebarMenuButton({ asChild = false, isActive = false, tooltip, className, ...props }: SidebarMenuButtonProps) {
  const { open, isDrawer } = useSidebar();
  const Comp = asChild ? Slot.Root : 'button';
  const button = (
    <Comp
      data-slot="sidebar-menu-button"
      data-active={isActive}
      className={cn(
        'flex h-9 w-full items-center gap-2 overflow-hidden rounded-lg px-2 text-left text-sm text-sidebar-foreground hover:bg-sidebar-accent aria-disabled:pointer-events-none aria-disabled:text-muted-foreground aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-semibold data-[active=true]:bg-sidebar-accent data-[active=true]:font-semibold [&>svg]:size-4 [&>svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
  if (!tooltip || open || isDrawer) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
};
