#!/usr/bin/env node
/**
 * Fake network thermal printer for development (docs/api-contract.md →
 * Printing → Fake printer). Listens on raw TCP ports like a real printer's
 * port 9100, decodes the ESC/POS the app sends, and prints it as text with
 * markers such as [CENTER], [BOLD], [2x] and [CUT].
 *
 *   npm run fake-printer                      # ports 9100 9101 9102 (the dev seed: Counter, Kitchen, Bar)
 *   npm run fake-printer -- 9100 9101         # chosen ports
 *   npm run fake-printer -- 9101 --delay 8000 # hold each job 8 s before reading it (a slow printer)
 *   npm run fake-printer -- 9102 --drop       # accept, then reset every connection (a failing printer)
 *   npm run fake-printer -- --dump            # also print a hex dump of the raw bytes
 *
 * Point the printers at this PC: set DEV_PRINTER_HOST in the API's .env to the
 * PC's LAN IP and re-seed, or edit the printers in the app. Uses Node's
 * built-in modules only (no npm packages). Its decoder is its own, separate
 * from the app's code and tests.
 */
import net from 'node:net';
import os from 'node:os';

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

const DEFAULT_PORTS = [9100, 9101, 9102];

function parseArgs(argv) {
  const options = { ports: [], delayMs: 0, drop: false, dump: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--delay') {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 0) throw new Error('--delay needs a number of milliseconds, e.g. --delay 8000');
      options.delayMs = value;
      index += 1;
    } else if (arg === '--drop') {
      options.drop = true;
    } else if (arg === '--dump') {
      options.dump = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (/^\d+$/.test(arg) && Number(arg) >= 1 && Number(arg) <= 65535) {
      options.ports.push(Number(arg));
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.ports.length === 0) options.ports = DEFAULT_PORTS;
  return options;
}

// ---------------------------------------------------------------------------
// Decoder (CP437 text + the ESC/POS commands the app uses)
// ---------------------------------------------------------------------------

const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅ' +
  'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»' +
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧' +
  '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩' +
  '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
const HIGH = Array.from(CP437_HIGH);

const ALIGN = ['[LEFT]', '[CENTER]', '[RIGHT]'];

function sizeMarker(n) {
  const width = ((n >> 4) & 0x0f) + 1;
  const height = (n & 0x0f) + 1;
  if (width === 1 && height === 1) return '[1x]';
  if (width === 2 && height === 2) return '[2x]';
  if (width === 2 && height === 1) return '[2w]';
  if (width === 1 && height === 2) return '[2h]';
  return `[${width}w${height}h]`;
}

function hex(byte) {
  return byte.toString(16).padStart(2, '0').toUpperCase();
}

/** ESC/POS bytes → text with markers. Unknown commands show as <1B xx>. */
function decode(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i];
    const next = bytes[i + 1];
    const arg = bytes[i + 2];
    if (byte === 0x0a) {
      out += '\n';
    } else if (byte === 0x0d) {
      // CR: ignored (LF ends lines).
    } else if (byte === 0x1b && next === 0x40) {
      out += '[INIT]';
      i += 1;
    } else if (byte === 0x1b && next === 0x74) {
      out += arg === 0 ? '' : `[CODEPAGE ${arg}]`;
      i += 2;
    } else if (byte === 0x1b && next === 0x61) {
      out += ALIGN[arg] ?? `[ALIGN ${arg}]`;
      i += 2;
    } else if (byte === 0x1b && next === 0x45) {
      out += arg ? '[BOLD]' : '[/BOLD]';
      i += 2;
    } else if (byte === 0x1b && next === 0x64) {
      out += '\n'.repeat(Math.min(arg ?? 0, 3));
      i += 2;
    } else if (byte === 0x1d && next === 0x21) {
      out += sizeMarker(arg ?? 0);
      i += 2;
    } else if (byte === 0x1d && next === 0x56) {
      out += '[CUT]';
      // GS V m, and GS V 65/66 n (feed and cut) take one more byte.
      i += arg === 65 || arg === 66 ? 3 : 2;
    } else if (byte === 0x1c && next === 0x2e) {
      i += 1; // FS . (cancel Kanji mode)
    } else if (byte < 0x20 || byte === 0x7f) {
      out += `<${hex(byte)}${next !== undefined ? ` ${hex(next)}` : ''}>`;
      i += next !== undefined ? 1 : 0;
    } else if (byte < 0x80) {
      out += String.fromCharCode(byte);
    } else {
      out += HIGH[byte - 0x80];
    }
  }
  return out;
}

function hexDump(bytes) {
  const lines = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const row = bytes.subarray(offset, offset + 16);
    const hexes = Array.from(row, hex).join(' ').padEnd(47);
    const ascii = Array.from(row, (byte) => (byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.')).join('');
    lines.push(`${offset.toString(16).padStart(6, '0')}  ${hexes}  ${ascii}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Servers
// ---------------------------------------------------------------------------

function lanAddresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

function time() {
  return new Date().toTimeString().slice(0, 8);
}

function start(options) {
  let jobNumber = 0;

  for (const port of options.ports) {
    const server = net.createServer((socket) => {
      const from = socket.remoteAddress?.replace(/^::ffff:/, '') ?? '?';
      if (options.drop) {
        console.log(`[${time()}] :${port} dropped a connection from ${from} (--drop)`);
        socket.resetAndDestroy();
        return;
      }

      const chunks = [];
      if (options.delayMs > 0) {
        socket.pause();
        setTimeout(() => socket.resume(), options.delayMs);
      }
      socket.on('data', (chunk) => chunks.push(chunk));
      socket.on('error', (error) => console.log(`[${time()}] :${port} connection error: ${error.message}`));
      socket.on('end', () => {
        const bytes = Buffer.concat(chunks);
        socket.end();
        if (bytes.length === 0) {
          console.log(`[${time()}] :${port} connection from ${from} with no data (a reachability probe)`);
          return;
        }
        jobNumber += 1;
        const title = ` :${port} · job ${jobNumber} · ${bytes.length} bytes · from ${from} · ${time()} `;
        console.log(`\n${'='.repeat(8)}${title}${'='.repeat(8)}`);
        console.log(decode(bytes));
        if (options.dump) {
          console.log('--- raw bytes ---');
          console.log(hexDump(bytes));
        }
        console.log('='.repeat(16 + title.length));
      });
    });

    server.on('error', (error) => {
      console.error(`Port ${port}: ${error.message}`);
      process.exitCode = 1;
    });
    server.listen(port, '0.0.0.0', () => {
      const flags = [options.delayMs ? `delay ${options.delayMs} ms` : null, options.drop ? 'drop' : null, options.dump ? 'dump' : null]
        .filter(Boolean)
        .join(', ');
      console.log(`Fake printer listening on :${port}${flags ? ` (${flags})` : ''}`);
    });
  }

  const addresses = lanAddresses();
  if (addresses.length > 0) console.log(`This PC's LAN address: ${addresses.join(', ')} (use it as the printer's IP address)`);
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: npm run fake-printer -- [ports…] [--delay ms] [--drop] [--dump]');
  } else {
    start(options);
  }
} catch (error) {
  console.error(error.message);
  console.error('Usage: npm run fake-printer -- [ports…] [--delay ms] [--drop] [--dump]');
  process.exitCode = 1;
}
