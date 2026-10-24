/**
 * Saves a downloaded Blob (a CSV export) as a file: an object URL on a
 * temporary link, clicked, then revoked. The token never appears in a URL
 * (the Blob was fetched by the API client with the Bearer header).
 */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the URL goes away.
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
