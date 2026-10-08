<template>
  <!-- The last trick on demand, in the table's top-right corner under the
       contract and the tricks on the play page (#196), so the centre keeps
       the trick in progress to itself. Hovering the button with a mouse
       opens a small pop-up with its four cards spread apart, each at its
       seat (named) and rotated like the table, the winner ringed; moving
       away closes it. A tap or a key (touch has no hover) opens it until a
       tap outside, the button again, or Escape. It opens downward and to
       the left, over the top and right seats, and stays clear of the
       screen's edges. -->
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
      aria-label="Last trick"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="popupId"
      @click="toggle"
    >
      <ion-icon :icon="albumsOutline" aria-hidden="true" />
      <span class="last-trick-label">Last trick</span>
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

/* A light pill on the table's navy like Auction's, 32 px to see and 44 px
   to tap (the ::before reaches 6 px past its top and bottom). */
.last-trick-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  box-sizing: border-box;
  height: 32px;
  min-width: 32px;
  padding: 0 10px;
  border: 1px solid var(--bridge-control);
  border-radius: var(--bridge-radius-pill);
  background: var(--bridge-surface);
  color: var(--bridge-ink);
  font: inherit;
  font-size: 0.8125rem;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}

.last-trick-button::before {
  content: '';
  position: absolute;
  inset: -6px 0;
}

.last-trick-button ion-icon {
  flex: none;
  font-size: 14px;
}

/* A narrow table's corner has room for the icon alone (the button keeps
   its name in aria-label). */
@container (max-width: 420px) {
  .last-trick-label {
    display: none;
  }

  .last-trick-button {
    padding: 0;
  }

  .last-trick-button ion-icon {
    font-size: 16px;
  }
}

.last-trick-button[aria-expanded='true'] {
  background: var(--bridge-plate);
  color: var(--bridge-on-plate);
}

.last-trick-button:focus-visible {
  outline: 2px solid var(--bridge-amber);
  outline-offset: 2px;
}

/* Below the button and to its left, over the top and right seats, so the
   trick in progress stays in sight where there is room. */
.last-trick-popup {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 20;
  padding-top: 6px;
  transform: translateX(var(--nudge, 0px));
}

.last-trick-box {
  padding: 8px;
  border: 1px solid var(--bridge-line);
  border-radius: 12px;
  background: var(--bridge-surface);
  color: var(--bridge-ink);
  box-shadow: 0 4px 16px var(--bridge-shadow-strong);
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
