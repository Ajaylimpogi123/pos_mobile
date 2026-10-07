<?php

use App\Models\AuditLog;
use App\Models\Category;
use App\Models\Product;
use Illuminate\Http\UploadedFile;

beforeEach(function () {
    seedRoles();
    $this->disk = fakeCatalogImageDisk();
    $this->manager = userWithRole('manager');
    $this->token = tokenFor($this->manager);

    $this->category = Category::factory()->create(['name' => 'Breakfast']);
    $this->product = Product::factory()->forCategory($this->category)->create(['cost_cents' => 2200]);
});

/**
 * The two image-bearing admin resources: [entity, table].
 */
dataset('catalog entities', [
    'category' => ['category', 'categories'],
    'product' => ['product', 'products'],
]);

function catalogModel(string $entity): Category|Product
{
    return $entity === 'category' ? test()->category : test()->product;
}

function imageUrlFor(string $entity): string
{
    $model = catalogModel($entity);

    return '/api/v1/admin/'.$model->getTable().'/'.$model->id.'/image';
}

function uploadImage(string $entity, mixed $file)
{
    return test()->withToken(test()->token)->post(
        imageUrlFor($entity),
        $file === null ? [] : ['image' => $file],
        ['Accept' => 'application/json'],
    );
}

it('stores an uploaded image and returns the resource with absolute image_url and image_path', function (string $entity, string $table) {
    $model = catalogModel($entity);

    $response = uploadImage($entity, fakeJpeg('photo.jpg', 800, 600))->assertOk();

    $path = $response->json('data.image_path');

    expect($path)->toMatch('#^'.$table.'/'.$model->id.'/[A-Za-z0-9]{40}\.jpg$#')
        ->and($response->json('data.image_url'))->toBe(rtrim(config('app.url'), '/').'/storage/'.$path)
        ->and($response->json('data.image_url'))->toStartWith('http')
        ->and($model->fresh()->image_path)->toBe($path)
        ->and($model->fresh()->updated_by)->toBe($this->manager->id);

    $this->disk->assertExists($path);

    $expectedKeys = $entity === 'category' ? categoryKeys() : productKeys(withCost: true);
    expect(array_keys($response->json('data')))->toBe($expectedKeys);

    $audit = lastAudit($entity.'.image_updated');
    expect($audit->actor_id)->toBe($this->manager->id)
        ->and($audit->subject_id)->toBe($model->id)
        ->and(ksortDeep($audit->changes))->toBe(['image_path' => ['from' => null, 'to' => $path]]);
})->with('catalog entities');

it('accepts png and webp', function (string $entity, string $table) {
    $png = uploadImage($entity, UploadedFile::fake()->image('photo.png', 100, 100))->assertOk();
    expect($png->json('data.image_path'))->toEndWith('.png');

    $webp = uploadImage($entity, fakeWebp('photo.webp', 1024, 768))->assertOk();
    expect($webp->json('data.image_path'))->toEndWith('.webp');
    $this->disk->assertExists($webp->json('data.image_path'));
})->with('catalog entities');

it('replaces an existing image and deletes the old file', function (string $entity) {
    $first = uploadImage($entity, fakeJpeg('one.jpg', 200, 200))->assertOk()->json('data.image_path');
    $second = uploadImage($entity, UploadedFile::fake()->image('two.png', 200, 200))->assertOk()->json('data.image_path');

    expect($second)->not->toBe($first)
        ->and(catalogModel($entity)->fresh()->image_path)->toBe($second);

    $this->disk->assertMissing($first);
    $this->disk->assertExists($second);

    expect(ksortDeep(lastAudit($entity.'.image_updated')->changes))
        ->toBe(['image_path' => ['from' => $first, 'to' => $second]]);
})->with('catalog entities');

it('removes the image, deletes the file and clears image_url/image_path', function (string $entity) {
    $path = uploadImage($entity, fakeJpeg('one.jpg', 200, 200))->assertOk()->json('data.image_path');

    $response = $this->withToken($this->token)->deleteJson(imageUrlFor($entity))->assertOk();

    $expectedKeys = $entity === 'category' ? categoryKeys() : productKeys(withCost: true);
    expect(array_keys($response->json('data')))->toBe($expectedKeys);

    $response->assertJsonPath('data.image_url', null)
        ->assertJsonPath('data.image_path', null);

    expect(catalogModel($entity)->fresh()->image_path)->toBeNull();
    $this->disk->assertMissing($path);

    expect(ksortDeep(lastAudit($entity.'.image_removed')->changes))
        ->toBe(['image_path' => ['from' => $path, 'to' => null]]);
})->with('catalog entities');

it('treats removing a missing image as a no-op', function (string $entity) {
    $this->withToken($this->token)
        ->deleteJson(imageUrlFor($entity))
        ->assertOk()
        ->assertJsonPath('data.image_path', null);

    expect(AuditLog::query()->where('action', $entity.'.image_removed')->count())->toBe(0);
})->with('catalog entities');

it('keeps the category products_count on image responses', function () {
    uploadImage('category', fakeJpeg('one.jpg', 200, 200))
        ->assertOk()
        ->assertJsonPath('data.products_count', 1);
});

it('rejects invalid uploads', function (string $entity, string $table, Closure $file, string $message) {
    uploadImage($entity, $file())
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['image' => $message]);

    expect(catalogModel($entity)->fresh()->image_path)->toBeNull()
        ->and($this->disk->allFiles())->toBe([]);
})->with('catalog entities')->with([
    'missing' => [fn () => null, 'The image field is required.'],
    'not a file' => [fn () => 'not-a-file', 'The image field must be a file.'],
    'pdf' => [fn () => UploadedFile::fake()->create('doc.pdf', 10, 'application/pdf'), 'The image field must be an image.'],
    'gif' => [fn () => UploadedFile::fake()->image('anim.gif', 200, 200), 'The image field must be a file of type: jpeg, png, webp.'],
    'over 5 MB' => [fn () => UploadedFile::fake()->image('big.png', 200, 200)->size(5121), 'The image field must not be greater than 5120 kilobytes.'],
    'too narrow' => [fn () => UploadedFile::fake()->image('small.png', 99, 200), 'The image field has invalid image dimensions.'],
    'too short' => [fn () => UploadedFile::fake()->image('small.png', 200, 99), 'The image field has invalid image dimensions.'],
    'jpeg too small' => [fn () => fakeJpeg('small.jpg', 64, 64), 'The image field has invalid image dimensions.'],
    'webp too small' => [fn () => fakeWebp('small.webp', 100, 80), 'The image field has invalid image dimensions.'],
]);

it('accepts exactly 5 MB', function () {
    uploadImage('product', UploadedFile::fake()->image('ok.png', 200, 200)->size(5120))->assertOk();
});

it('returns 404 for image endpoints on a soft-deleted record', function (string $entity) {
    $url = imageUrlFor($entity);

    $model = catalogModel($entity);
    if ($entity === 'category') {
        $model->products()->delete();
    }
    $model->delete();

    uploadImage($entity, fakeJpeg('one.jpg', 200, 200))
        ->assertNotFound()
        ->assertExactJson(['message' => 'Resource not found.']);

    $this->withToken($this->token)->deleteJson($url)
        ->assertNotFound()
        ->assertExactJson(['message' => 'Resource not found.']);
})->with('catalog entities');
