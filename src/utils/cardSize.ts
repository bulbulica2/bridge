import { computed, ref } from 'vue';

// How big the cards are drawn (#136): Normal is the old 48 x 68 px card,
// Large (the default, so the table reads well from the start) twice that,
// Extra large two and a half times. Kept per browser, like the pinned menu
// (menu.ts); storage may be missing or refuse, and then it is Large.
export type CardSize = 'normal' | 'large' | 'xlarge';

export const CARD_SIZE_KEY = 'bridge.cardSize';
export const DEFAULT_CARD_SIZE: CardSize = 'large';

// The Account page's choices, smallest first. `width` is the card's in px
// (its height follows, 17/12 of it); `text` is the rank's size in the
// text-only hands (DummyColumns).
export const CARD_SIZES: readonly { value: CardSize; label: string; width: number; text: string }[] = [
  { value: 'normal', label: 'Normal', width: 48, text: '0.9rem' },
  { value: 'large', label: 'Large', width: 96, text: '1.15rem' },
  { value: 'xlarge', label: 'Extra large', width: 120, text: '1.35rem' },
];

// The narrowest strip of a card a tap may land on in an overlapping hand
// (WCAG 2.5.5, Apple's HIG).
export const MIN_TARGET_PX = 44;

function isCardSize(value: unknown): value is CardSize {
  return CARD_SIZES.some((size) => size.value === value);
}

export function readCardSize(): CardSize {
  try {
    const kept = localStorage.getItem(CARD_SIZE_KEY);
    return isCardSize(kept) ? kept : DEFAULT_CARD_SIZE;
  } catch {
    return DEFAULT_CARD_SIZE;
  }
}

export const cardSize = ref<CardSize>(readCardSize());

export function setCardSize(size: CardSize) {
  cardSize.value = size;
  try {
    localStorage.setItem(CARD_SIZE_KEY, size);
  } catch {
    // Not kept: the cards are Large again after a reload.
  }
}

const current = computed(() => CARD_SIZES.find((size) => size.value === cardSize.value)!);

// The setting's card width in px, for the layouts worked out in script
// (dummy's single row, handRow.ts).
export const cardWidthPx = computed(() => current.value.width);

// The width every card is drawn at, as CSS: the setting's, unless the room
// around it is shorter (`--card-max`: a phone's hand, the table's centre).
// PlayingCard, the hand and the trick all set `--card-w` from it, so the
// cards and the gaps and overlaps around them always agree.
export const cardWidthCss = computed(() => {
  const width = `${current.value.width}px`;
  return `min(${width}, var(--card-max, ${width}))`;
});

// The rank's size in the text-only hands (dummy's columns, the deal).
export const cardTextSize = computed(() => current.value.text);
