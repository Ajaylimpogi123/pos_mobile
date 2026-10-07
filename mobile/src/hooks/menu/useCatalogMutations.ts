import { useMutation, useQueryClient } from '@tanstack/react-query';

import { menuKeys } from '@/hooks/menu/queryKeys';
import { cacheSavedProduct } from '@/hooks/menu/useAdminProducts';
import {
  createCategory,
  createProduct,
  deleteCategory,
  deleteCategoryImage,
  deleteProduct,
  deleteProductImage,
  updateCategory,
  updateProduct,
  uploadCategoryImage,
  uploadProductImage,
} from '@/services/adminCatalog';
import type {
  AdminProduct,
  Category,
  CategoryUpdateRequest,
  ProductUpdateRequest,
  UploadFile,
} from '@/services/types';
import { requestCatalogueSync } from '@/sync/catalogueSync';

/**
 * Product mutations. Each one writes the returned product into the cache and
 * invalidates the product lists; create / update / delete also invalidate the
 * category lists, because the admin `products_count` changes with them.
 * Every success also pulls the change into the on-device menu (catalogue sync).
 */
export function useProductMutations() {
  const client = useQueryClient();

  function afterSave(product: AdminProduct, affectsCategories: boolean) {
    cacheSavedProduct(client, product);
    void client.invalidateQueries({ queryKey: menuKeys.productLists() });
    // §J: the recipe's `price_cents` / `margin_bps` follow the product's price.
    void client.invalidateQueries({ queryKey: menuKeys.recipe(product.id) });
    if (affectsCategories) void client.invalidateQueries({ queryKey: menuKeys.categoryLists() });
    void requestCatalogueSync();
  }

  const create = useMutation({
    mutationFn: createProduct,
    onSuccess: (product) => afterSave(product, true),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: ProductUpdateRequest }) => updateProduct(id, body),
    onSuccess: (product, { body }) => afterSave(product, body.category_id !== undefined),
  });

  const uploadImage = useMutation({
    mutationFn: ({ id, file }: { id: number; file: UploadFile }) => uploadProductImage(id, file),
    onSuccess: (product) => afterSave(product, false),
  });

  const removeImage = useMutation({
    mutationFn: (id: number) => deleteProductImage(id),
    onSuccess: (product) => afterSave(product, false),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteProduct(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: menuKeys.productLists() });
      void client.invalidateQueries({ queryKey: menuKeys.categoryLists() });
      void requestCatalogueSync();
    },
  });

  return { create, update, uploadImage, removeImage, remove };
}

/**
 * Category mutations. Renaming a category changes `product.category.name`, so
 * updates and deletes also invalidate the product lists. Every success also
 * pulls the change into the on-device menu (catalogue sync).
 */
export function useCategoryMutations() {
  const client = useQueryClient();

  function afterSave(category: Category, affectsProducts: boolean) {
    client.setQueryData(menuKeys.category(category.id), category);
    void client.invalidateQueries({ queryKey: menuKeys.categoryLists() });
    if (affectsProducts) void client.invalidateQueries({ queryKey: menuKeys.productLists() });
    void requestCatalogueSync();
  }

  const create = useMutation({
    mutationFn: createCategory,
    onSuccess: (category) => afterSave(category, false),
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: CategoryUpdateRequest }) => updateCategory(id, body),
    onSuccess: (category, { body }) => afterSave(category, body.name !== undefined),
  });

  const uploadImage = useMutation({
    mutationFn: ({ id, file }: { id: number; file: UploadFile }) => uploadCategoryImage(id, file),
    onSuccess: (category) => afterSave(category, false),
  });

  const removeImage = useMutation({
    mutationFn: (id: number) => deleteCategoryImage(id),
    onSuccess: (category) => afterSave(category, false),
  });

  const remove = useMutation({
    mutationFn: (id: number) => deleteCategory(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: menuKeys.categoryLists() });
      void requestCatalogueSync();
    },
  });

  return { create, update, uploadImage, removeImage, remove };
}
