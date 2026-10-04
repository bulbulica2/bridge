<template>
  <!-- The last trick on demand, next to the trick in progress (which stays
       where it is). Hovering the button with a mouse opens a small pop-up
       with its four cards spread apart, each at its seat (named) and rotated
       like the table, the winner ringed; moving away closes it. A tap or a
       key (touch has no hover) opens it until a tap outside, the button
       again, or Escape. It stays clear of the screen's edges. -->
  <span
    ref="root"
    class="last-trick"
    @pointerenter="hover(true, $event)"
    @pointerleave="hover(false, $event)"
  >
    <button
      ref="button"
      type="button"
      class="last-trick-button"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="popupId"
      @click="toggle"
    >
      <ion-icon :icon="albumsOutline" aria-hidden="true" />
      Last trick
    </button>
    <!-- Padded rather than offset, so the pointer crosses no gap on its way
         from the button to the pop-up. -->
    <div
      v-if="open"
      :id="popupId"
      ref="popup"
      class="last-trick-popup"
      :style="{ '--nudge': `${nudge}px` }"
      role="dialog"
      :aria-label="`Last trick: ${caption}`"
    >
      <div class="last-trick-box">
        <p class="last-trick-title">Trick {{ trick.round }} · {{ caption }}</p>
        <TrickArea :cards="trick.cards" :my-seat="mySeat" :winner="trick.winner" spread />
      </div>
    </div>
  </span>
</template>

<script setup lang="ts">
import { computed, useId } from 'vue';
import { IonIcon } from '@ionic/vue';
import { albumsOutline } from 'ionicons/icons';
import TrickArea from '@/components/TrickArea.vue';
import { usePopover } from '@/composables/usePopover';
import type { Trick } from '@/services/game';
import type { Seat } from '@/services/tables';

const props = defineProps<{
  trick: Trick;
  mySeat: Seat | null;
}>();

const { root, button, popup, open, nudge, hover, toggle } = usePopover();
const popupId = `last-trick-${useId()}`;

const caption = computed(() =>
  props.trick.winner === props.mySeat ? 'You win' : `${props.trick.winner} wins`,
);
</script>

<style scoped>
.last-trick {
  position: relative;
  display: inline-flex;
}

.last-trick-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border: 1px solid var(--ion-color-primary, #3880ff);
  border-radius: 999px;
  background: var(--ion-background-color, #fff);
  color: var(--ion-color-primary, #3880ff);
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
  cursor: pointer;
}

.last-trick-button[aria-expanded='true'] {
  background: var(--ion-color-primary, #3880ff);
  color: var(--ion-color-primary-contrast, #fff);
}

.last-trick-button:focus-visible {
  outline: 2px solid var(--ion-color-primary, #3880ff);
  outline-offset: 2px;
}

/* Below the button, over the bottom seat, so the trick in progress above
   stays in sight. */
.last-trick-popup {
  position: absolute;
  top: 100%;
  left: 50%;
  z-index: 20;
  padding-top: 6px;
  transform: translateX(calc(-50% + var(--nudge, 0px)));
}

.last-trick-box {
  padding: 8px;
  border: 1px solid var(--ion-color-step-150, #e0e0e0);
  border-radius: 8px;
  background: var(--ion-background-color, #fff);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
}

.last-trick-title {
  margin: 0 0 6px;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
  text-align: center;
  color: var(--ion-color-medium);
}
</style>
