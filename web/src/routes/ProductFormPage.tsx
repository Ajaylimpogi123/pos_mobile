/**
 * Add or edit a product (Catalogue → Admin products, plus §J stock modes;
 * back-office.md → Forms). Every contract field: category, name, SKU,
 * description, price and cost (₱ text → integer centavos via `@pos/core/money`),
 * VAT, availability, stock mode (`Own stock` / `Recipe` / `Not tracked`),
 * sort order and the image. `POST` / `PATCH` (changed fields only), then the
 * image step. A `409` when leaving own stock shows under the stock mode.
 *
 * A saved `recipe` product shows the recipe builder below the form.
 */
import { LoaderCircleIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';

import { ErrorSummary } from '@/components/common/ErrorSummary';
import { RecipeSection } from '@/components/catalog/RecipeSection';
import { Banner } from '@/components/common/Banner';
import { FieldError, FormField } from '@/components/common/FormField';
import { ImageField } from '@/components/common/ImageField';
import { ErrorState, LoadingRows } from '@/components/common/ListStates';
import { PlainPage } from '@/components/common/PageBand';
import { useShellHeader } from '@/components/shell/ShellHeaderContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, MoneyInput, Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/misc';
import { NativeSelect } from '@/components/ui/select';
import { ImageStepError, useAdminProduct, useCategoryOptions, useSaveProduct, type ImageChange } from '@/hooks/useCatalogAdmin';
import { cn } from '@/lib/utils';
import { isApiError } from '@/services/api';
import type { AdminProduct, ProductCreateRequest, ProductUpdateRequest, StockMode } from '@/services/types';
import { nullIfBlank, parseSortOrder, SORT_ORDER_MESSAGE, splitSaveError, tooLong, type FieldErrors } from '@/utils/forms';
import { centsToInputText, formatPeso, parsePesoInput } from '@pos/core/money';
import { formatPercentBps } from '@pos/core/numbers';
import { marginBps, STOCK_MODES, stockModeOf } from '@pos/core/recipe';

const LIMITS = { name: 120, sku: 50, description: 500, moneyMaxCents: 100_000_000 } as const;
const FIELDS = [
  'category_id',
  'name',
  'sku',
  'description',
  'price_cents',
  'cost_cents',
  'is_vatable',
  'is_available',
  'stock_mode',
  'track_stock',
  'sort_order',
  'image',
] as const;
type Field = (typeof FIELDS)[number];

/** Laravel `alpha_dash`: letters, numbers, dashes and underscores. */
const ALPHA_DASH = /^[\p{L}\p{M}\p{N}_-]+$/u;
const MONEY_FORMAT_MESSAGE = 'Enter an amount like 50, 50.50 or 1,250.50.';

type Draft = {
  categoryId: string;
  name: string;
  sku: string;
  description: string;
  price: string;
  cost: string;
  isVatable: boolean;
  isAvailable: boolean;
  stockMode: StockMode;
  sortOrder: string;
};

function draftFrom(product: AdminProduct | null): Draft {
  return {
    categoryId: product ? String(product.category.id) : '',
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
  if (cents > LIMITS.moneyMaxCents) return { cents: null, error: `The ${label} can't be more than ${formatPeso(LIMITS.moneyMaxCents)}.` };
  return { cents };
}

function check(draft: Draft): { body: ProductCreateRequest | null; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const name = draft.name.trim();
  const sku = nullIfBlank(draft.sku);
  const description = nullIfBlank(draft.description);
  if (name === '') errors.name = 'Enter a name.';
  else if (name.length > LIMITS.name) errors.name = tooLong(LIMITS.name);
  if (draft.categoryId === '') errors.category_id = 'Choose a category.';
  if (sku !== null && sku.length > LIMITS.sku) errors.sku = tooLong(LIMITS.sku);
  else if (sku !== null && !ALPHA_DASH.test(sku)) errors.sku = 'Use only letters, numbers, dashes and underscores.';
  if (description !== null && description.length > LIMITS.description) errors.description = tooLong(LIMITS.description);
  const price = parseMoney(draft.price, 'price', true);
  if (price.error) errors.price_cents = price.error;
  const cost = parseMoney(draft.cost, 'cost', false);
  if (cost.error) errors.cost_cents = cost.error;
  const sortOrder = parseSortOrder(draft.sortOrder);
  if (sortOrder === null) errors.sort_order = SORT_ORDER_MESSAGE;
  if (Object.keys(errors).length > 0 || price.cents === null || cost.cents === null || sortOrder === null) return { body: null, errors };
  return {
    body: {
      category_id: Number(draft.categoryId),
      name,
      sku,
      description,
      price_cents: price.cents,
      cost_cents: cost.cents,
      is_vatable: draft.isVatable,
      is_available: draft.isAvailable,
      // §J / Q-031: the app sends `stock_mode` only (it wins over `track_stock`).
      stock_mode: draft.stockMode,
      sort_order: sortOrder,
    },
    errors,
  };
}

function diff(saved: AdminProduct, body: ProductCreateRequest): ProductUpdateRequest {
  const changes: ProductUpdateRequest = {};
  if (body.category_id !== saved.category.id) changes.category_id = body.category_id;
  if (body.name !== saved.name) changes.name = body.name;
  if ((body.sku ?? null) !== saved.sku) changes.sku = body.sku ?? null;
  if ((body.description ?? null) !== saved.description) changes.description = body.description ?? null;
  if (body.price_cents !== saved.price_cents) changes.price_cents = body.price_cents;
  if (body.cost_cents !== saved.cost_cents) changes.cost_cents = body.cost_cents;
  if (body.is_vatable !== saved.is_vatable) changes.is_vatable = body.is_vatable;
  if (body.is_available !== saved.is_available) changes.is_available = body.is_available;
  if (body.stock_mode !== stockModeOf(saved)) changes.stock_mode = body.stock_mode;
  if (body.sort_order !== saved.sort_order) changes.sort_order = body.sort_order;
  return changes;
}

export function ProductFormPage() {
  const params = useParams();
  const id = params.id ? Number(params.id) : null;
  const editing = id !== null && Number.isSafeInteger(id);
  const existing = useAdminProduct(editing ? id : null);
  useShellHeader(editing ? 'Edit product' : 'Add product');

  if (editing && existing.loading) return <LoadingRows rows={8} label="Loading the product…" />;
  if (editing && (existing.error || !existing.product)) {
    return (
      <PlainPage title="Edit product">
        <Card>
          <ErrorState message={existing.error ?? 'Not found.'} onRetry={existing.reload} />
        </Card>
      </PlainPage>
    );
  }
  return <ProductForm key={existing.product?.id ?? 'new'} product={editing ? existing.product : null} />;
}

function ProductForm({ product }: { product: AdminProduct | null }) {
  const navigate = useNavigate();
  const location = useLocation();
  const categories = useCategoryOptions();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(product));
  const [image, setImage] = useState<ImageChange>({ kind: 'none' });
  const [clientErrors, setClientErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string | null>(() => {
    const state = location.state as { notice?: string } | null;
    return state?.notice ?? null;
  });
  const [imageError, setImageError] = useState<string | null>(() => {
    const state = location.state as { imageError?: string } | null;
    return state?.imageError ?? null;
  });
  const [sentStockMode, setSentStockMode] = useState(false);
  const save = useSaveProduct(product?.id ?? null);

  const failure = save.error instanceof ImageStepError ? null : save.error;
  // §J: leaving own stock while stock > 0 → 409 "Use up or write off the stock first.", shown under the selector.
  const stockConflict = isApiError(failure) && failure.status === 409 && sentStockMode ? failure.message : null;
  const server = splitSaveError(stockConflict ? null : failure, FIELDS);
  const fieldError = (field: Field) => clientErrors[field] ?? server.fieldErrors[field] ?? null;
  const stockModeError = fieldError('stock_mode') ?? fieldError('track_stock') ?? stockConflict;

  function change(update: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...update }));
    setClientErrors({});
    setNotice(null);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (save.isPending) return;
    const checked = check(draft);
    setClientErrors(checked.errors);
    if (!checked.body) return;
    setImageError(null);
    setNotice(null);
    const body = product ? diff(product, checked.body) : checked.body;
    setSentStockMode(body.stock_mode !== undefined);
    save.mutate(
      { body, image },
      {
        onSuccess: (saved) => {
          if (!product && stockModeOf(saved) === 'recipe') {
            toast.success(`${saved.name} added.`);
            void navigate(`/products/${saved.id}`, { replace: true, state: { notice: 'Now add the ingredients of its recipe below.' } });
            return;
          }
          toast.success(product ? `${saved.name} saved.` : `${saved.name} added.`);
          void navigate('/products');
        },
        onError: (error) => {
          if (!(error instanceof ImageStepError)) return;
          if (product) {
            setImage({ kind: 'none' });
            setImageError(error.message);
          } else {
            void navigate(`/products/${error.savedId}`, { replace: true, state: { imageError: error.message } });
          }
        },
      },
    );
  }

  const savedMode = product ? stockModeOf(product) : null;
  const priceCents = parsePesoInput(draft.price);
  const costCents = draft.cost.trim() === '' ? 0 : parsePesoInput(draft.cost);
  const bps = priceCents !== null && costCents !== null ? marginBps(priceCents, costCents) : null;
  const margin = bps === null ? null : formatPercentBps(bps, 2);
  const leavingOwnWithStock = savedMode === 'own' && draft.stockMode !== 'own' && (product?.stock_qty ?? 0) > 0;
  const listedCategory = categories.categories.some((category) => String(category.id) === draft.categoryId);

  return (
    <PlainPage title={product ? `Edit ${product.name}` : 'Add product'} subtitle="An item on the POS menu.">
      <div className="flex w-full max-w-[720px] flex-col gap-4">
        <form onSubmit={onSubmit} noValidate aria-busy={save.isPending}>
          <ErrorSummary />
          <div className="flex flex-col gap-4">
            {server.banner ? <Banner>{server.banner}</Banner> : null}
            {imageError ? <Banner variant="warning">{imageError}</Banner> : null}
            {notice ? <Banner variant="info">{notice}</Banner> : null}

            <Card className="flex flex-col gap-5 p-5">
              <h2 className="text-base font-semibold">Details</h2>
              <FormField label="Name" error={fieldError('name')}>
                <Input value={draft.name} maxLength={LIMITS.name} onChange={(event) => change({ name: event.target.value })} placeholder="e.g. Egg with Rice" />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  label="Category"
                  error={fieldError('category_id') ?? (categories.error ? `Couldn't load the categories: ${categories.error}` : null)}
                >
                  <NativeSelect
                    value={draft.categoryId}
                    onChange={(event) => change({ categoryId: event.target.value })}
                    disabled={categories.loading}
                  >
                    <option value="">{categories.loading ? 'Loading…' : 'Choose a category'}</option>
                    {product && !listedCategory && draft.categoryId === String(product.category.id) ? (
                      <option value={product.category.id}>{product.category.name}</option>
                    ) : null}
                    {categories.categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                        {category.is_active ? '' : ' (inactive)'}
                      </option>
                    ))}
                  </NativeSelect>
                </FormField>
                <FormField label="SKU (optional)" error={fieldError('sku')} hint="Letters, numbers, dashes and underscores.">
                  <Input value={draft.sku} maxLength={LIMITS.sku} onChange={(event) => change({ sku: event.target.value })} placeholder="e.g. BRK-001" className="tabular" />
                </FormField>
              </div>
              <FormField label="Description (optional)" error={fieldError('description')}>
                <Textarea value={draft.description} maxLength={LIMITS.description} onChange={(event) => change({ description: event.target.value })} />
              </FormField>
            </Card>

            <Card className="flex flex-col gap-5 p-5">
              <h2 className="text-base font-semibold">Price</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Selling price (VAT included)" error={fieldError('price_cents')}>
                  <MoneyInput value={draft.price} onChange={(event) => change({ price: event.target.value })} placeholder="0.00" />
                </FormField>
                <FormField
                  label="Cost (optional)"
                  error={fieldError('cost_cents')}
                  hint={margin ? `Margin ${margin}` : draft.stockMode === 'recipe' ? 'A recipe can set this for you.' : 'Used for margins and reports.'}
                >
                  <MoneyInput value={draft.cost} onChange={(event) => change({ cost: event.target.value })} placeholder="0.00" />
                </FormField>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div>
                  <Label htmlFor="product-vatable">VAT-able</Label>
                  <p className="text-[13px] text-muted-foreground">Off for a VAT-exempt item.</p>
                  <FieldError message={fieldError('is_vatable')} />
                </div>
                <Switch id="product-vatable" checked={draft.isVatable} onCheckedChange={(isVatable) => change({ isVatable })} />
              </div>
            </Card>

            <Card className="flex flex-col gap-5 p-5">
              <h2 className="text-base font-semibold">On the POS</h2>
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div>
                  <Label htmlFor="product-available">Available</Label>
                  <p className="text-[13px] text-muted-foreground">Unavailable items show greyed out and can't be sold.</p>
                  <FieldError message={fieldError('is_available')} />
                </div>
                <Switch id="product-available" checked={draft.isAvailable} onCheckedChange={(isAvailable) => change({ isAvailable })} />
              </div>
              <FormField label="Sort order" error={fieldError('sort_order')} hint="Lower numbers show first in the category." className="max-w-[200px]">
                <Input inputMode="numeric" value={draft.sortOrder} onChange={(event) => change({ sortOrder: event.target.value })} className="tabular" />
              </FormField>
              <ImageField
                label="Image (optional)"
                imageUrl={product?.image_url ?? null}
                imagePath={product?.image_path ?? null}
                value={image}
                onChange={(next) => {
                  setImage(next);
                  setImageError(null);
                }}
                baseName={product ? `product-${product.id}` : 'product'}
                error={fieldError('image')}
                disabled={save.isPending}
              />
            </Card>

            <Card className="flex flex-col gap-3 p-5">
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-1 text-base font-semibold">Stock</legend>
                <div role="radiogroup" aria-label="Stock mode" className="grid gap-2 sm:grid-cols-3">
                  {STOCK_MODES.map((option) => {
                    const checked = draft.stockMode === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        onClick={() => change({ stockMode: option.value })}
                        className={cn(
                          'flex flex-col gap-1 rounded-lg border p-3 text-left',
                          checked ? 'border-green bg-green-soft' : 'border-border bg-card hover:bg-row-hover',
                        )}
                      >
                        <span className="text-sm font-semibold">{option.label}</span>
                        <span className="text-[13px] text-muted-foreground">{option.description}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>
              {product && savedMode === 'own' && product.stock_qty !== null ? (
                <p className="text-[13px] text-muted-foreground tabular">{product.stock_qty} on hand. Stock in, counts and wastage are on the Inventory page.</p>
              ) : null}
              {leavingOwnWithStock ? (
                <Banner variant="warning">This item still has stock. Use up or write off the stock first, or the change is refused.</Banner>
              ) : null}
              <FieldError message={stockModeError} />
            </Card>

            <div className="sticky bottom-0 z-10 flex justify-end gap-2 rounded-xl border border-border bg-card p-3 shadow-card">
              <Button asChild variant="outline" size="lg">
                <Link to="/products">Cancel</Link>
              </Button>
              <Button type="submit" variant="green" size="lg" disabled={save.isPending}>
                {save.isPending ? <LoaderCircleIcon className="animate-spin" aria-hidden="true" /> : null}
                {save.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </form>

        {product && savedMode === 'recipe' ? (
          <RecipeSection product={product} onCostApplied={(updated) => setDraft((current) => ({ ...current, cost: centsToInputText(updated.cost_cents) }))} />
        ) : draft.stockMode === 'recipe' ? (
          <Banner variant="info">Save the product with the Recipe stock mode to build its recipe.</Banner>
        ) : null}
      </div>
    </PlainPage>
  );
}
