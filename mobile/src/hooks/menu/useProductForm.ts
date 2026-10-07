import {
  nullIfBlank,
  parseSortOrder,
  SORT_ORDER_MESSAGE,
  type FieldErrors,
} from '@/hooks/menu/formErrors';
import { useCatalogForm } from '@/hooks/menu/useCatalogForm';
import { useProductMutations } from '@/hooks/menu/useCatalogMutations';
import type { AdminProduct, ProductCreateRequest, ProductUpdateRequest, StockMode } from '@/services/types';
import { centsToInputText, formatPeso, parsePesoInput } from '@/utils/money';
import { stockModeOf } from '@/utils/recipe';

/** Request fields of POST/PATCH /api/v1/admin/products that have an input. */
export type ProductField =
  | 'category_id'
  | 'name'
  | 'sku'
  | 'description'
  | 'price_cents'
  | 'cost_cents'
  | 'is_vatable'
  | 'is_available'
  | 'stock_mode'
  | 'sort_order';

export const PRODUCT_FIELDS: readonly ProductField[] = [
  'category_id',
  'name',
  'sku',
  'description',
  'price_cents',
  'cost_cents',
  'is_vatable',
  'is_available',
  'stock_mode',
  'sort_order',
];

/** What the inputs hold. Money stays as text until submit, then becomes integer centavos. */
export type ProductFormValues = {
  categoryId: number | null;
  /** Shown on the picker field; not sent. */
  categoryName: string;
  name: string;
  sku: string;
  description: string;
  price: string;
  cost: string;
  isVatable: boolean;
  isAvailable: boolean;
  /** §J: own stock, recipe, or not tracked. */
  stockMode: StockMode;
  sortOrder: string;
};

const FIELD_OF: { [K in keyof ProductFormValues]: ProductField } = {
  categoryId: 'category_id',
  categoryName: 'category_id',
  name: 'name',
  sku: 'sku',
  description: 'description',
  price: 'price_cents',
  cost: 'cost_cents',
  isVatable: 'is_vatable',
  isAvailable: 'is_available',
  stockMode: 'stock_mode',
  sortOrder: 'sort_order',
};

/** Contract limits. */
export const PRODUCT_LIMITS = { name: 120, sku: 50, description: 500, moneyMaxCents: 100_000_000 } as const;

/** Laravel `alpha_dash`: letters, numbers, dashes and underscores (Unicode letters included). */
const ALPHA_DASH = /^[\p{L}\p{M}\p{N}_-]+$/u;

const MONEY_FORMAT_MESSAGE = 'Enter an amount like 50, 50.50 or 1,250.50.';

export function productToValues(product?: AdminProduct): ProductFormValues {
  return {
    categoryId: product?.category.id ?? null,
    categoryName: product?.category.name ?? '',
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    description: product?.description ?? '',
    price: product ? centsToInputText(product.price_cents) : '',
    cost: product ? centsToInputText(product.cost_cents) : '',
    isVatable: product?.is_vatable ?? true,
    isAvailable: product?.is_available ?? true,
    stockMode: product ? stockModeOf(product) : 'none',
    sortOrder: String(product?.sort_order ?? 0),
  };
}

function parseMoney(text: string, label: string, required: boolean): { cents: number | null; error?: string } {
  if (text.trim() === '') return required ? { cents: null, error: `Enter the ${label}.` } : { cents: 0 };
  const cents = parsePesoInput(text);
  if (cents === null) return { cents: null, error: MONEY_FORMAT_MESSAGE };
  if (cents > PRODUCT_LIMITS.moneyMaxCents) {
    return { cents: null, error: `The ${label} can't be more than ${formatPeso(PRODUCT_LIMITS.moneyMaxCents)}.` };
  }
  return { cents };
}

/** Client-side checks mirroring the contract's rules, then the POST body (money as integer centavos). */
export function validateProduct(values: ProductFormValues): {
  body: ProductCreateRequest | null;
  errors: FieldErrors<ProductField>;
} {
  const errors: FieldErrors<ProductField> = {};
  const name = values.name.trim();
  const sku = nullIfBlank(values.sku);
  const description = nullIfBlank(values.description);

  if (name === '') errors.name = 'Enter a name.';
  else if (name.length > PRODUCT_LIMITS.name) errors.name = `Use ${PRODUCT_LIMITS.name} characters or fewer.`;

  if (values.categoryId === null) errors.category_id = 'Choose a category.';

  if (sku !== null && sku.length > PRODUCT_LIMITS.sku) errors.sku = `Use ${PRODUCT_LIMITS.sku} characters or fewer.`;
  else if (sku !== null && !ALPHA_DASH.test(sku)) errors.sku = 'Use only letters, numbers, dashes and underscores.';

  if (description !== null && description.length > PRODUCT_LIMITS.description) {
    errors.description = `Use ${PRODUCT_LIMITS.description} characters or fewer.`;
  }

  const price = parseMoney(values.price, 'price', true);
  if (price.error) errors.price_cents = price.error;
  const cost = parseMoney(values.cost, 'cost', false);
  if (cost.error) errors.cost_cents = cost.error;

  const sortOrder = parseSortOrder(values.sortOrder);
  if (sortOrder === null) errors.sort_order = SORT_ORDER_MESSAGE;

  if (Object.keys(errors).length > 0 || values.categoryId === null || price.cents === null || cost.cents === null || sortOrder === null) {
    return { body: null, errors };
  }

  return {
    body: {
      category_id: values.categoryId,
      name,
      sku,
      description,
      price_cents: price.cents,
      cost_cents: cost.cents,
      is_vatable: values.isVatable,
      is_available: values.isAvailable,
      stock_mode: values.stockMode,
      sort_order: sortOrder,
    },
    errors,
  };
}

/** Only the fields that differ from the saved product (PATCH is partial). */
export function diffProduct(saved: AdminProduct, body: ProductCreateRequest): ProductUpdateRequest {
  const changes: ProductUpdateRequest = {};
  if (body.category_id !== saved.category.id) changes.category_id = body.category_id;
  if (body.name !== saved.name) changes.name = body.name;
  if ((body.sku ?? null) !== saved.sku) changes.sku = body.sku ?? null;
  if ((body.description ?? null) !== saved.description) changes.description = body.description ?? null;
  if (body.price_cents !== saved.price_cents) changes.price_cents = body.price_cents;
  if (body.cost_cents !== undefined && body.cost_cents !== saved.cost_cents) changes.cost_cents = body.cost_cents;
  if (body.is_vatable !== undefined && body.is_vatable !== saved.is_vatable) changes.is_vatable = body.is_vatable;
  if (body.is_available !== undefined && body.is_available !== saved.is_available) {
    changes.is_available = body.is_available;
  }
  if (body.stock_mode !== undefined && body.stock_mode !== stockModeOf(saved)) changes.stock_mode = body.stock_mode;
  if (body.sort_order !== undefined && body.sort_order !== saved.sort_order) changes.sort_order = body.sort_order;
  return changes;
}

type UseProductFormOptions = {
  initial?: AdminProduct;
  onSaved: (product: AdminProduct) => void;
  onDeleted: () => void;
};

/** Create / edit a product (POST or PATCH /api/v1/admin/products, then the image upload). */
export function useProductForm({ initial, onSaved, onDeleted }: UseProductFormOptions) {
  const mutations = useProductMutations();

  return useCatalogForm<ProductFormValues, ProductField, AdminProduct, ProductCreateRequest, ProductUpdateRequest>({
    initial,
    toValues: productToValues,
    validate: validateProduct,
    diff: diffProduct,
    fields: PRODUCT_FIELDS,
    fieldOf: FIELD_OF,
    mutations,
    imageName: (id) => `product-${id}`,
    noun: 'product',
    onSaved,
    onDeleted,
    // §J: leaving own stock while stock > 0 → 409 "Use up or write off the stock first." (also under the selector).
    conflictField: (changes) => (changes.stock_mode !== undefined ? 'stock_mode' : null),
  });
}

export type ProductFormState = ReturnType<typeof useProductForm>;
