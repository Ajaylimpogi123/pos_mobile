/**
 * The pickers of the purchase forms (§L): the item picker offers **active
 * ingredients only** (per the user, 2026-09-30), searched by name; the
 * supplier picker offers active suppliers, searched by name or contact. Both
 * are dialogs with a search box, the list states and "Load more".
 */
import { useState } from 'react';

import { EmptyState, ErrorState, LoadMoreFooter, LoadingRows } from '@/components/common/ListStates';
import { SearchField } from '@/components/common/SearchField';
import { ProductImage } from '@/components/sell/SellParts';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { PurchaseItemOption } from '@/hooks/purchasing/usePurchaseRequestForm';
import { useDebounced } from '@/hooks/useDebounced';
import { useIngredientOptions } from '@/hooks/useRecipeBuilder';
import { useSupplierOptions } from '@/hooks/useSuppliers';
import type { SupplierRef } from '@/services/types';

type PickerProps<T> = { open: boolean; onClose: () => void; onPick: (value: T) => void };

export function ItemPickerDialog({ open, onClose, onPick }: PickerProps<PurchaseItemOption>) {
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const list = useIngredientOptions(search, open);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose an ingredient</DialogTitle>
          <DialogDescription>Active ingredients only.</DialogDescription>
        </DialogHeader>
        <SearchField id="pr-item-search" label="Search ingredients" value={term} onChange={setTerm} placeholder="Name" className="min-w-0" slashFocus={false} />
        <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border">
          {list.loading ? (
            <LoadingRows rows={4} label="Loading ingredients…" />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.retry} />
          ) : list.items.length === 0 ? (
            <EmptyState title="No ingredients found" message={search ? 'Try another name.' : 'Add active ingredients on the Ingredients page first.'} />
          ) : (
            <>
              <ul aria-label="Ingredients">
                {list.items.map((ingredient) => (
                  <li key={ingredient.id} className="border-b border-border last:border-b-0">
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-row-hover"
                      onClick={() => {
                        onPick({ type: 'ingredient', id: ingredient.id, name: ingredient.name, ingredient });
                        onClose();
                      }}
                    >
                      <ProductImage imageUrl={ingredient.image_url} imagePath={ingredient.image_path} className="size-9 shrink-0" />
                      <span className="flex min-w-0 flex-col">
                        <span className="font-medium">{ingredient.name}</span>
                        <span className="text-[13px] text-muted-foreground">
                          Counted in {ingredient.base_unit}
                          {ingredient.units.length > 0 ? ` · ${ingredient.units.map((unit) => unit.name).join(', ')}` : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <LoadMoreFooter shown={list.items.length} hasMore={list.hasMore} loading={list.loadingMore} onLoadMore={list.loadMore} error={list.loadMoreError} noun="ingredients" />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SupplierPickerDialog({ open, onClose, onPick }: PickerProps<SupplierRef>) {
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const list = useSupplierOptions(search, open);

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose a supplier</DialogTitle>
          <DialogDescription>Active suppliers only.</DialogDescription>
        </DialogHeader>
        <SearchField id="supplier-picker-search" label="Search suppliers" value={term} onChange={setTerm} placeholder="Name or contact" className="min-w-0" slashFocus={false} />
        <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border">
          {list.loading ? (
            <LoadingRows rows={4} label="Loading suppliers…" />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={list.retry} />
          ) : list.items.length === 0 ? (
            <EmptyState title="No suppliers found" message={search ? 'Try another name.' : 'Add active suppliers on the Suppliers page first.'} />
          ) : (
            <>
              <ul aria-label="Suppliers">
                {list.items.map((supplier) => (
                  <li key={supplier.id} className="border-b border-border last:border-b-0">
                    <button
                      type="button"
                      className="flex w-full flex-col px-3 py-2.5 text-left hover:bg-row-hover"
                      onClick={() => {
                        onPick({ id: supplier.id, name: supplier.name });
                        onClose();
                      }}
                    >
                      <span className="font-medium">{supplier.name}</span>
                      {supplier.contact_person || supplier.contact_number ? (
                        <span className="text-[13px] text-muted-foreground">
                          {[supplier.contact_person, supplier.contact_number].filter(Boolean).join(' · ')}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
              <LoadMoreFooter shown={list.items.length} hasMore={list.hasMore} loading={list.loadingMore} onLoadMore={list.loadMore} error={list.loadMoreError} noun="suppliers" />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
