import { OrderListScreen } from '@/components/orders/OrderListScreen';

/** Orders: GET /api/v1/orders (today's business date by default, date stepping, invoice search). */
export default function OrdersIndexRoute() {
  return <OrderListScreen />;
}
