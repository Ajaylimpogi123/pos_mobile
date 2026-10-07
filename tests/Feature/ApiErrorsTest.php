<?php

it('returns the contract 404 body for an unknown api route', function () {
    $this->getJson('/api/v1/does-not-exist')
        ->assertNotFound()
        ->assertExactJson(['message' => 'Resource not found.']);
});

it('returns JSON 404 even without an Accept header', function () {
    $this->get('/api/v1/does-not-exist')
        ->assertNotFound()
        ->assertExactJson(['message' => 'Resource not found.']);
});

it('returns the contract 500 body without debug details', function (bool $debug) {
    config(['app.debug' => $debug]);

    Route::get('/api/v1/test-server-error', fn () => throw new RuntimeException('Secret internal detail'));

    $this->getJson('/api/v1/test-server-error')
        ->assertStatus(500)
        ->assertExactJson(['message' => 'Server Error.']);
})->with(['debug off' => false, 'debug on' => true]);

it('no longer exposes the default /api/user route', function () {
    $this->getJson('/api/user')->assertNotFound();
});
