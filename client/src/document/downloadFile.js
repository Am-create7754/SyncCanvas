/** Triggers a browser download for a Blob and cleans up the temporary object URL right
 *  after — the URL only needs to live long enough for the click to be processed. */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Turns a document name into a safe filename fragment (letters/digits/dashes only). */
export function slugifyFilename(name) {
  return (name || 'untitled')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'untitled';
}
