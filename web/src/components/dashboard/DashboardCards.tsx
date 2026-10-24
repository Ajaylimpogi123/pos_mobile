/**
 * The dashboard's non-chart cards (back-office.md → Dashboard): insights
 * with their action links, stock alerts, today's figures, and the short
 * lists (low-margin products, recent logins, recent changes). Real data
 * only; each card is rendered only when its section came back.
 */
import { ArrowRightIcon, CircleCheckIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { insightTarget, SEVERITY } from '@/components/dashboard/dashboardModel';
import { salesPeriod } from '@/components/dashboard/dashboardPeriod';
import { StatusBadge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type {
  AuthUser,
  DashboardLowMarginProduct,
  DashboardRecentChange,
  DashboardRecentLogin,
  DashboardSales,
  Insight,
} from '@/services/types';
import { formatBranchDateTime } from '@pos/core/businessDay';
import { formatPeso } from '@pos/core/money';
import { formatCount, formatPercentBps } from '@pos/core/numbers';

/** A titled white card (MASTER §3), labelled by its heading. */
export function SectionCard({ id, title, description, children, className }: { id: string; title: string; description?: string; children: ReactNode; className?: string }) {
  return (
    <Card role="region" aria-labelledby={id} className={cn('flex min-w-0 flex-col gap-3 p-5', className)}>
      <div>
        <h2 id={id} className="text-base font-semibold">
          {title}
        </h2>
        {description ? <p className="text-[13px] text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </Card>
  );
}

function linkClass() {
  return cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0');
}

/** Insights, as the server ordered them (critical → warning → info); each action opens its web page. */
export function InsightsCard({ insights, user, className }: { insights: readonly Insight[]; user: AuthUser | null; className?: string }) {
  return (
    <SectionCard id="dashboard-insights" title="Things to check" description="Built from the sections you can see." className={className}>
      {insights.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CircleCheckIcon className="size-4 text-success" aria-hidden="true" />
          Nothing needs your attention right now.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {insights.map((insight) => {
            const target = insightTarget(insight.action, user);
            const severity = SEVERITY[insight.severity] ?? SEVERITY.info;
            return (
              <li key={insight.key} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <StatusBadge tone={severity.tone} label={severity.label} className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{insight.title}</p>
                  <p className="text-[13px] text-muted-foreground">{insight.message}</p>
                </div>
                {target ? (
                  <Link to={target.to} className={linkClass()}>
                    {target.label}
                    <ArrowRightIcon aria-hidden="true" />
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

type StockAlertsProps = {
  products: { out: number; low: number };
  ingredients: { out: number; low: number };
  canOpenInventory: boolean;
};

/** Stock alerts from the `stock_*` and `ingredients_*` insights: Low and Out badges, and links to the lists. */
export function StockAlertsCard({ products, ingredients, canOpenInventory }: StockAlertsProps) {
  const rows = [
    { key: 'products', label: 'Products', counts: products, to: '/inventory?status=alerts' },
    { key: 'ingredients', label: 'Ingredients', counts: ingredients, to: '/inventory/ingredients?status=alerts' },
  ];
  return (
    <SectionCard id="dashboard-stock" title="Stock alerts" description="Current stock against reorder levels.">
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-wrap items-center gap-2">
            <span className="min-w-24 font-medium">{row.label}</span>
            <StatusBadge tone="danger" label={`Out ${formatCount(row.counts.out)}`} />
            <StatusBadge tone="warning" label={`Low ${formatCount(row.counts.low)}`} />
            {canOpenInventory && row.counts.out + row.counts.low > 0 ? (
              <Link to={row.to} className={cn(linkClass(), 'ml-auto')}>
                Open inventory
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

function FigureRow({ label, value, tone }: { label: string; value: string; tone?: 'danger' | 'strong' }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={cn('tabular', tone === 'danger' && 'text-danger', tone === 'strong' && 'text-base font-bold text-green')}>{value}</dd>
    </div>
  );
}

/** Today's figures as the server sent them: gross, discounts (SC/PWD), net, VAT, voids, refunds, net after refunds. */
export function TodayFiguresCard({ sales, className }: { sales: DashboardSales; className?: string }) {
  // v1.28: the figures cover the chosen period; the running day keeps its original wording.
  const period = salesPeriod(sales);
  const today = period.period === 'day' && period.current;
  return (
    <SectionCard
      id="dashboard-today"
      className={className}
      title={today ? "Today's figures" : 'Sales figures'}
      description={today ? 'Sales that are not voided, this business day.' : `${period.label}, sales that are not voided.`}
    >
      <dl className="flex flex-col divide-y divide-border">
        <FigureRow label="Gross sales" value={formatPeso(sales.gross_sales_cents)} />
        <FigureRow label="Discounts" value={formatPeso(sales.discounts_cents)} />
        <FigureRow label={`SC/PWD (${formatCount(sales.sc_pwd_orders_count)})`} value={formatPeso(sales.sc_pwd_discount_cents)} />
        {sales.sc_pwd_vat_relief_cents !== 0 ? <FigureRow label="VAT exempted (SC/PWD)" value={formatPeso(sales.sc_pwd_vat_relief_cents)} /> : null}
        {/* Dine-in §G: its own row (net sales already include it). */}
        <FigureRow label="Service charge" value={formatPeso(sales.service_charge_cents ?? 0)} />
        <FigureRow label="Net sales" value={formatPeso(sales.net_sales_cents)} />
        <FigureRow label="VAT (included)" value={formatPeso(sales.vat_amount_cents)} />
        <FigureRow label="Voided orders" value={formatCount(sales.voids_count)} />
        <FigureRow label="Refunds" value={formatPeso(sales.refunds_cents)} tone={sales.refunds_cents > 0 ? 'danger' : undefined} />
        <FigureRow label="Net after refunds" value={formatPeso(sales.net_after_refunds_cents)} tone="strong" />
      </dl>
    </SectionCard>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="py-4 text-center text-sm text-muted-foreground">{children}</p>;
}

/** Products under the margin target, lowest first (max 5). */
export function LowMarginCard({ products, thresholdBps }: { products: readonly DashboardLowMarginProduct[]; thresholdBps: number }) {
  return (
    <SectionCard id="dashboard-low-margin" title="Low-margin products" description={`Below the ${formatPercentBps(thresholdBps, 0)} target, lowest first.`}>
      {products.length === 0 ? (
        <EmptyNote>Every product with cost data meets the target.</EmptyNote>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {products.map((product) => (
            <li key={product.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{product.name}</p>
                <p className="text-[13px] text-muted-foreground tabular">
                  {product.category_name} · {formatPeso(product.price_cents)} price · {formatPeso(product.cost_cents)} cost
                </p>
              </div>
              <span className="font-semibold text-warning tabular">{formatPercentBps(product.margin_bps)}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/** The 5 latest logins of the branch's staff. */
export function RecentLoginsCard({ logins, timezone }: { logins: readonly DashboardRecentLogin[]; timezone: string }) {
  return (
    <SectionCard id="dashboard-logins" title="Recent logins">
      {logins.length === 0 ? (
        <EmptyNote>No one has logged in yet.</EmptyNote>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {logins.map((login) => (
            <li key={login.user_id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{login.name}</p>
                <p className="text-[13px] text-muted-foreground">{login.role_name}</p>
              </div>
              <span className="text-[13px] text-muted-foreground tabular">{formatBranchDateTime(login.last_login_at, timezone) ?? login.last_login_at}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/** The 8 latest changes (audit summaries written by the server). */
export function RecentChangesCard({ changes, timezone }: { changes: readonly DashboardRecentChange[]; timezone: string }) {
  return (
    <SectionCard id="dashboard-changes" title="Recent changes">
      {changes.length === 0 ? (
        <EmptyNote>No changes yet.</EmptyNote>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {changes.map((change) => (
            <li key={change.id} className="flex flex-col gap-0.5 py-2">
              <p className="font-medium">{change.summary}</p>
              <p className="text-[13px] text-muted-foreground tabular">
                {change.actor_name} · {formatBranchDateTime(change.created_at, timezone) ?? change.created_at}
              </p>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
