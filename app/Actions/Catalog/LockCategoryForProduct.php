<?php

namespace App\Actions\Catalog;

use App\Models\Category;
use Illuminate\Validation\ValidationException;

/**
 * Inside a transaction, takes a shared lock on the (non-deleted) category a
 * product is being placed in. This serialises against DeleteCategoryAction's
 * FOR UPDATE lock, so a product can never end up in a soft-deleted category.
 */
class LockCategoryForProduct
{
    /**
     * @throws ValidationException 422 on `category_id` if the category was deleted meanwhile
     */
    public function execute(int $categoryId): Category
    {
        $category = Category::query()->whereKey($categoryId)->sharedLock()->first();

        if ($category === null) {
            throw ValidationException::withMessages([
                'category_id' => trans('validation.exists', ['attribute' => 'category id']),
            ]);
        }

        return $category;
    }
}
