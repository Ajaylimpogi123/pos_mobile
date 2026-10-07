import { CheckoutScreen } from '@/components/checkout/CheckoutScreen';

/** Checkout: POST /api/v1/orders with the cart's pending ULID (needs `sale.create`; gated in `(pos)/_layout.tsx`). */
export default function CheckoutRoute() {
  return <CheckoutScreen />;
}
