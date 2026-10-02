// Handing the user a file made in the browser: a Blob behind a temporary
// link with `download`, clicked and thrown away. Browsers only; a native
// shell's WebView ignores `download`, so the pages offer it on the web.
export function downloadFile(fileName: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Some browsers start the download after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Rejects when the clipboard is unavailable (an insecure origin, or the
// permission refused); the caller says so.
export async function copyText(text: string): Promise<void> {
  if (!navigator.clipboard?.writeText) {
    throw new Error('Clipboard unavailable');
  }
  await navigator.clipboard.writeText(text);
}
