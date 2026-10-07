package expo.modules.posprinter

import expo.modules.kotlin.exception.CodedException

/*
 * Errors thrown to JavaScript (docs/api-contract.md → Printing → Device rules → Transport).
 *
 * Connect phase (nothing was written, so a retry can never print twice):
 *   ERR_PRINTER_TIMEOUT, ERR_PRINTER_REFUSED, ERR_PRINTER_UNREACHABLE, ERR_PRINTER_HOST
 * After the connection was open (bytes may have reached the printer):
 *   ERR_PRINTER_WRITE — never retried automatically.
 */

internal class PrinterTimeoutException(host: String, port: Int, cause: Throwable?) :
  CodedException("ERR_PRINTER_TIMEOUT", "No answer from $host:$port before the timeout.", cause)

internal class PrinterRefusedException(host: String, port: Int, cause: Throwable?) :
  CodedException("ERR_PRINTER_REFUSED", "$host refused the connection on port $port.", cause)

internal class PrinterUnreachableException(host: String, port: Int, cause: Throwable?) :
  CodedException("ERR_PRINTER_UNREACHABLE", "$host:$port can't be reached from this device.", cause)

internal class PrinterHostException(host: String, cause: Throwable?) :
  CodedException("ERR_PRINTER_HOST", "The printer address \"$host\" couldn't be resolved.", cause)

internal class PrinterWriteException(host: String, port: Int, cause: Throwable?) :
  CodedException("ERR_PRINTER_WRITE", "The connection to $host:$port failed while sending.", cause)
