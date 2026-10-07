<?php

namespace App\Models\Concerns;

use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * A catalogue model (category, product) with an optional image stored on the
 * catalogue image disk (config `pos.catalog_image_disk`) at `image_path`.
 *
 * @property string|null $image_path
 */
trait HasCatalogImage
{
    /**
     * The filesystem disk that holds catalogue images.
     */
    public static function catalogImageDisk(): string
    {
        return (string) config('pos.catalog_image_disk', 'public');
    }

    /**
     * The storage directory for this record's images, e.g. `categories/2`.
     */
    public function catalogImageDirectory(): string
    {
        return $this->getTable().'/'.$this->getKey();
    }

    /**
     * The absolute URL of the image, or null when there is none.
     * React Native has no document base URL, so a relative URL is made absolute.
     */
    public function imageUrl(): ?string
    {
        if ($this->image_path === null || $this->image_path === '') {
            return null;
        }

        $url = Storage::disk(static::catalogImageDisk())->url($this->image_path);

        return Str::startsWith($url, ['http://', 'https://']) ? $url : url($url);
    }
}
