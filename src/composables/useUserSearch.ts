import { computed, onScopeDispose, ref, watch } from 'vue';
import { searchUsers } from '@/services/users';
import type { SearchedUser } from '@/services/users';
import { errorMessage, statusOf } from '@/utils/errors';

// GET /users?search= refuses anything shorter (422).
export const SEARCH_MIN_LENGTH = 2;
// The endpoint allows 30 searches a minute, so wait for a pause in the typing.
export const SEARCH_DEBOUNCE_MS = 300;

// A search box over GET /users?search=: `query` is bound to the input, and a
// search goes out once the trimmed text has been still for SEARCH_DEBOUNCE_MS
// and is at least SEARCH_MIN_LENGTH long. Only the latest search's answer is
// kept, since an earlier one can come back after it.
export function useUserSearch() {
  const query = ref('');
  const results = ref<SearchedUser[]>([]);
  // Between the typing and the answer, the debounce wait included.
  const searching = ref(false);
  const error = ref('');
  // The term the current `results` answer, so the view can tell "no match"
  // from "not searched yet".
  const searched = ref<string | null>(null);

  const term = computed(() => query.value.trim());
  const tooShort = computed(() => term.value.length < SEARCH_MIN_LENGTH);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let latest = 0;

  function cancel() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    // Whatever is still in flight answers a term nobody is looking at.
    latest++;
  }

  watch(term, (text) => {
    cancel();
    error.value = '';
    if (text.length < SEARCH_MIN_LENGTH) {
      results.value = [];
      searched.value = null;
      searching.value = false;
      return;
    }
    searching.value = true;
    timer = setTimeout(() => {
      timer = null;
      run(text);
    }, SEARCH_DEBOUNCE_MS);
  });

  async function run(text: string) {
    const id = ++latest;
    try {
      const found = await searchUsers(text);
      if (id === latest) {
        results.value = found;
        searched.value = text;
      }
    } catch (e) {
      if (id === latest) {
        error.value =
          statusOf(e) === 429
            ? 'Too many searches. Wait a moment, then try again.'
            : errorMessage(e, 'Could not search for players. Please try again.');
      }
    } finally {
      if (id === latest) {
        searching.value = false;
      }
    }
  }

  // Back to an empty box, e.g. when the modal closes.
  function reset() {
    cancel();
    query.value = '';
    results.value = [];
    searched.value = null;
    searching.value = false;
    error.value = '';
  }

  onScopeDispose(cancel);

  return { query, results, searching, error, searched, tooShort, reset };
}
