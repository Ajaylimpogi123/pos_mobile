<?php

use Illuminate\Support\Facades\Route;

// The API has no home page: the root opens the web POS.
Route::redirect('/', '/pos');

// The web POS (Web POS & Print Bridge → A): the Vite build in public/pos/ (its assets are served
// as static files). Every /pos path returns the app's index.html, so React Router (basename
// "/pos") handles deep links. Same origin as the API, so no CORS.
Route::get('/pos/{path?}', function () {
    $index = public_path('pos/index.html');

    if (! is_file($index)) {
        return response('The web POS has not been built yet. Run `npm run build` in web/.', 404)
            ->header('Content-Type', 'text/plain; charset=UTF-8');
    }

    return response()->file($index, [
        'Content-Type' => 'text/html; charset=UTF-8',
        'Cache-Control' => 'no-cache',
    ]);
})->where('path', '.*')->name('web-pos');
