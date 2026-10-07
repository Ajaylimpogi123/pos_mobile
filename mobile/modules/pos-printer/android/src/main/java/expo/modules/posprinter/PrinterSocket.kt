package expo.modules.posprinter

import java.io.IOException
import java.net.ConnectException
import java.net.InetSocketAddress
import java.net.NoRouteToHostException
import java.net.Socket
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.Timer
import kotlin.concurrent.schedule

/**
 * Raw TCP printing (port 9100, "JetDirect"): blocking java.net sockets, always
 * called on Dispatchers.IO by [PosPrinterModule].
 *
 * send: connect (with a timeout) → tcpNoDelay → write → flush → shutdownOutput →
 * drain any input until EOF or 1.5 s → close. Port 9100 never confirms a print,
 * so a completed send means "sent", not "printed".
 */
internal object PrinterSocket {
  /** How long to read (and discard) what the printer sends back after the data. */
  private const val DRAIN_MS = 1_500L

  /**
   * A blocking write has no timeout of its own: a printer that stops reading
   * (paper out, cover open) would hang the job forever. A watchdog closes the
   * socket after this long, which fails the write with ERR_PRINTER_WRITE.
   */
  private const val WRITE_WATCHDOG_MS = 20_000L

  fun send(host: String, port: Int, data: ByteArray, timeoutMs: Int): Int {
    val socket = connect(host, port, timeoutMs)
    try {
      val watchdog = Timer("pos-printer-write-watchdog", true)
      watchdog.schedule(WRITE_WATCHDOG_MS) { closeQuietly(socket) }
      try {
        val output = socket.getOutputStream()
        output.write(data)
        output.flush()
        socket.shutdownOutput()
      } catch (error: IOException) {
        // The connection was open: some bytes may have reached the printer.
        throw PrinterWriteException(host, port, error)
      } finally {
        watchdog.cancel()
      }
      drain(socket)
      return data.size
    } finally {
      closeQuietly(socket)
    }
  }

  /** Opens and closes a connection; returns how long the connect took (ms). */
  fun probe(host: String, port: Int, timeoutMs: Int): Int {
    val started = System.nanoTime()
    val socket = connect(host, port, timeoutMs)
    val elapsedMs = ((System.nanoTime() - started) / 1_000_000L).toInt()
    closeQuietly(socket)
    return elapsedMs
  }

  private fun connect(host: String, port: Int, timeoutMs: Int): Socket {
    val address = try {
      InetSocketAddress(host, port)
    } catch (error: IllegalArgumentException) {
      // An out-of-range port or an empty host.
      throw PrinterHostException(host, error)
    }
    if (address.isUnresolved) throw PrinterHostException(host, null)

    val socket = Socket()
    try {
      socket.connect(address, timeoutMs.coerceAtLeast(1))
      socket.tcpNoDelay = true
      return socket
    } catch (error: SocketTimeoutException) {
      closeQuietly(socket)
      throw PrinterTimeoutException(host, port, error)
    } catch (error: NoRouteToHostException) {
      closeQuietly(socket)
      throw PrinterUnreachableException(host, port, error)
    } catch (error: ConnectException) {
      closeQuietly(socket)
      if (isRefused(error)) throw PrinterRefusedException(host, port, error)
      throw PrinterUnreachableException(host, port, error)
    } catch (error: UnknownHostException) {
      closeQuietly(socket)
      throw PrinterHostException(host, error)
    } catch (error: IOException) {
      closeQuietly(socket)
      throw PrinterUnreachableException(host, port, error)
    }
  }

  /** Android reports "connect failed: ECONNREFUSED (Connection refused)". */
  private fun isRefused(error: ConnectException): Boolean {
    val message = error.message ?: return false
    return message.contains("ECONNREFUSED") || message.contains("refused", ignoreCase = true)
  }

  /** Reads and discards input until EOF or [DRAIN_MS]. Every byte was already written and flushed. */
  private fun drain(socket: Socket) {
    val deadline = System.nanoTime() + DRAIN_MS * 1_000_000L
    val buffer = ByteArray(256)
    try {
      val input = socket.getInputStream()
      while (true) {
        val remainingMs = ((deadline - System.nanoTime()) / 1_000_000L).toInt()
        if (remainingMs <= 0) return
        socket.soTimeout = remainingMs
        if (input.read(buffer) < 0) return
      }
    } catch (error: IOException) {
      // A read timeout or a reset while draining: the data was already sent.
    }
  }

  private fun closeQuietly(socket: Socket) {
    try {
      socket.close()
    } catch (error: IOException) {
      // Already closed.
    }
  }
}
