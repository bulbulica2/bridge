<template>
  <span
    class="away-tag"
    :class="{ 'away-tag-urgent': tag.urgent }"
    :title="tag.seconds === null ? 'Away: the table waits for them' : 'Away: a robot takes the seat when the clock runs out'"
  >
    {{ awayTagText(tag) }}
  </span>
</template>

<script setup lang="ts">
// An away seat's tag: "away · 0:42" counting down to the robot taking the
// seat (bb#138), red in its last seconds, "replacing…" at 0 until the update
// with the robot lands; a plain "away" for an admin, whom the table waits
// for. A single root (no comment beside it), so the parent's class lands on
// it.
import type { AwayTag } from '@/utils/away';
import { awayTagText } from '@/utils/away';

defineProps<{ tag: AwayTag }>();
</script>

<style scoped>
.away-tag {
  font-weight: 700;
  text-transform: uppercase;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  font-family: var(--bridge-font);
  color: var(--away-tag-color, var(--bridge-double-text));
}

/* The last seconds before the robot: bold red, or white on the red plate. */
.away-tag-urgent {
  color: var(--away-tag-urgent, var(--ion-color-danger));
  text-decoration: underline;
  text-underline-offset: 2px;
}
</style>
