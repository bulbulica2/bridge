<template>
  <!-- One overlapping run of cards per suit, ♠ ♥ ♦ ♣, high to low. A suit
       never splits across lines; on a narrow screen whole suits wrap. -->
  <div class="hand" :aria-label="label">
    <div v-for="group in groups" :key="group.suit" class="suit-group">
      <PlayingCard v-for="card in group.cards" :key="card.id" :card="card" class="card" />
    </div>
    <p v-if="cards.length === 0" class="empty">No cards left.</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import PlayingCard from '@/components/PlayingCard.vue';
import type { Card } from '@/services/game';
import { groupBySuit } from '@/utils/cards';

const props = withDefaults(defineProps<{ cards: Card[]; label?: string }>(), {
  label: 'Your hand',
});

const groups = computed(() => groupBySuit(props.cards));
</script>

<style scoped>
.hand {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 8px 6px;
}

.suit-group {
  display: flex;
}

/* Each card covers most of the one before it, leaving rank and suit showing. */
.card + .card {
  margin-left: -27px;
}

.empty {
  margin: 0;
  color: var(--ion-color-medium);
}
</style>
