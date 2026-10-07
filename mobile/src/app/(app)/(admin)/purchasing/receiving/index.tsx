import { PurchaseOrderListScreen } from '@/components/purchasing/PurchaseOrderListScreen';

/** Receiving: GET /api/v1/purchase-orders?to_receive=1. */
export default function ReceivingIndexRoute() {
  return <PurchaseOrderListScreen mode="receiving" />;
}
