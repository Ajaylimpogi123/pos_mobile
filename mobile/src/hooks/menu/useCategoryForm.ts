import {
  nullIfBlank,
  parseSortOrder,
  SORT_ORDER_MESSAGE,
  type FieldErrors,
} from '@/hooks/menu/formErrors';
import { useCatalogForm } from '@/hooks/menu/useCatalogForm';
import { useCategoryMutations } from '@/hooks/menu/useCatalogMutations';
import type { Category, CategoryCreateRequest, CategoryUpdateRequest } from '@/services/types';

/** Request fields of POST/PATCH /api/v1/admin/categories that have an input. */
export type CategoryField = 'name' | 'description' | 'sort_order' | 'is_active';

export const CATEGORY_FIELDS: readonly CategoryField[] = ['name', 'description', 'sort_order', 'is_active'];

export type CategoryFormValues = {
  name: string;
  description: string;
  sortOrder: string;
  isActive: boolean;
};

const FIELD_OF: { [K in keyof CategoryFormValues]: CategoryField } = {
  name: 'name',
  description: 'description',
  sortOrder: 'sort_order',
  isActive: 'is_active',
};

/** Contract limits. */
export const CATEGORY_LIMITS = { name: 80, description: 255 } as const;

export function categoryToValues(category?: Category): CategoryFormValues {
  return {
    name: category?.name ?? '',
    description: category?.description ?? '',
    sortOrder: String(category?.sort_order ?? 0),
    isActive: category?.is_active ?? true,
  };
}

export function validateCategory(values: CategoryFormValues): {
  body: CategoryCreateRequest | null;
  errors: FieldErrors<CategoryField>;
} {
  const errors: FieldErrors<CategoryField> = {};
  const name = values.name.trim();
  const description = nullIfBlank(values.description);

  if (name === '') errors.name = 'Enter a name.';
  else if (name.length > CATEGORY_LIMITS.name) errors.name = `Use ${CATEGORY_LIMITS.name} characters or fewer.`;

  if (description !== null && description.length > CATEGORY_LIMITS.description) {
    errors.description = `Use ${CATEGORY_LIMITS.description} characters or fewer.`;
  }

  const sortOrder = parseSortOrder(values.sortOrder);
  if (sortOrder === null) errors.sort_order = SORT_ORDER_MESSAGE;

  if (Object.keys(errors).length > 0 || sortOrder === null) return { body: null, errors };

  return { body: { name, description, sort_order: sortOrder, is_active: values.isActive }, errors };
}

/** Only the fields that differ from the saved category (PATCH is partial). */
export function diffCategory(saved: Category, body: CategoryCreateRequest): CategoryUpdateRequest {
  const changes: CategoryUpdateRequest = {};
  if (body.name !== saved.name) changes.name = body.name;
  if ((body.description ?? null) !== saved.description) changes.description = body.description ?? null;
  if (body.sort_order !== undefined && body.sort_order !== saved.sort_order) changes.sort_order = body.sort_order;
  if (body.is_active !== undefined && body.is_active !== saved.is_active) changes.is_active = body.is_active;
  return changes;
}

type UseCategoryFormOptions = {
  initial?: Category;
  onSaved: (category: Category) => void;
  onDeleted: () => void;
};

/** Create / edit a category (POST or PATCH /api/v1/admin/categories, then the image upload). */
export function useCategoryForm({ initial, onSaved, onDeleted }: UseCategoryFormOptions) {
  const mutations = useCategoryMutations();

  return useCatalogForm<CategoryFormValues, CategoryField, Category, CategoryCreateRequest, CategoryUpdateRequest>({
    initial,
    toValues: categoryToValues,
    validate: validateCategory,
    diff: diffCategory,
    fields: CATEGORY_FIELDS,
    fieldOf: FIELD_OF,
    mutations,
    imageName: (id) => `category-${id}`,
    noun: 'category',
    onSaved,
    onDeleted,
  });
}

export type CategoryFormState = ReturnType<typeof useCategoryForm>;
