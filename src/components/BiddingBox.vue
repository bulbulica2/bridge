<template>
  <!-- Two taps plus confirm (#160, IntoBridge's box with BBO's confirm):
       a level (1–7), then a strain (♣ ♦ ♥ ♠ NT), and only the full-width
       "Bid 2♥" under them sends it; Pass, X and XX preview the same way.
       A level with no legal strain left is disabled, and so is a strain the
       rules wouldn't allow at the picked level (a hint: the backend has the
       final word); everything is while a call is on its way. The pick
       starts over on a new state, once a call is taken or refused. The
       Alert button alerts the next call and opens its explanation above the
       rows (the page owns both, and clears them once a call is taken). -->
  <section class="bidding-box" aria-label="Bidding box" :aria-busy="busy">
    <div v-if="alert" class="alert-field">
      <input
        class="alert-input"
        type="text"
        :value="explanation"
        :maxlength="ALERT_MAX"
        placeholder="Explain to the opponents (optional)"
        aria-label="Explain your next call to the opponents"
        :disabled="busy"
        @input="type(($event.target as HTMLInputElement).value)"
      />
      <p class="alert-hint">Only the opponents see this. Your partner doesn't.</p>
    </div>

    <div class="levels">
      <button
        v-for="level in LEVELS"
        :key="level"
        type="button"
        class="pick level-pick"
        :class="{ on: pickedLevel === level }"
        :data-level="level"
        :aria-pressed="pickedLevel === level"
        :aria-label="`Level ${level}`"
        :disabled="busy || !levelOpen(level)"
        @click="pickLevel(level)"
      >
        {{ level }}
      </button>
    </div>

    <div class="strains">
      <button
        v-for="strain in STRAINS"
        :key="strain"
        type="button"
        class="pick strain-pick"
        :class="{ on: pickedStrain === strain, red: isRedStrain(strain), nt: strain === 'NT' }"
        :data-strain="strain"
        :aria-pressed="pickedStrain === strain"
        :aria-label="strainLabel(strain)"
        :disabled="busy || !strainOpen(strain)"
        @click="pickStrain(strain)"
      >
        {{ strainSymbol(strain) }}
      </button>
    </div>

    <div class="specials">
      <button
        v-for="bid in specials"
        :key="bid.id"
        type="button"
        class="pick special"
        :class="[`special-${bid.call.toLowerCase()}`, { on: pickedSpecial?.id === bid.id }]"
        :data-call="bid.call"
        :aria-pressed="pickedSpecial?.id === bid.id"
        :aria-label="callName(bid)"
        :disabled="busy || !isLegalCall(bid, auction, seat)"
        @click="pickSpecial(bid)"
      >
        {{ callLabel(bid) }}
      </button>
      <button
        type="button"
        class="pick alert-toggle"
        :class="{ on: alert }"
        :aria-pressed="alert"
        :disabled="busy"
        @click="flip"
      >
        <span class="alert-mark" aria-hidden="true">!</span> Alert
      </button>
    </div>

    <!-- Always there, so the box keeps its height: grey until a call is
         picked, then the one orange button that sends it. -->
    <button
      type="button"
      class="confirm-call"
      :data-picked="picked?.call"
      :disabled="busy || !picked"
      @click="confirm"
    >
      <template v-if="busy">
        <ion-spinner name="dots" />
        <span>Sending your call…</span>
      </template>
      <template v-else-if="picked">{{ confirmText }}</template>
      <template v-else>Pick a level, then a suit</template>
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { IonSpinner } from '@ionic/vue';
import type { AuctionCall, Bid, Strain } from '@/services/game';
import type { Seat } from '@/services/tables';
import { ALERT_MAX } from '@/utils/limits';
import {
  DOUBLE,
  LEVELS,
  PASS,
  REDOUBLE,
  STRAINS,
  callLabel,
  callName,
  isContractBid,
  isLegalCall,
  isRedStrain,
  strainSymbol,
} from '@/utils/auction';
import { SUIT_NAMES } from '@/utils/cards';

const props = defineProps<{
  // The GET /bids list: the confirm sends the picked bid's id.
  bids: Bid[];
  auction: AuctionCall[];
  // Whose call it is: the viewer's own seat.
  seat: Seat;
  busy: boolean;
}>();

const emit = defineEmits<{ call: [bid: Bid] }>();

// The next call's alert: whether it is alerted, and what it means.
const alert = defineModel<boolean>('alert', { default: false });
const explanation = defineModel<string>('explanation', { default: '' });

// The explanation shows only while the call is alerted (the Alert button).
function type(text: string) {
  explanation.value = text;
}

// Turned off, nothing is said either: an explanation alone would alert.
function flip() {
  alert.value = !alert.value;
  if (!alert.value) {
    explanation.value = '';
  }
}

// The bids looked up by level and strain rather than by list order or id.
function bidAt(level: number, strain: Strain): Bid | undefined {
  return props.bids.find((b) => isContractBid(b) && b.level === level && b.strain === strain);
}

function legal(bid: Bid | undefined): boolean {
  return !!bid && isLegalCall(bid, props.auction, props.seat);
}

const specials = computed(() =>
  [PASS, DOUBLE, REDOUBLE]
    .map((call) => props.bids.find((b) => b.call === call))
    .filter((b): b is Bid => !!b),
);

// The pick so far: a level, then a strain; or Pass, X or XX alone.
const pickedLevel = ref<number | null>(null);
const pickedStrain = ref<Strain | null>(null);
const pickedSpecial = ref<Bid | null>(null);

const picked = computed<Bid | null>(() => {
  if (pickedSpecial.value) {
    return pickedSpecial.value;
  }
  if (pickedLevel.value === null || pickedStrain.value === null) {
    return null;
  }
  return bidAt(pickedLevel.value, pickedStrain.value) ?? null;
});

const SPECIAL_WORDS: Record<string, string> = { [PASS]: 'Pass', [DOUBLE]: 'Double', [REDOUBLE]: 'Redouble' };

const confirmText = computed(() => {
  const bid = picked.value!;
  return isContractBid(bid) ? `Bid ${callLabel(bid)}` : SPECIAL_WORDS[bid.call];
});

function levelOpen(level: number): boolean {
  return STRAINS.some((strain) => legal(bidAt(level, strain)));
}

function strainOpen(strain: Strain): boolean {
  return pickedLevel.value !== null && legal(bidAt(pickedLevel.value, strain));
}

function strainLabel(strain: Strain): string {
  const name = strain === 'NT' ? 'No trump' : SUIT_NAMES[strain][0].toUpperCase() + SUIT_NAMES[strain].slice(1);
  if (pickedLevel.value === null) {
    return name;
  }
  return legal(bidAt(pickedLevel.value, strain)) ? callName(bidAt(pickedLevel.value, strain)!) : `${name}, too low`;
}

function pickLevel(level: number) {
  pickedSpecial.value = null;
  pickedLevel.value = level;
  // A strain picked first at another level stays if it is still legal.
  if (pickedStrain.value && !legal(bidAt(level, pickedStrain.value))) {
    pickedStrain.value = null;
  }
}

function pickStrain(strain: Strain) {
  pickedSpecial.value = null;
  pickedStrain.value = strain;
}

function pickSpecial(bid: Bid) {
  pickedLevel.value = null;
  pickedStrain.value = null;
  pickedSpecial.value = bid;
}

function reset() {
  pickedLevel.value = null;
  pickedStrain.value = null;
  pickedSpecial.value = null;
}

function confirm() {
  if (picked.value) {
    emit('call', picked.value);
  }
}

// A new state starts the pick over, and so does a call settling either
// way: taken (the state moves on) or refused (a 409, then a reload).
watch(() => props.auction, reset);
watch(
  () => props.busy,
  (busy, was) => {
    if (was && !busy) {
      reset();
    }
  },
);
</script>

<style scoped>
.bidding-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 0;
  padding: 10px;
  border-radius: var(--bridge-radius-card);
  background: var(--bridge-surface);
  box-shadow: 0 1px 0 var(--bridge-line);
}

.levels,
.strains,
.specials {
  display: grid;
  gap: 5px;
}

.levels {
  grid-template-columns: repeat(7, minmax(0, 1fr));
}

.strains {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.specials {
  grid-template-columns: 1.6fr 1fr 1fr 1.3fr;
}

/* The bidding cards: white like the real ones, so the suit colours read the
   same in dark mode. 46 px: a thumb's target. */
.pick {
  min-height: 46px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: #fff;
  box-shadow: inset 0 0 0 1.5px #c9d0da;
  color: #142033;
  font: inherit;
  font-size: 1.2rem;
  font-weight: 700;
  cursor: pointer;
  touch-action: manipulation;
}

.pick.red {
  color: #c8102e;
}

.pick.nt {
  font-size: 1rem;
}

.pick:not(:disabled):hover {
  box-shadow: inset 0 0 0 2px var(--bridge-table, #1d3a5f);
}

.pick:focus-visible {
  outline: 3px solid var(--ion-color-primary);
  outline-offset: 2px;
}

/* Picked: solid navy (a red suit solid red). */
.pick.on {
  background: #1d3a5f;
  box-shadow: none;
  color: #fff;
}

.pick.red.on {
  background: #c8102e;
}

.pick:disabled {
  background: var(--bridge-chip, #eef1f5);
  box-shadow: none;
  color: var(--bridge-disabled-text, #8a94a6);
  cursor: default;
}

.special-p:not(:disabled) {
  background: var(--bridge-pass-bg, #e3f1e6);
  box-shadow: none;
  color: var(--bridge-pass-text, #1d6b31);
}

.special-x:not(:disabled) {
  background: var(--bridge-double-bg, #fde6e4);
  box-shadow: none;
  color: var(--bridge-double-text, #b3261e);
}

.special-xx:not(:disabled) {
  background: var(--bridge-redouble-bg, #e1ebfd);
  box-shadow: none;
  color: var(--bridge-redouble-text, #1e4fc2);
}

.special.on:not(:disabled) {
  box-shadow: inset 0 0 0 3px currentColor;
}

.special,
.alert-toggle {
  font-size: 1rem;
}

/* Amber like an alerted call in the auction. */
.alert-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.alert-toggle.on {
  background: #fff4d6;
  box-shadow: inset 0 0 0 2px var(--bridge-amber, #f59e0b);
  color: #142033;
}

.alert-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--bridge-amber, #f59e0b);
  color: var(--bridge-on-amber, #2b1700);
  font-size: 0.7rem;
  font-weight: 700;
}

.alert-field {
  margin-bottom: 4px;
}

.alert-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 46px;
  padding: 0 12px;
  border: 1.5px solid var(--bridge-control);
  border-radius: 12px;
  background: var(--bridge-surface);
  color: var(--bridge-ink);
  font: inherit;
  font-size: 1rem;
}

.alert-input:focus-visible {
  border-color: var(--ion-color-primary);
  outline: none;
}

.alert-hint {
  margin: 4px 0 0;
  font-size: 0.8rem;
  color: var(--bridge-muted);
}

/* The confirm: the screen's one orange button once a call is picked. */
.confirm-call {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 50px;
  margin-top: 2px;
  border: 0;
  border-radius: var(--bridge-radius-button);
  background: var(--bridge-action);
  color: var(--bridge-on-action);
  font: inherit;
  font-size: 1.15rem;
  font-weight: 700;
  cursor: pointer;
  touch-action: manipulation;
}

.confirm-call:focus-visible {
  outline: 3px solid var(--ion-color-primary);
  outline-offset: 2px;
}

.confirm-call:disabled {
  background: var(--bridge-chip);
  color: var(--bridge-disabled-text);
  font-size: 1rem;
  cursor: default;
}

.confirm-call ion-spinner {
  width: 20px;
  height: 20px;
}
</style>
