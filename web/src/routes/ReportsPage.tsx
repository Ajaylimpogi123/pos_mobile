/**
 * Reports: Sales and Inventory (`report.view`), Purchasing (`report.view` or
 * `purchase.approve`, §I). Only the reports the user may open are offered;
 * `?view=sales|inventory|purchasing` picks one (and links to it). One date
 * range is shared by every report, each keeps its own filters, and only the
 * shown report loads. **Export CSV** downloads the shown report's query.
 */
import { DownloadIcon, LoaderCircleIcon } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';

import { EmptyState } from '@/components/common/ListStates';
import { PageBand } from '@/components/common/PageBand';
import { InventoryReportView } from '@/components/reports/InventoryReportView';
import { ReportRangeBar } from '@/components/reports/ReportParts';
import { PurchasingReportView } from '@/components/reports/PurchasingReportView';
import { SalesReportView } from '@/components/reports/SalesReportView';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useReportRange } from '@/hooks/reports/useReportRange';
import { useIngredientReport, useInventoryReport, usePurchasingReport, useSalesReport } from '@/hooks/reports/useReports';
import type { InventoryReportKind } from '@/services/types';
import { useSessionStore } from '@/stores/session';
import { hasAnyPermission, hasPermission, PERMISSIONS } from '@/utils/permissions';

type ReportView = 'sales' | 'inventory' | 'purchasing';

const VIEWS: readonly { value: ReportView; label: string }[] = [
  { value: 'sales', label: 'Sales' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'purchasing', label: 'Purchasing' },
];

export function ReportsPage() {
  useShellHeader('Reports');
  const [params, setParams] = useSearchParams();
  const canViewReports = useSessionStore((state) => hasPermission(state.user, PERMISSIONS.reportView));
  const canViewPurchasing = useSessionStore((state) => hasAnyPermission(state.user, [PERMISSIONS.reportView, PERMISSIONS.purchaseApprove]));
  const views = VIEWS.filter((view) => (view.value === 'purchasing' ? canViewPurchasing : canViewReports));
  const requested = params.get('view');
  const view = views.find((option) => option.value === requested) ?? views[0];
  const [inventoryKind, setInventoryKind] = useState<InventoryReportKind>(params.get('kind') === 'ingredients' ? 'ingredients' : 'products');

  const range = useReportRange();
  const sales = useSalesReport(range, view?.value === 'sales');
  const products = useInventoryReport(range, view?.value === 'inventory' && inventoryKind === 'products');
  const ingredients = useIngredientReport(range, view?.value === 'inventory' && inventoryKind === 'ingredients');
  const purchasing = usePurchasingReport(range, view?.value === 'purchasing');

  if (!view) {
    return <EmptyState title="No reports for your role" message="Ask a manager if you need access to reports." />;
  }

  const current =
    view.value === 'sales' ? sales : view.value === 'purchasing' ? purchasing : inventoryKind === 'ingredients' ? ingredients : products;
  const canExport = current.query.data !== undefined && !current.query.isPending;

  function chooseView(next: string) {
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous);
        updated.set('view', next);
        return updated;
      },
      { replace: true },
    );
  }

  const exportButton = (
    <Button variant="outline" onClick={current.exportCsv} disabled={!canExport || current.exporting}>
      {current.exporting ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : <DownloadIcon aria-hidden="true" />}
      {current.exporting ? 'Exporting…' : 'Export CSV'}
    </Button>
  );

  return (
    <PageBand title="Reports" actions={exportButton}>
      <Card className="flex flex-col gap-4 p-4">
        {views.length > 1 ? (
          <Tabs value={view.value} onValueChange={chooseView}>
            <TabsList aria-label="Report">
              {views.map((option) => (
                <TabsTrigger key={option.value} value={option.value}>
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : null}
        <ReportRangeBar range={range}>
          {view.value === 'purchasing' ? <p className="pb-2 text-sm text-muted-foreground">By the date each request was created.</p> : null}
        </ReportRangeBar>
      </Card>
      {view.value === 'sales' ? <SalesReportView report={sales} /> : null}
      {view.value === 'inventory' ? (
        <InventoryReportView kind={inventoryKind} onKindChange={setInventoryKind} products={products} ingredients={ingredients} />
      ) : null}
      {view.value === 'purchasing' ? <PurchasingReportView report={purchasing} /> : null}
    </PageBand>
  );
}
