<?php

namespace App\Support\Printing;

/**
 * Sends prebuilt ESC/POS bytes to a network thermal printer over raw TCP (port 9100), with
 * the tablet's transport rules (Web POS & Print Bridge → E): connect with a 5 s timeout,
 * write everything, flush, shut down the output, drain the input until EOF or 1.5 s, close.
 * Used by `php artisan print-agent:run`; no ESC/POS library is involved.
 */
class RawTcpPrinter
{
    public const CONNECT_TIMEOUT_SECONDS = 5.0;

    public const WRITE_TIMEOUT_SECONDS = 5;

    public const DRAIN_SECONDS = 1.5;

    /**
     * @throws PrinterConnectionException the printer can't be reached (retryable)
     * @throws PrinterWriteException the connection broke while sending (not retryable)
     */
    public function send(string $host, int $port, string $bytes): void
    {
        $errno = 0;
        $errstr = '';
        $socket = @stream_socket_client(
            "tcp://{$host}:{$port}",
            $errno,
            $errstr,
            self::CONNECT_TIMEOUT_SECONDS,
            STREAM_CLIENT_CONNECT,
        );

        if ($socket === false) {
            $reason = trim($errstr) !== '' ? trim($errstr) : 'connection failed';

            throw new PrinterConnectionException("Could not connect to {$host}:{$port}: {$reason}");
        }

        try {
            stream_set_timeout($socket, self::WRITE_TIMEOUT_SECONDS);
            $this->write($socket, $bytes, $host, $port);
            fflush($socket);
            @stream_socket_shutdown($socket, STREAM_SHUT_WR);
            $this->drain($socket);
        } finally {
            fclose($socket);
        }
    }

    /**
     * @param  resource  $socket
     *
     * @throws PrinterWriteException
     */
    private function write($socket, string $bytes, string $host, int $port): void
    {
        $length = strlen($bytes);
        $written = 0;

        while ($written < $length) {
            $count = @fwrite($socket, substr($bytes, $written));

            if ($count === false || $count === 0) {
                $timedOut = (bool) (stream_get_meta_data($socket)['timed_out'] ?? false);

                throw new PrinterWriteException($timedOut
                    ? "Timed out sending to {$host}:{$port}"
                    : "The connection to {$host}:{$port} was lost while printing");
            }

            $written += $count;
        }
    }

    /**
     * Reads (and discards) whatever the printer sends until it closes the connection, or
     * 1.5 s pass, so the printer has received everything before the socket closes.
     *
     * @param  resource  $socket
     */
    private function drain($socket): void
    {
        $deadline = microtime(true) + self::DRAIN_SECONDS;

        while (! feof($socket)) {
            $remaining = $deadline - microtime(true);

            if ($remaining <= 0) {
                return;
            }

            $read = [$socket];
            $write = null;
            $except = null;
            $seconds = (int) floor($remaining);
            $ready = @stream_select($read, $write, $except, $seconds, (int) (($remaining - $seconds) * 1_000_000));

            if ($ready === false || $ready === 0) {
                return;
            }

            $chunk = @fread($socket, 8192);

            if ($chunk === false) {
                return;
            }
        }
    }
}
