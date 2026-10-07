<?php

namespace App\Http\Requests\Admin\Catalog;

use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\UploadedFile;

/**
 * Shared rules for the multipart image uploads (Global Conventions → File uploads):
 * a single file field `image`, jpeg/png/webp, at most 5 MB, at least 100×100 px.
 */
abstract class CatalogImageRequest extends FormRequest
{
    /**
     * @return array<string, ValidationRule|array<mixed>|string>
     */
    public function rules(): array
    {
        return [
            'image' => [
                'required', 'file', 'image', 'mimes:jpeg,png,webp', 'max:5120',
                'dimensions:min_width=100,min_height=100',
            ],
        ];
    }

    public function uploadedImage(): UploadedFile
    {
        /** @var UploadedFile */
        return $this->file('image');
    }
}
