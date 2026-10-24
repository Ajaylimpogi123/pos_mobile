/**
 * Staff (Staff & Customers → Staff endpoints, `user.manage`): the branch's
 * staff, deactivated ones included. Status tabs (`is_active`), a role filter
 * (`role_id`), a name / email search, the table and the cursor "Load more".
 * A row opens the edit page. The row ⋯ menu deactivates or reactivates
 * (`PATCH is_active`) and deletes (confirmed), only for staff the caller may
 * manage (`can_manage`, a hint) and never for the caller's own account (the
 * server's self-protection 409s still show if they happen).
 */
import { EllipsisIcon, PencilIcon, PlusIcon, PowerIcon, PowerOffIcon, TrashIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { PageBand } from '@/components/common/PageBand';
import { SearchField } from '@/components/common/SearchField';
import { SubNav } from '@/components/common/SubNav';
import { STAFF_NAV } from '@/components/staff/staffNav';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DataTable, dataTableColumns, type DataTableColumn } from '@/components/ui/data-table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDebounced } from '@/hooks/useDebounced';
import { useDeleteStaff, useRoles, useStaffList, useUpdateStaff } from '@/hooks/useStaff';
import { getErrorMessage } from '@/services/api';
import type { StaffUser } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { formatBranchDateTime } from '@pos/core/businessDay';

type StatusTab = 'all' | 'active' | 'inactive';
const STATUS_FILTER: Record<StatusTab, boolean | null> = { all: null, active: true, inactive: false };

type PendingAction = { kind: 'deactivate' | 'reactivate' | 'delete'; staff: StaffUser };

const column = dataTableColumns<StaffUser>();

export function StaffPage() {
  useShellHeader('Staff');
  const navigate = useNavigate();
  const user = useSessionStore((state) => state.user);
  const timezone = user?.branch.timezone ?? 'Asia/Manila';
  const [tab, setTab] = useState<StatusTab>('all');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const roles = useRoles();
  const list = useStaffList(search, roleId, STATUS_FILTER[tab]);
  const update = useUpdateStaff();
  const deletion = useDeleteStaff();
  const [pending, setPending] = useState<PendingAction | null>(null);

  const columns = useMemo<DataTableColumn<StaffUser>[]>(
    () => [
      column.display({
        id: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">
              {row.original.name}
              {row.original.id === user?.id ? <span className="text-muted-foreground"> (you)</span> : null}
            </span>
            <span className="text-[13px] text-muted-foreground">{row.original.email}</span>
          </div>
        ),
      }),
      column.display({ id: 'role', header: 'Role', cell: ({ row }) => row.original.role.name }),
      column.display({
        id: 'pin',
        header: 'PIN',
        cell: ({ row }) => (row.original.has_pin ? <Badge tone="outline">Set</Badge> : <span className="text-muted-foreground">Not set</span>),
      }),
      column.display({
        id: 'last_login',
        header: 'Last login',
        cell: ({ row }) =>
          row.original.last_login_at ? (
            <span className="tabular">{formatBranchDateTime(row.original.last_login_at, timezone) ?? row.original.last_login_at}</span>
          ) : (
            <span className="text-muted-foreground">Never</span>
          ),
      }),
      column.display({
        id: 'status',
        header: 'Status',
        cell: ({ row }) =>
          row.original.is_active ? <StatusBadge tone="success" label="Active" /> : <StatusBadge tone="danger" label="Deactivated" />,
      }),
      column.display({
        id: 'actions',
        header: '',
        meta: { align: 'right', srLabel: 'Actions' },
        cell: ({ row }) => {
          const staff = row.original;
          const self = staff.id === user?.id;
          const canAct = staff.can_manage && !self;
          return (
            <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${staff.name}`}>
                    <EllipsisIcon aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => navigate(`/staff/${staff.id}`)}>
                    <PencilIcon aria-hidden="true" />
                    {staff.can_manage ? 'Edit' : 'View'}
                  </DropdownMenuItem>
                  {canAct ? (
                    <>
                      <DropdownMenuItem
                        onSelect={() => {
                          update.reset();
                          setPending({ kind: staff.is_active ? 'deactivate' : 'reactivate', staff });
                        }}
                      >
                        {staff.is_active ? <PowerOffIcon aria-hidden="true" /> : <PowerIcon aria-hidden="true" />}
                        {staff.is_active ? 'Deactivate' : 'Reactivate'}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => {
                          deletion.reset();
                          setPending({ kind: 'delete', staff });
                        }}
                      >
                        <TrashIcon aria-hidden="true" />
                        Delete
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      }),
    ],
    [deletion, navigate, timezone, update, user?.id],
  );

  const filtered = search !== '' || tab !== 'all' || roleId !== null;
  const actionError = pending?.kind === 'delete' ? deletion.error : update.error;

  function confirm() {
    if (!pending) return;
    const close = { onSuccess: () => setPending(null) };
    if (pending.kind === 'delete') deletion.mutate(pending.staff.id, close);
    else update.mutate({ id: pending.staff.id, body: { is_active: pending.kind === 'reactivate' } }, close);
  }

  return (
    <PageBand
      title="Staff"
      actions={
        <Button asChild variant="green" size="lg">
          <Link to="/staff/new">
            <PlusIcon aria-hidden="true" />
            Add staff
          </Link>
        </Button>
      }
    >
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border p-4">
          <SubNav label="Staff and roles" links={STAFF_NAV} />
          <div className="flex flex-wrap items-end gap-3">
            <Tabs value={tab} onValueChange={(value) => setTab(value as StatusTab)}>
              <TabsList aria-label="Status">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="inactive">Deactivated</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex w-full flex-col gap-1.5 sm:w-48">
              <Label htmlFor="staff-role">Role</Label>
              <NativeSelect
                id="staff-role"
                value={roleId === null ? '' : String(roleId)}
                onChange={(event) => setRoleId(event.target.value === '' ? null : Number(event.target.value))}
                disabled={roles.loading}
              >
                <option value="">All roles</option>
                {roles.roles.map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <SearchField id="staff-search" label="Search staff" value={term} onChange={setTerm} placeholder="Name or email" />
          </div>
        </div>
        {list.loading ? (
          <LoadingRows rows={5} label="Loading staff…" />
        ) : list.error ? (
          <ErrorState title="Couldn't load the staff" message={list.error} onRetry={list.retry} />
        ) : list.items.length === 0 ? (
          filtered ? (
            <EmptyState title="No matching staff" message="Try another name, email, role or status." />
          ) : (
            <EmptyState title="No staff yet" message="Add the cashiers and managers who use the POS." />
          )
        ) : (
          <>
            <DataTable
              label="Staff"
              columns={columns}
              data={list.items}
              getRowId={(staff) => String(staff.id)}
              onRowClick={(staff) => navigate(`/staff/${staff.id}`)}
              rowLabel={(staff) => `${staff.name}, ${staff.role.name}, ${staff.is_active ? 'active' : 'deactivated'}`}
            />
            <LoadMoreFooter
              shown={list.items.length}
              hasMore={list.hasMore}
              loading={list.loadingMore}
              onLoadMore={list.loadMore}
              error={list.loadMoreError}
              noun="staff"
            />
          </>
        )}
      </Card>

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title={pending?.kind === 'delete' ? 'Delete staff account' : pending?.kind === 'deactivate' ? 'Deactivate staff account' : 'Reactivate staff account'}
        description={
          pending?.kind === 'delete'
            ? `${pending.staff.name} can no longer log in, and the account is removed from this list. Past sales keep their name.`
            : pending?.kind === 'deactivate'
              ? `${pending.staff.name} is logged out everywhere and can't log in until reactivated.`
              : pending
                ? `${pending.staff.name} can log in again.`
                : ''
        }
        confirmLabel={pending?.kind === 'delete' ? 'Delete account' : pending?.kind === 'deactivate' ? 'Deactivate' : 'Reactivate'}
        pendingLabel="Saving…"
        pending={update.isPending || deletion.isPending}
        error={actionError ? getErrorMessage(actionError) : null}
        destructive={pending?.kind !== 'reactivate'}
        onConfirm={confirm}
      />
    </PageBand>
  );
}
