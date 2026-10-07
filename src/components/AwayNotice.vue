<template>
  <!-- Away mid-set (bridge_backend docs/API.md, Away mid-set). Each away
       seat's own clock is on its tag at the table ("away · 0:42", bb#138),
       so this says only once what those clocks are for, whoever and however
       many are away, with no countdown. With `held`, the viewer's own held
       seat instead, seen away from the table, with its clock. Daylight's
       orange-tint banner (#163). -->
  <div v-if="line" class="away-notice" role="status" aria-live="polite">
    <p class="away-line">{{ line }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { BroadcastTable } from '@/services/tables';
import { useNow } from '@/composables/useNow';
import { awayNote, heldText, myAwaySeat } from '@/utils/away';

const props = withDefaults(
  defineProps<{
    table: BroadcastTable | null;
    me: number | null;
    // Show the viewer's own held seat, not the others' away seats.
    held?: boolean;
  }>(),
  { held: false },
);

const mine = computed(() => (props.held && props.table ? myAwaySeat(props.table, props.me) : null));
// Only our own held seat's line counts down.
const now = useNow(() => !!mine.value?.replace_at);

const line = computed<string | null>(() => {
  const table = props.table;
  if (!table) {
    return null;
  }
  if (props.held) {
    return mine.value ? heldText(mine.value, table, now.value) : null;
  }
  return awayNote(table, props.me);
});
</script>

<style scoped>
.away-notice {
  margin: 8px 0;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--bridge-action-tint);
  color: var(--bridge-action-text);
}

.away-line {
  margin: 0;
  font-size: 0.9rem;
  line-height: 1.4;
}
</style>
