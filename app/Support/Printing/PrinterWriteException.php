<?php

namespace App\Support\Printing;

use RuntimeException;

/**
 * The connection broke while the bytes were being sent. Part of the document may have
 * printed, so the job is not retried automatically (the cashier can retry it).
 */
class PrinterWriteException extends RuntimeException {}
