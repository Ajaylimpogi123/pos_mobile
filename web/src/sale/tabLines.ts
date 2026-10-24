/**
 * Dine-in (v1.26): the web cart's lines ↔ the shared tab rules in
 * `@pos/core/sale/tab`. A settlement is a cart whose lines are tab items: the
 * product snapshot is the item's (name, price, VAT flag), `tabItemId` is the
 * `items[].tab_item_id`, and `maxQty` is its `remaining_qty`.
 */
import type { TabSettleLine } from '@pos/core/sale/tab';
import type { TabItem } from '@/services/types';
import type { CartLine } from '@/stores/cart';

/** A tab item as a settlement cart line, paying `qty` of it. */
export function settlementLine(item: TabItem, qty: number): CartLine {
  return {
    key: `tab-item-${item.id}`,
    product: {
      id: item.product_id,
      category_id: item.category_id,
      name: item.product_name,
      sku: null,
      price_cents: item.unit_price_cents,
      is_vatable: item.is_vatable,
      // The snapshot is the price; the food was served (no menu or stock checks at settlement).
      is_available: true,
      track_stock: false,
      image_url: null,
      image_path: null,
    },
    qty,
    discount: null,
    notes: item.notes,
    scPwd: false,
    tabItemId: item.id,
    maxQty: item.remaining_qty,
  };
}

/** The settlement cart's lines as the shared pricing and body builder read them. */
export function settleLinesOf(lines: readonly CartLine[]): TabSettleLine[] {
  return lines.map((line) => ({
    item: { id: line.tabItemId ?? 0, unit_price_cents: line.product.price_cents, is_vatable: line.product.is_vatable },
    qty: line.qty,
    discount: line.discount,
    scPwd: line.scPwd,
  }));
}
