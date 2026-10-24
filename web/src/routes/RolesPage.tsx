/**
 * Roles (Auth & Access Control → Roles & permissions; `GET /admin/roles`,
 * `user.manage`): read-only, because roles are seeded. Each role shows whether
 * it opens the admin area, its discount limit, whether you may assign it, and
 * its permission slugs, with its plain-words description from `@pos/core/permissions` (the seeded wording).
 */
import { ShieldCheckIcon } from 'lucide-react';

import { ErrorState, EmptyState, LoadingRows } from '@/components/common/ListStates';
import { PageBand } from '@/components/common/PageBand';
import { SubNav } from '@/components/common/SubNav';
import { STAFF_NAV } from '@/components/staff/staffNav';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { useRoles } from '@/hooks/useStaff';
import { permissionDescription } from '@pos/core/permissions';

export function RolesPage() {
  useShellHeader('Roles');
  const roles = useRoles();

  return (
    <PageBand title="Roles">
      <Card className="overflow-hidden">
        <div className="border-b border-border p-4">
          <SubNav label="Staff and roles" links={STAFF_NAV} />
        </div>
        {roles.loading ? (
          <LoadingRows rows={3} label="Loading roles…" />
        ) : roles.error ? (
          <ErrorState title="Couldn't load the roles" message={roles.error} onRetry={roles.reload} />
        ) : roles.roles.length === 0 ? (
          <EmptyState title="No roles" message="The roles are seeded on the server. Ask the administrator to run the seeders." />
        ) : (
          <ul className="divide-y divide-border">
            {roles.roles.map((role) => (
              <li key={role.id} className="flex flex-col gap-3 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <ShieldCheckIcon className="size-5 text-green" aria-hidden="true" />
                  <h2 className="text-base font-semibold">{role.name}</h2>
                  <Badge tone="outline" className="tabular">
                    {role.slug}
                  </Badge>
                  {role.is_admin ? <Badge tone="neutral">Admin area</Badge> : null}
                  <Badge tone="neutral" className="tabular">
                    Discounts up to {role.max_discount_percent}%
                  </Badge>
                  {role.assignable ? <Badge tone="neutral">You can assign</Badge> : <Badge tone="outline">Above your role</Badge>}
                </div>
                <p className="text-[13px] text-muted-foreground">
                  {role.permissions.length} {role.permissions.length === 1 ? 'permission' : 'permissions'}
                </p>
                {role.permissions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No permissions.</p>
                ) : (
                  <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3" aria-label={`${role.name} permissions`}>
                    {role.permissions.map((slug) => {
                      const description = permissionDescription(slug);
                      return (
                        <li key={slug} className="flex flex-col">
                          <span className="font-mono text-[13px] font-medium">{slug}</span>
                          {description ? <span className="text-[13px] text-muted-foreground">{description}</span> : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </PageBand>
  );
}
