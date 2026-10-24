<?php

namespace Tests\Feature;

use Tests\TestCase;

class ExampleTest extends TestCase
{
    /**
     * The API has no home page: the root redirects to the web POS.
     */
    public function test_the_root_redirects_to_the_web_pos(): void
    {
        $this->get('/')->assertRedirect('/pos');
    }
}
