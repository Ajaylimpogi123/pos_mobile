<?php

// Router for `php artisan serve` (it uses this file instead of the framework's when present).
//
// PHP's built-in server sees public/pos/index.html (the web POS build) and reports a deep link
// like /pos/orders/review as SCRIPT_NAME "/pos/index.html" + PATH_INFO "/orders/review". Laravel
// then takes "/pos" as the base URL and routes "orders/review", which 404s. Every request that
// reaches Laravel goes through public/index.php, so say so before handing over.
$_SERVER['SCRIPT_NAME'] = '/index.php';
$_SERVER['PHP_SELF'] = '/index.php';
$_SERVER['SCRIPT_FILENAME'] = getcwd().DIRECTORY_SEPARATOR.'index.php';
unset($_SERVER['PATH_INFO'], $_SERVER['ORIG_PATH_INFO']);

return require __DIR__.'/vendor/laravel/framework/src/Illuminate/Foundation/resources/server.php';
