<template>
  <!-- The opening leader's cards, as the hand is held, each with the
       tricks declarer makes double dummy after it is led: the lead made is
       raised and tagged, the best ones (fewest tricks for declarer) ringed
       green. Then the same in words. -->
  <section class="lead-analysis" aria-label="Opening lead">
    <h3 class="lead-title">Opening lead · {{ SEAT_NAMES[leader] }}</h3>
    <div class="leads" :style="{ '--card-w': cardWidthCss, '--card-step': cardStep }">
      <div v-for="group in groups" :key="group.suit" class="lead-suit">
        <div
          v-for="item in group.leads"
          :key="item.card.id"
          class="lead"
          :class="{ led: isLed(item), best: isBest(item) }"
          :data-card="item.card.id"
          role="img"
          :aria-label="spoken(item)"
        >
          <PlayingCard :card="item.card" aria-hidden="true" />
          <span class="lead-tricks">{{ item.tricks }}</span>
        </div>
      </div>
    </div>
    <p class="lead-legend">
      Tricks for declarer after each lead.
      <span class="legend-best">Best leads</span> are ringed<template v-if="lead"
        >, the lead made is raised</template
      >.
    </p>
    <p v-if="summary" class="lead-summary">{{ summary }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import PlayingCard from '@/components/PlayingCard.vue';
import type { PlayedCard, Suit } from '@/services/game';
import type { LeadTricks } from '@/services/history';
import type { Seat } from '@/services/tables';
import { SEAT_NAMES } from '@/utils/auction';
import { SUIT_NAMES, rankLabel } from '@/utils/cards';
import { MIN_TARGET_PX, cardWidthCss } from '@/utils/cardSize';
import { bestLeads, leadSummary, leadsInHandOrder } from '@/utils/doubleDummy';

const props = defineProps<{
  leads: LeadTricks[];
  // Declarer's left: the seat that held these cards.
  leader: Seat;
  // The first card of the play, if one was made.
  lead: PlayedCard | null;
  mySeat: Seat | null;
}>();

const ordered = computed(() => leadsInHandOrder(props.leads));

// As in HandView: how much of each card shows before the next covers it.
const cardStep = `max(${MIN_TARGET_PX}px, calc(var(--card-w) * 0.46))`;

const groups = computed(() => {
  const out: { suit: Suit; leads: LeadTricks[] }[] = [];
  for (const item of ordered.value) {
    const last = out.at(-1);
    if (last?.suit === item.card.suit) {
      last.leads.push(item);
    } else {
      out.push({ suit: item.card.suit, leads: [item] });
    }
  }
  return out;
});

const best = computed(() => bestLeads(props.leads));

const summary = computed(() => leadSummary(props.leads, props.lead, props.mySeat));

function isLed(item: LeadTricks): boolean {
  return props.lead?.card.id === item.card.id;
}

function isBest(item: LeadTricks): boolean {
  return best.value?.tricks === item.tricks;
}

// "King of spades: declarer makes 10, the lead made, a best lead".
function spoken(item: LeadTricks): string {
  const parts = [
    `${rankLabel(item.card.rank)} of ${SUIT_NAMES[item.card.suit]}: declarer makes ${item.tricks}`,
  ];
  if (isLed(item)) {
    parts.push('the lead made');
  }
  if (isBest(item)) {
    parts.push('a best lead');
  }
  return parts.join(', ');
}
</script>

<style scoped>
.lead-analysis {
  margin: 16px 0;
}

.lead-title {
  margin: 0 0 8px;
  font-size: 1rem;
  font-weight: 700;
}

/* Like HandView: overlapping runs per suit, whole suits wrapping, the
   card size setting's cards (1.5 times the old ones on a phone). */
.leads {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 6px;
  padding-top: 10px;
}

@media (max-width: 575px) {
  .leads {
    --card-max: 72px;
  }
}

.lead-suit {
  display: flex;
}

.lead {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

/* Each card covers most of the one before it, leaving rank and suit (and
   the number under them) showing. */
.lead + .lead {
  margin-left: calc(var(--card-step) - var(--card-w));
}

.lead-tricks {
  width: var(--card-step);
  font-size: 1rem;
  font-weight: 600;
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: var(--ion-color-medium);
}

.lead.best :deep(.playing-card) {
  box-shadow: 0 0 0 2px var(--ion-color-success, #2dd36f);
}

.lead.best .lead-tricks {
  font-weight: 800;
  color: var(--ion-color-success-shade, #28ba62);
}

.lead.led :deep(.playing-card) {
  transform: translateY(-10px);
  outline: 2px solid var(--ion-color-primary);
  outline-offset: 1px;
}

.lead.led .lead-tricks {
  color: var(--ion-color-primary);
  text-decoration: underline;
}

.lead-legend {
  margin: 6px 0 0;
  font-size: 0.8rem;
  color: var(--ion-color-medium);
}

.legend-best {
  color: var(--ion-color-success-shade, #28ba62);
  font-weight: 700;
}

.lead-summary {
  margin: 6px 0 0;
  font-weight: 600;
}
</style>
