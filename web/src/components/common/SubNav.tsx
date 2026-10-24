/** A sub-navigation between the pages of one module (the MASTER §3 tabs track, as links). */
import { NavLink } from 'react-router';

import { cn } from '@/lib/utils';

export type SubNavLink = { to: string; label: string; end?: boolean };

export function SubNav({ label, links }: { label: string; links: readonly SubNavLink[] }) {
  return (
    <nav aria-label={label} className="inline-flex h-11 w-fit max-w-full items-center gap-1 overflow-x-auto rounded-lg bg-track p-1">
      {links.map((link) => (
        <NavLink
          key={link.to}
          to={link.to}
          end={link.end ?? true}
          className={({ isActive }) =>
            cn(
              'inline-flex h-9 shrink-0 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap',
              isActive ? 'bg-card text-foreground shadow-card' : 'text-muted-foreground hover:text-foreground',
            )
          }
        >
          {link.label}
        </NavLink>
      ))}
    </nav>
  );
}
