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

it('no longer exposes the default /api/user route', function () {
    $this->getJson('/api/user')->assertNotFound();
});
