/**
 * Cart shapes shared by the tablet and the web POS. The cart itself is client
 * state (PROJECT_MEMORY §11 #5); these types are what the sale rules read.
 */
import type { SaleDiscount } from '../contract/types';

/** What the cart keeps of a product: a snapshot of its on-device menu row. */
export type CartProduct = {
  id: number;
  category_id: number;
  name: string;
  sku: string | null;
  /** VAT-inclusive, integer centavos. */
  price_cents: number;
  is_vatable: boolean;
  is_available: boolean;
  track_stock: boolean;
};

export type CartLine = {
  /** Local id of the line (the same product may be on several lines). */
  key: string;
  product: CartProduct;
  qty: number;
  discount: SaleDiscount | null;
  notes: string | null;
  /** SC/PWD `items` mode: the SC/PWD consumes this line (always `false` otherwise). */
  scPwd: boolean;
};

export type CartCustomer = {
  id: number;
  full_name: string;
};

/** A rejected sale's messages, by the index of the line in the request. */
export type ServerCartErrors = {
  lines: Record<number, string>;
  orderDiscount: string | null;
  customer: string | null;
  /** A `422` on `table_no` (Table Number, Core Sale revision 2). */
  table?: string | null;
  /** `422`s on `sc_pwd` and its fields, by the path after `sc_pwd.` (`''` for `sc_pwd` itself), e.g. `persons.0.id_no`. */
  scPwd?: Record<string, string>;
  /** A message about the whole cart, e.g. "This sale is too large." */
  cart: string | null;
};
