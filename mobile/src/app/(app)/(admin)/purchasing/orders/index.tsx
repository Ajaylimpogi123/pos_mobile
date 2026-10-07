import { PurchaseOrderListScreen } from '@/components/purchasing/PurchaseOrderListScreen';

/** Purchase orders: GET /api/v1/purchase-orders (`?status=pending_approval` from the dashboard). */
export default function PurchaseOrdersIndexRoute() {
  return <PurchaseOrderListScreen mode="orders" />;
}
