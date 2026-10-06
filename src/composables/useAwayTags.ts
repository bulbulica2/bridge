import { computed } from 'vue';
import type { BroadcastTable } from '@/services/tables';
import { useNow } from '@/composables/useNow';
import { awayClockRuns, awayTags } from '@/utils/away';

// The tags of the others' away seats at `table` (src/utils/away.ts), each
// counting down from its `replace_at` on one clock, so seats away together
// show the same time. It ticks only while an away seat has a clock.
export function useAwayTags(table: () => BroadcastTable | null, me: () => number | null) {
  const now = useNow(() => awayClockRuns(table()));
  return computed(() => {
    const t = table();
    return t ? awayTags(t, me(), now.value) : {};
  });
}
