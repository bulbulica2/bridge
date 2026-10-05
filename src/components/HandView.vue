<template>
  <!-- One overlapping run of cards per suit, in `order` (♥ ♣ ♦ ♠, the
       viewer's own hand, by default), high to low. A suit
       never splits across lines; on a narrow screen whole suits wrap.
       Given `playable`, the hand is the one being played: every card is a
       button, and the ones that can't legally go now are dimmed. The
       `forcedId` card, the only legal one, is about to play itself: it
       stands raised and pulses until it goes (see useForcedPlay). The cards
       are the card size setting's (cardSize.ts), smaller on a phone, and
       each shows at least 44 px of itself to tap. The hand keeps the height
       it had as dealt while its cards go (useSteadyHeight). -->
  <div
    ref="root"
    class="hand"
    :class="{ active: playable }"
    :style="{ '--card-w': cardWidthCss, '--card-step': cardStep }"
    :aria-label="label"
    :aria-busy="busy"
  >
    <div v-for="group in groups" :key="group.suit" class="suit-group">
      <template v-if="playable">
        <button
          v-for="card in group.cards"
          :key="card.id"
          type="button"
          class="card card-button"
          :class="{
            illegal: !playable.includes(card.id),
            sending: card.id === sendingId,
            forced: card.id === forcedId,
          }"
          :data-card="card.id"
          :disabled="busy || !playable.includes(card.id)"
          @click="emit('play', card)"
        >
          <PlayingCard :card="card" />
        </button>
      </template>
      <template v-else>
        <PlayingCard v-for="card in group.cards" :key="card.id" :card="card" class="card" />
      </template>
    </div>
    <p v-if="cards.length === 0" class="empty">No cards left.</p>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import PlayingCard from '@/components/PlayingCard.vue';
import { useSteadyHeight } from '@/composables/useSteadyHeight';
import type { Card, Suit } from '@/services/game';
import { groupBySuit, HAND_SUITS } from '@/utils/cards';
import { MIN_TARGET_PX, cardSize, cardWidthCss } from '@/utils/cardSize';

const props = withDefaults(
  defineProps<{
    cards: Card[];
    label?: string;
    // The ids that may be played now; null (the default) is a hand on show only.
    playable?: number[] | null;
    // A card is on its way: nothing more can be tapped until it lands.
    busy?: boolean;
    sendingId?: number | null;
    // The only legal card, counting down to playing itself.
    forcedId?: number | null;
    // The suits left to right: trumps first for dummy (see suitOrder).
    order?: readonly Suit[];
  }>(),
  {
    label: 'Your hand',
    playable: null,
    busy: false,
    sendingId: null,
    forcedId: null,
    order: () => HAND_SUITS,
  },
);

const emit = defineEmits<{ play: [card: Card] }>();

const groups = computed(() => groupBySuit(props.cards, props.order));

// How much of each card shows before the next one covers it: rank and suit,
// and never less than a finger's width.
const cardStep = `max(${MIN_TARGET_PX}px, calc(var(--card-w) * 0.46))`;

// A new deal (more cards than before) or another card size: the hand's
// height is measured afresh, then held while the cards are played.
const root = ref<HTMLElement | null>(null);
const deals = ref(0);
watch(
  () => props.cards.length,
  (count, before) => {
    if (count > before) {
      deals.value++;
    }
  },
);
useSteadyHeight(root, () => [deals.value, cardSize.value]);
</script>

<style scoped>
.hand {
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  justify-content: center;
  box-sizing: border-box;
  gap: 8px 6px;
}

/* Room for a playable card to rise without being clipped. */
.hand.active {
  padding-top: 10px;
}

/* A phone: 1.5 times the old card, so two suits share a row (about six
   cards) and 13 cards take two or three rows. */
@media (max-width: 575px) {
  .hand {
    --card-max: 72px;
  }
}

.suit-group {
  display: flex;
}

/* Each card covers the one before it but for `--card-step`, which leaves
   its rank and suit showing and is the whole of it a tap can reach. */
.card + .card {
  margin-left: calc(var(--card-step) - var(--card-w));
}

.card-button {
  display: block;
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  cursor: pointer;
  transition: transform 0.12s ease;
}

.card-button:not(:disabled):hover,
.card-button:not(:disabled):focus-visible,
.card-button.sending,
.card-button.forced {
  transform: translateY(-10px);
}

/* About to play itself: a pulsing ring until it goes, or is tapped. */
.card-button.forced :deep(.playing-card) {
  animation: forced-pulse 1s ease-in-out infinite;
}

@keyframes forced-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 2px var(--ion-color-warning, #ffc409);
  }
  50% {
    box-shadow: 0 0 0 5px rgba(var(--ion-color-warning-rgb, 255, 196, 9), 0.45);
  }
}

@media (prefers-reduced-motion: reduce) {
  .card-button.forced :deep(.playing-card) {
    animation: none;
    box-shadow: 0 0 0 3px var(--ion-color-warning, #ffc409);
  }
}

.card-button:focus-visible {
  outline: none;
}

.card-button:focus-visible :deep(.playing-card) {
  box-shadow: 0 0 0 2px var(--ion-color-primary);
}

.card-button:disabled {
  cursor: default;
}

/* Can't follow to this trick: still readable, clearly out of play. */
.card-button.illegal :deep(.playing-card) {
  filter: grayscale(0.6) brightness(0.8);
  opacity: 0.45;
}

.empty {
  margin: 0;
  color: var(--ion-color-medium);
}
</style>
