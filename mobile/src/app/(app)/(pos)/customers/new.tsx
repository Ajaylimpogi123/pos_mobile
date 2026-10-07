import { CustomerFormScreen } from '@/components/customers/CustomerFormScreen';

/** New customer: POST /api/v1/customers (needs `sale.create`). */
export default function NewCustomerRoute() {
  return <CustomerFormScreen />;
}
