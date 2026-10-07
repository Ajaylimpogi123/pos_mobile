import { CustomerListScreen } from '@/components/customers/CustomerListScreen';

/** Customers: GET /api/v1/customers (search on names, phone and email). */
export default function CustomersIndexRoute() {
  return <CustomerListScreen />;
}
