<template>
  <!-- The auction behind a button in the table's bottom-left corner on the
       play page (#165, #171), from the first call to the end of the board,
       opening upward over the table: the grid as
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
      :style="{ '--nudge': `${nudge}px`, '--drop': `${drop}px` }"
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

const { root, button, popup, open, nudge, drop, hover, toggle } = usePopover();
const popupId = `auction-${useId()}`;
</script>

<style scoped>
.auction-peek {
  position: relative;
  display: inline-flex;
}

/* A light pill on the table's navy, as small as the vulnerability's. */
.auction-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  box-sizing: border-box;
  min-height: 32px;
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

.auction-button ion-icon {
  flex: none;
  font-size: 14px;
}

/* A narrow table's corner has room for the word alone. */
@container (max-width: 420px) {
  .auction-button ion-icon {
    display: none;
  }
}

.auction-button[aria-expanded='true'] {
  background: var(--bridge-plate);
  color: var(--bridge-on-plate);
}

.auction-button:focus-visible {
  outline: 2px solid var(--bridge-amber);
  outline-offset: 2px;
}

/* Above the button, over the table; kept clear of the screen's edges. */
.auction-popup {
  position: absolute;
  bottom: 100%;
  left: 50%;
  z-index: 30;
  box-sizing: border-box;
  width: min(380px, calc(100vw - 16px));
  padding-bottom: 6px;
  transform: translate(calc(-50% + var(--nudge, 0px)), var(--drop, 0px));
}

.auction-popup :deep(.auction) {
  margin: 0;
  border: 1px solid var(--bridge-line);
  box-shadow: 0 4px 16px var(--bridge-shadow-strong);
}
</style>
