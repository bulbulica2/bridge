<template>
  <!-- The auction behind a button in the play page's top-left corner
       (#165), from the first call to the end of the board: the grid as
       AuctionHistory draws it (chips, the vulnerable side's seats red,
       alerts "!", questions "?"), with Ask / Ask in the chat on an
       opponent's call while the board is on. A mouse hovering the button
       opens it and moving away closes it; a tap opens it until a tap
       outside, the button again, or Escape (usePopover, as the last trick's
       pop-up). -->
  <span
    ref="root"
    class="auction-peek"
    @pointerenter="hover(true, $event)"
    @pointerleave="hover(false, $event)"
  >
    <button
      ref="button"
      type="button"
      class="auction-button"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="popupId"
      @click="toggle"
    >
      <ion-icon :icon="listOutline" aria-hidden="true" />
      Auction
    </button>
    <!-- Padded rather than offset, so the pointer crosses no gap on its way
         from the button to the pop-up. -->
    <div
      v-if="open"
      :id="popupId"
      ref="popup"
      class="auction-popup"
      :style="{ '--nudge': `${nudge}px` }"
      role="dialog"
      aria-label="Auction"
    >
      <AuctionHistory
        :auction="auction"
        :board="board"
        :my-seat="mySeat"
        :turn="turn"
        :players="players"
        :live="live"
        :busy="busy"
        :bidding="bidding"
        @ask="emit('ask', $event)"
        @explain="emit('explain', $event)"
        @chat="emit('chat', $event)"
      />
    </div>
  </span>
</template>

<script setup lang="ts">
import { useId } from 'vue';
import { IonIcon } from '@ionic/vue';
import { listOutline } from 'ionicons/icons';
import AuctionHistory from '@/components/AuctionHistory.vue';
import { usePopover } from '@/composables/usePopover';
import type { AuctionCall, Board } from '@/services/game';
import type { Seat } from '@/services/tables';
import type { PublicUser } from '@/services/users';

// AuctionHistory's own props, passed through.
withDefaults(
  defineProps<{
    auction: AuctionCall[];
    board: Board | null;
    mySeat: Seat | null;
    turn?: Seat | null;
    players?: Partial<Record<Seat, PublicUser | null>>;
    live?: boolean;
    busy?: boolean;
    bidding?: boolean;
  }>(),
  { turn: null, players: () => ({}), live: false, busy: false, bidding: false },
);

const emit = defineEmits<{
  ask: [index: number];
  explain: [index: number];
  chat: [index: number];
}>();

const { root, button, popup, open, nudge, hover, toggle } = usePopover();
const popupId = `auction-${useId()}`;
</script>

<style scoped>
.auction-peek {
  position: relative;
  display: inline-flex;
}

/* As tall as the vulnerability pill beside it. */
.auction-button {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  min-height: 32px;
  padding: 0 12px;
  border: 1px solid var(--bridge-control);
  border-radius: var(--bridge-radius-pill);
  background: var(--bridge-surface);
  color: var(--bridge-ink);
  font: inherit;
  font-size: 0.95rem;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}

.auction-button[aria-expanded='true'] {
  background: var(--bridge-plate);
  color: var(--bridge-on-plate);
}

.auction-button:focus-visible {
  outline: 2px solid var(--bridge-amber);
  outline-offset: 2px;
}

/* Below the button, over the table; kept clear of the screen's edges. */
.auction-popup {
  position: absolute;
  top: 100%;
  left: 50%;
  z-index: 30;
  box-sizing: border-box;
  width: min(380px, calc(100vw - 16px));
  padding-top: 6px;
  transform: translateX(calc(-50% + var(--nudge, 0px)));
}

.auction-popup :deep(.auction) {
  margin: 0;
  border: 1px solid var(--bridge-line);
  box-shadow: 0 4px 16px var(--bridge-shadow-strong);
}
</style>
