/**
 * Admin catalogue (Catalogue: Categories & Products → Admin, `product.manage`):
 * the category and product lists, reads, saves (JSON first, then the image),
 * and deletes. Every change also refreshes the Sell menu, the printer route
 * picker and the stock badges, which read the same catalogue.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { useCursorList } from '@/hooks/useCursorList';
import { menuKeys } from '@/hooks/useMenu';
import { printerKeys } from '@/hooks/usePrinters';
import { stockKey } from '@/hooks/useStockBadges';
import {
  createCategory,
  createProduct,
  deleteCategory,
  deleteCategoryImage,
  deleteProduct,
  deleteProductImage,
  getAdminCategory,
  getAdminProduct,
  listAdminProducts,
  updateCategory,
  updateProduct,
  uploadCategoryImage,
  uploadProductImage,
} from '@/services/adminCatalog';
import { getErrorMessage } from '@/services/api';
import { listAdminCategories } from '@/services/catalog';
import type {
  AdminProduct,
  Category,
  CategoryCreateRequest,
  CategoryUpdateRequest,
  CursorPage,
  ProductCreateRequest,
  ProductUpdateRequest,
} from '@/services/types';
import type { PreparedImage } from '@/utils/images';

export const catalogKeys = {
  all: ['admin', 'catalog'] as const,
  categoryLists: ['admin', 'catalog', 'categories', 'list'] as const,
  categoryList: (search: string, isActive: boolean | null) => ['admin', 'catalog', 'categories', 'list', search, isActive] as const,
  categoryOptions: ['admin', 'catalog', 'categories', 'options'] as const,
  category: (id: number) => ['admin', 'catalog', 'categories', 'detail', id] as const,
  productLists: ['admin', 'catalog', 'products', 'list'] as const,
  productList: (search: string, categoryId: number | null, isAvailable: boolean | null) =>
    ['admin', 'catalog', 'products', 'list', search, categoryId, isAvailable] as const,
  product: (id: number) => ['admin', 'catalog', 'products', 'detail', id] as const,
  recipe: (id: number) => ['admin', 'catalog', 'products', 'recipe', id] as const,
};

/** What the image field asks for on Save: nothing, a new file, or removing the current image. */
export type ImageChange = { kind: 'none' } | { kind: 'upload'; image: PreparedImage } | { kind: 'remove' };

/** The record was saved but its image step failed: the form stays open on the saved record. */
export class ImageStepError extends Error {
  readonly savedId: number;
  constructor(message: string, savedId: number) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = 'ImageStepError';
    this.savedId = savedId;
  }
}

function refreshCatalog(client: QueryClient) {
  void client.invalidateQueries({ queryKey: catalogKeys.all });
  void client.invalidateQueries({ queryKey: menuKeys.all });
  // The printer route picker's categories (printerKeys.categories(admin), both variants).
  void client.invalidateQueries({ queryKey: printerKeys.categories(true).slice(0, 2) });
  void client.invalidateQueries({ queryKey: stockKey });
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export function useAdminCategoryList(search: string, isActive: boolean | null) {
  return useCursorList(catalogKeys.categoryList(search, isActive), (cursor) =>
    listAdminCategories({ cursor, per_page: 25, search: search || undefined, is_active: isActive ?? undefined }),
  );
}

async function readAllCategories(): Promise<Category[]> {
  const items: Category[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const result: CursorPage<Category> = await listAdminCategories({ cursor, per_page: 100 });
    items.push(...result.data);
    if (!result.meta.next_cursor) break;
    cursor = result.meta.next_cursor;
  }
  return items;
}

/** Every non-deleted category (inactive included): the product form's picker and the products filter. */
export function useCategoryOptions() {
  const query = useQuery({ queryKey: catalogKeys.categoryOptions, queryFn: readAllCategories });
  return {
    categories: query.data ?? [],
    loading: query.isPending,
    error: query.isError ? getErrorMessage(query.error) : null,
    reload: () => void query.refetch(),
  };
}

export function useAdminCategory(id: number | null) {
  const query = useQuery({ queryKey: catalogKeys.category(id ?? 0), queryFn: () => getAdminCategory(id as number), enabled: id !== null });
  return {
    category: query.data ?? null,
    loading: id !== null && query.isPending,
    error: query.isError ? getErrorMessage(query.error) : null,
    reload: () => void query.refetch(),
  };
}

type CategorySave = { body: CategoryCreateRequest | CategoryUpdateRequest; image: ImageChange };

export function useSaveCategory(id: number | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, image }: CategorySave): Promise<Category> => {
      let saved =
        id === null
          ? await createCategory(body as CategoryCreateRequest)
          : Object.keys(body).length > 0
            ? await updateCategory(id, body)
            : await getAdminCategory(id);
      try {
        if (image.kind === 'upload') saved = await uploadCategoryImage(saved.id, image.image.blob, image.image.name);
        if (image.kind === 'remove' && saved.image_path !== null) saved = await deleteCategoryImage(saved.id);
      } catch (error) {
        client.setQueryData(catalogKeys.category(saved.id), saved);
        refreshCatalog(client);
        throw new ImageStepError(`Saved, but the image wasn't changed: ${getErrorMessage(error)}`, saved.id);
      }
      return saved;
    },
    onSuccess: (saved) => {
      client.setQueryData(catalogKeys.category(saved.id), saved);
      refreshCatalog(client);
    },
  });
}

export function useDeleteCategory() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (id: number) => deleteCategory(id), onSuccess: () => refreshCatalog(client) });
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export function useAdminProductList(search: string, categoryId: number | null, isAvailable: boolean | null) {
  return useCursorList(catalogKeys.productList(search, categoryId, isAvailable), (cursor) =>
    listAdminProducts({
      cursor,
      per_page: 25,
      search: search || undefined,
      category_id: categoryId ?? undefined,
      is_available: isAvailable ?? undefined,
    }),
  );
}

export function useAdminProduct(id: number | null) {
  const query = useQuery({ queryKey: catalogKeys.product(id ?? 0), queryFn: () => getAdminProduct(id as number), enabled: id !== null });
  return {
    product: query.data ?? null,
    loading: id !== null && query.isPending,
    error: query.isError ? getErrorMessage(query.error) : null,
    reload: () => void query.refetch(),
  };
}

/** Puts a saved product into the cache and refreshes every list that shows it. */
export function useCacheProduct() {
  const client = useQueryClient();
  return (product: AdminProduct) => {
    client.setQueryData(catalogKeys.product(product.id), product);
    refreshCatalog(client);
  };
}

type ProductSave = { body: ProductCreateRequest | ProductUpdateRequest; image: ImageChange };

export function useSaveProduct(id: number | null) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ body, image }: ProductSave): Promise<AdminProduct> => {
      let saved =
        id === null
          ? await createProduct(body as ProductCreateRequest)
          : Object.keys(body).length > 0
            ? await updateProduct(id, body)
            : await getAdminProduct(id);
      try {
        if (image.kind === 'upload') saved = await uploadProductImage(saved.id, image.image.blob, image.image.name);
        if (image.kind === 'remove' && saved.image_path !== null) saved = await deleteProductImage(saved.id);
      } catch (error) {
        client.setQueryData(catalogKeys.product(saved.id), saved);
        refreshCatalog(client);
        throw new ImageStepError(`Saved, but the image wasn't changed: ${getErrorMessage(error)}`, saved.id);
      }
      return saved;
    },
    onSuccess: (saved) => {
      client.setQueryData(catalogKeys.product(saved.id), saved);
      refreshCatalog(client);
    },
  });
}

export function useDeleteProduct() {
  const client = useQueryClient();
  return useMutation({ mutationFn: (id: number) => deleteProduct(id), onSuccess: () => refreshCatalog(client) });
}
