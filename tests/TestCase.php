<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    /**
     * Treat every test request like a fresh HTTP request: drop guards resolved by a
     * previous request in the same test, so a revoked token is re-checked instead of
     * the previously authenticated user being reused from memory.
     *
     * {@inheritdoc}
     */
    public function call($method, $uri, $parameters = [], $cookies = [], $files = [], $server = [], $content = null)
    {
        $this->app['auth']->forgetGuards();

        return parent::call($method, $uri, $parameters, $cookies, $files, $server, $content);
    }
}
