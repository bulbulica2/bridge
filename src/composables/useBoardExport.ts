import { computed, nextTick, onScopeDispose, ref } from 'vue';
import { Capacitor } from '@capacitor/core';
import { useHistoryStore } from '@/stores/history';
import type { PlayingReview } from '@/services/history';
import { copyText, downloadFile } from '@/utils/download';
import { boardJson, boardPbn, boardText, exportFileName, playingExtras } from '@/utils/export';
import type { ExportExtras } from '@/utils/export';
import { showToast } from '@/utils/toast';

// Taking a reviewed board out of the app (src/utils/export.ts): the Export
// action sheet's buttons, and printing. Files and printing need a browser; a
// native shell's WebView ignores `download` links and window.print(), so
// there it only copies. The caller renders the sheet (`open`, `buttons`) and,
// while `printing`, a BoardPrintout teleported to <body> (src/theme/print.css).
// The review page and the play page's review modal both use it.
export function useBoardExport(review: () => PlayingReview | null) {
  const history = useHistoryStore();

  const open = ref(false);
  const printing = ref(false);
  const native = Capacitor.isNativePlatform();

  // This playing's matchpoints, when already read: the board's results (the
  // results page was visited) or its set's (the play page reads those after
  // every board). Nothing is asked for them here.
  const extras = computed<ExportExtras>(() => {
    const board = review();
    return board
      ? playingExtras(history.results, history.sets, board.board?.id ?? null, board.playing_id)
      : {};
  });

  const FORMATS = {
    txt: { type: 'text/plain;charset=utf-8', write: (r: PlayingReview) => boardText(r, extras.value) },
    pbn: { type: 'text/plain;charset=utf-8', write: boardPbn },
    json: { type: 'application/json', write: boardJson },
  };

  const buttons = computed(() => [
    { text: 'Copy as text', handler: copyAsText },
    ...(native
      ? []
      : [
          { text: 'Download .txt', handler: () => download('txt') },
          { text: 'Download .pbn', handler: () => download('pbn') },
          { text: 'Download .json', handler: () => download('json') },
          { text: 'Print / Save as PDF', handler: print },
        ]),
    { text: 'Cancel', role: 'cancel' },
  ]);

  async function copyAsText() {
    const board = review();
    if (!board) {
      return;
    }
    try {
      await copyText(boardText(board, extras.value));
      await showToast(`Board ${board.board?.number ?? ''} copied as text.`, 'success');
    } catch {
      await showToast('Could not copy to the clipboard. Try Download .txt instead.', 'danger');
    }
  }

  function download(format: keyof typeof FORMATS) {
    const board = review();
    if (board) {
      downloadFile(exportFileName(board, format), FORMATS[format].write(board), FORMATS[format].type);
    }
  }

  // The printout exists only while the print dialog is up: shown, printed,
  // then dropped on `afterprint` (window.print() doesn't block everywhere).
  async function print() {
    printing.value = true;
    document.body.classList.add('printing-board');
    await nextTick();
    window.addEventListener('afterprint', stopPrinting, { once: true });
    window.print();
  }

  function stopPrinting() {
    printing.value = false;
    document.body.classList.remove('printing-board');
  }

  // The view is left (or the modal closed): no sheet and no printout behind.
  function reset() {
    open.value = false;
    window.removeEventListener('afterprint', stopPrinting);
    if (printing.value) {
      stopPrinting();
    }
  }

  onScopeDispose(reset);

  return { open, printing, buttons, extras, reset };
}
