<template>
  <!-- A card face as IntoBridge draws it (Daylight, #160): plain white with a
       thin border, a big rank over its suit in the top-left corner, no pips
       and no court pictures, so the corner a fan of cards leaves showing
       says everything. -->
  <div
    class="playing-card"
    :class="{ red: isRed(card.suit) }"
    :style="{ '--card-w': cardWidthCss }"
    role="img"
    :aria-label="`${card.rank_name} of ${SUIT_NAMES[card.suit]}`"
  >
    <span class="corner">
      <span class="rank">{{ rankLabel(card.rank) }}</span>
      <span class="suit">{{ SUIT_SYMBOLS[card.suit] }}</span>
    </span>
  </div>
</template>
<script setup lang="ts">
import type { Card } from '@/services/game';
import { SUIT_NAMES, SUIT_SYMBOLS, isRed, rankLabel } from '@/utils/cards';
import { cardWidthCss } from '@/utils/cardSize';

defineProps<{ card: Card }>();
</script>

<style scoped>
/* Everything scales with `--card-w`, the card size setting's width (see
   cardSize.ts). The corner fits the part of a card a hand leaves showing
   (HandView's `--card-step`, at least 44 px): "10" included. Card faces
   stay white in dark mode too. */
.playing-card {
  --card-h: calc(var(--card-w) * 17 / 12);
  position: relative;
  flex: none;
  box-sizing: border-box;
  width: var(--card-w);
  height: var(--card-h);
  border: 1px solid var(--bridge-card-border);
  border-radius: calc(var(--card-w) * 0.12);
  background: var(--bridge-card-face);
  color: var(--bridge-card-ink);
  box-shadow:
    0 1px 2px var(--bridge-card-shadow),
    0 4px 10px rgba(20, 32, 51, 0.18);
  font-family: var(--bridge-font-numbers, sans-serif);
  font-weight: 700;
  user-select: none;
}

.playing-card.red {
  color: var(--bridge-card-red);
}

.corner {
  position: absolute;
  top: calc(var(--card-w) * 0.06);
  left: calc(var(--card-w) * 0.06);
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1;
}

.rank {
  font-size: calc(var(--card-w) * 0.38);
  letter-spacing: -0.04em;
}

.suit {
  font-size: calc(var(--card-w) * 0.32);
}
</style>
