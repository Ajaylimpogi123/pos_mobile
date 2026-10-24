<?php

namespace App\Support\Printing;

use RuntimeException;

/**
 * The printer could not be reached (timeout, refused, unreachable). Nothing was printed, so
 * the job may be retried.
 */
class PrinterConnectionException extends RuntimeException {}
