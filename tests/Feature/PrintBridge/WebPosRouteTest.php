<?php

use Illuminate\Support\Facades\File;

/*
|--------------------------------------------------------------------------
| Web POS & Print Bridge → A: GET /pos/{path?} serves the web build
|--------------------------------------------------------------------------
*/

beforeEach(function () {
    $this->index = public_path('pos/index.html');
    $this->backup = File::exists($this->index) ? File::get($this->index) : null;
});

afterEach(function () {
    if ($this->backup !== null) {
        File::put($this->index, $this->backup);
    } elseif (File::exists($this->index)) {
        File::delete($this->index);
        if (File::isEmptyDirectory(public_path('pos'))) {
            File::deleteDirectory(public_path('pos'));
        }
    }
});

it('returns the build\'s index.html for /pos and every path under it', function (string $uri) {
    File::ensureDirectoryExists(public_path('pos'));
    File::put($this->index, '<!doctype html><title>POS</title>');

    $response = $this->get($uri)->assertOk();

    expect($response->baseResponse->getFile()->getContent())->toBe('<!doctype html><title>POS</title>')
        ->and($response->headers->get('Content-Type'))->toStartWith('text/html');
})->with(['/pos', '/pos/', '/pos/login', '/pos/orders/01K62Z3K5Q9V7X2M4N6P8R0T1W']);

it('returns a plain 404 when the build is missing', function () {
    if (File::exists($this->index)) {
        File::delete($this->index);
    }

    $this->get('/pos/login')
        ->assertNotFound()
        ->assertSeeText('The web POS has not been built yet.');
});

it('is named web-pos', function () {
    expect(route('web-pos', ['path' => 'login'], false))->toBe('/pos/login');
});
