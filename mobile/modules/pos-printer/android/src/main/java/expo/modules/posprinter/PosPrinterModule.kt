package expo.modules.posprinter

import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * PosPrinter: the POS app's local Expo Module (Android only) for raw ESC/POS
 * over TCP. JavaScript loads it with `requireOptionalNativeModule('PosPrinter')`,
 * so Expo Go (which doesn't include it) and Jest still run the app.
 */
class PosPrinterModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PosPrinter")

    /** Sends the bytes and resolves with the number of bytes sent. */
    AsyncFunction("send") Coroutine { host: String, port: Int, data: ByteArray, timeoutMs: Int ->
      withContext(Dispatchers.IO) { PrinterSocket.send(host, port, data, timeoutMs) }
    }

    /** Connects and disconnects; resolves with the connect latency in ms. */
    AsyncFunction("probe") Coroutine { host: String, port: Int, timeoutMs: Int ->
      withContext(Dispatchers.IO) { PrinterSocket.probe(host, port, timeoutMs) }
    }
  }
}
