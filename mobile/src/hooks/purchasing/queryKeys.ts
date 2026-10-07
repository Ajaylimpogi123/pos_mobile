/**
 * TanStack Query keys for Ingredients, Recipes & Purchasing (Round A). Each
 * area lives under its own root, so a write refreshes its lists, details and
 * the related areas with a few invalidations.
 */
import type {
  PurchaseOrderListParams,
  PurchaseRequestListParams,
  IngredientMovementType,
  StockStatusFilter,
} from '@/services/types';

export const unitKeys = {
  all: ['units'] as const,
};

const ingredients = ['ingredients'] as const;

export const ingredientKeys = {
  all: ingredients,
  lists: () => [...ingredients, 'list'] as const,
  list: (filters: { search: string; segment: string; picker?: boolean }) => [...ingredients, 'list', filters] as const,
  detail: (id: number) => [...ingredients, 'detail', id] as const,
};

/** Ingredient inventory (the Ingredients side of Inventory). */
const ingredientStock = ['ingredient-stock'] as const;

export const ingredientStockKeys = {
  all: ingredientStock,
  lists: () => [...ingredientStock, 'list'] as const,
  list: (filters: { search: string; status: StockStatusFilter | null }) => [...ingredientStock, 'list', filters] as const,
  item: (id: number) => [...ingredientStock, 'item', id] as const,
  movements: (id: number) => [...ingredientStock, 'movements', id] as const,
  movementList: (id: number, type: IngredientMovementType | null) => [...ingredientStock, 'movements', id, { type }] as const,
};

const suppliers = ['suppliers'] as const;

export const supplierKeys = {
  all: suppliers,
  lists: () => [...suppliers, 'list'] as const,
  list: (filters: { search: string; segment: string }) => [...suppliers, 'list', filters] as const,
  detail: (id: number) => [...suppliers, 'detail', id] as const,
};

const requests = ['purchase-requests'] as const;

export const purchaseRequestKeys = {
  all: requests,
  lists: () => [...requests, 'list'] as const,
  list: (params: PurchaseRequestListParams) => [...requests, 'list', params] as const,
  detail: (ulid: string) => [...requests, 'detail', ulid] as const,
};

const orders = ['purchase-orders'] as const;

export const purchaseOrderKeys = {
  all: orders,
  lists: () => [...orders, 'list'] as const,
  list: (params: PurchaseOrderListParams) => [...orders, 'list', params] as const,
  detail: (ulid: string) => [...orders, 'detail', ulid] as const,
};
