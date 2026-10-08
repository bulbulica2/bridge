import { computed, onScopeDispose, ref } from 'vue';
import { useHistoryStore } from '@/stores/history';
import type { DoubleDummy } from '@/services/history';

// How long a pending analysis is given before it is read once more. The
// backend's queue solves a table in well under a second once it gets to it.
export const DOUBLE_DUMMY_REREAD_MS = 5000;

// A board's double dummy table (GET /boards/{board}/double-dummy, cached by
// the history store) for whatever board `boardId` names: `load()` reads it,
// and an answer still `pending` is read once more DOUBLE_DUMMY_REREAD_MS
// later, never again (no polling loop: a later load or a refresh asks
// afresh). Failures are quiet: the analysis is an extra, and a 403/404
// shows on the page's own reads. `settled`: the board's reads are done
// (ready, failed, or still pending after the reread), so the result dialog
// stops holding a row for the line.
export function useDoubleDummy(boardId: () => number | null) {
  const history = useHistoryStore();

  const analysis = computed<DoubleDummy | null>(() => {
    const id = boardId();
    return id ? (history.doubleDummy[id] ?? null) : null;
  });

  let rereadFor: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const settledFor = ref<number | null>(null);
  const settled = computed(() => {
    const id = boardId();
    return !!id && settledFor.value === id;
  });

  async function load() {
    const id = boardId();
    if (!id) {
      return;
    }
    let answer: DoubleDummy;
    try {
      answer = await history.loadDoubleDummy(id);
    } catch {
      settledFor.value = id;
      return;
    }
    if (answer.status === 'pending' && rereadFor !== id && boardId() === id) {
      rereadFor = id;
      stop();
      timer = setTimeout(() => {
        timer = null;
        if (boardId() === id) {
          history
            .loadDoubleDummy(id)
            .catch(() => {})
            .finally(() => (settledFor.value = id));
        }
      }, DOUBLE_DUMMY_REREAD_MS);
      return;
    }
    settledFor.value = id;
  }

  function stop() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  onScopeDispose(stop);

  return { analysis, load, settled };
}
