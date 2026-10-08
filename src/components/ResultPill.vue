<template>
  <!-- The finished board's result dialog, closed to look at the deal: this
       small pill in the table's top-right corner opens it again, and keeps
       the countdown to the next board in sight ("Result · 0:12"). -->
  <button type="button" class="result-pill" @click="emit('open')">
    Result<template v-if="left !== null"> · <span class="bridge-number">{{ formatClock(left) }}</span></template>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useNow } from '@/composables/useNow';
import { formatClock, secondsLeft } from '@/utils/away';

const props = withDefaults(
  defineProps<{
    // When the next board comes by itself; null with no countdown.
    nextBoardAt?: string | null;
  }>(),
  { nextBoardAt: null },
);

const emit = defineEmits<{ open: [] }>();

const now = useNow(() => !!props.nextBoardAt);
const left = computed(() => (props.nextBoardAt ? secondsLeft(props.nextBoardAt, now.value) : null));
</script>

<style scoped>
/* Light on the navy, 36 px with a 44 px tap area (ClaimButton's). */
.result-pill {
  position: relative;
  height: 36px;
  margin: 0;
  padding: 0 14px;
  border: 0;
  border-radius: 18px;
  background: var(--bridge-surface);
  color: var(--bridge-ink);
  font-family: var(--bridge-font);
  font-size: 0.875rem;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}

.result-pill::before {
  content: '';
  position: absolute;
  inset: -4px;
}

.result-pill:focus-visible {
  outline: 2px solid var(--bridge-action);
  outline-offset: 2px;
}
</style>
