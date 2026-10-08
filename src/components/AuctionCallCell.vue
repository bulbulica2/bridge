<template>
  <!-- One call of the auction grid, as Daylight's chip (#160). An alerted
       call is ringed amber with a "!", one asked about ringed blue with a
       "?", and the explanation pops up (a dark card) the way the last trick
       does:
       hovering with a mouse, or a tap until a tap outside or Escape. While
       the board lasts, any opponent's call also pops up an Ask button (and
       Ask in the chat, to ask in one's own words), and a call of ours an
       opponent asked about an Answer button. Partner's alerts show only
       once the auction is over (`bidding` hides them). A kibitzer (no
       seat, #182) gets no buttons, and no explanation while it lasts. Any
       other call is just its label. -->
  <span
    v-if="interactive"
    ref="root"
    class="call-cell"
    @pointerenter="hover(true, $event)"
    @pointerleave="hover(false, $event)"
  >
    <button
      ref="button"
      type="button"
      class="call-button"
      :class="{ alerted: !!alert, questioned: !!call.question }"
      :aria-label="buttonLabel"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="popupId"
      @click="toggle"
    >
      <CallLabel :bid="call.bid" chip />
      <span v-if="alert" class="mark alert-mark" aria-hidden="true">!</span>
      <span v-if="call.question" class="mark question-mark" aria-hidden="true">?</span>
    </button>
    <!-- Padded rather than offset, so the pointer crosses no gap on its way
         from the call to the pop-up. Plain text only: an explanation is
         whatever the bidder typed. -->
    <div
      v-if="open"
      :id="popupId"
      ref="popup"
      class="call-popup"
      :style="{ '--nudge': `${nudge}px` }"
      role="dialog"
      :aria-label="title"
    >
      <div class="call-box">
        <p class="call-title">{{ title }}</p>
        <p v-if="alert" class="alert-text">{{ watching ? KIBITZER_ALERT : alertText(alert) }}</p>
        <p v-else class="no-alert">Not alerted.</p>
        <p v-if="call.question" class="question-text">{{ questionLine }}</p>
        <button
          v-if="canAsk"
          type="button"
          class="popup-action ask"
          :disabled="busy"
          @click="emit('ask', index)"
        >
          Ask what it means
        </button>
        <button
          v-if="canChat"
          type="button"
          class="popup-action ask-in-chat"
          @click="chatAbout"
        >
          Ask in the chat
        </button>
        <button
          v-if="canAnswer"
          type="button"
          class="popup-action answer"
          :disabled="busy"
          @click="answer"
        >
          Answer
        </button>
      </div>
    </div>
  </span>
  <CallLabel v-else :bid="call.bid" chip />
</template>

<script setup lang="ts">
import { computed, useId } from 'vue';
import CallLabel from '@/components/CallLabel.vue';
import { usePopover } from '@/composables/usePopover';
import type { AuctionCall } from '@/services/game';
import type { Seat } from '@/services/tables';
import { SEAT_NAMES, callLabel, callName } from '@/utils/auction';
import { KIBITZER_ALERT, alertText, isOpponent, isPartner } from '@/utils/alerts';

const props = withDefaults(
  defineProps<{
    call: AuctionCall;
    // The call's place in the auction, which Ask and Answer name.
    index: number;
    mySeat: Seat | null;
    // The board isn't over: calls may still be asked about and answered.
    live?: boolean;
    // A question or an answer is on its way.
    busy?: boolean;
    // The auction is still on: partner's alert stays hidden, even if held.
    bidding?: boolean;
  }>(),
  { live: false, busy: false, bidding: false },
);

const emit = defineEmits<{
  ask: [index: number];
  explain: [index: number];
  chat: [index: number];
}>();

const { root, button, popup, open, nudge, hover, toggle, close } = usePopover();
const popupId = `call-${useId()}`;

const mine = computed(() => props.mySeat !== null && props.call.seat === props.mySeat);
const opponents = computed(() => isOpponent(props.call.seat, props.mySeat));
const partner = computed(() => isPartner(props.call.seat, props.mySeat));
// The alert the viewer may see: partner's only once the auction is over.
const alert = computed(() => (props.bidding && partner.value ? null : props.call.alert ?? null));
const canAsk = computed(() => props.live && opponents.value && !props.call.question);
const canAnswer = computed(() => props.live && mine.value && !!props.call.question);
const canChat = computed(() => props.live && opponents.value);
// A kibitzer (no seat) while the board is on: alerted calls are marked, but
// what they mean is the players' until the board is over.
const watching = computed(() => props.live && props.mySeat === null);
const interactive = computed(
  () => !!alert.value || (props.live && opponents.value) || canAnswer.value,
);

// "East alerted 2♦" (or You, Partner) for an alerted call, else "2♦ by
// East" (or "Your 2♦").
const title = computed(() => {
  const label = callLabel(props.call.bid);
  if (alert.value) {
    const by = mine.value ? 'You' : partner.value ? 'Partner' : SEAT_NAMES[props.call.seat];
    return `${by} alerted ${label}`;
  }
  return mine.value ? `Your ${label}` : `${label} by ${SEAT_NAMES[props.call.seat]}`;
});

const buttonLabel = computed(() => {
  const notes = [alert.value && 'alerted', props.call.question && 'asked about'];
  return [callName(props.call.bid), ...notes.filter(Boolean)].join(', ');
});

// Who asked, from where the viewer sits.
const questionLine = computed(() => {
  const asker = props.call.question!.asked_by;
  if (mine.value) {
    return `${SEAT_NAMES[asker]} asks what it means.`;
  }
  return `${asker === props.mySeat ? 'You' : SEAT_NAMES[asker]} asked: waiting for the answer.`;
});

function answer() {
  close();
  emit('explain', props.index);
}

function chatAbout() {
  close();
  emit('chat', props.index);
}
</script>

<style scoped>
.call-cell {
  position: relative;
  display: inline-flex;
}

.call-button {
  display: inline-flex;
  align-items: center;
  gap: 0;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.call-button:hover :deep(.chip),
.call-button[aria-expanded='true'] :deep(.chip) {
  box-shadow: inset 0 0 0 2px var(--bridge-control);
}

.call-button:focus-visible {
  outline: 2px solid var(--ion-color-primary);
  outline-offset: 2px;
}

/* Alerted: an amber ring and "!"; asked about: a blue ring and "?". The
   marks sit inside the chip's ring, after the call. */
.call-button.alerted,
.call-button.questioned {
  padding-right: 4px;
  background: var(--bridge-chip);
}

.call-button.alerted {
  box-shadow: inset 0 0 0 2px var(--bridge-amber);
}

.call-button.questioned {
  box-shadow: inset 0 0 0 2px var(--bridge-question);
}

.call-button.alerted.questioned {
  box-shadow:
    inset 0 0 0 2px var(--bridge-amber),
    0 0 0 2px var(--bridge-question);
}

.call-button.alerted :deep(.chip),
.call-button.questioned :deep(.chip) {
  background: transparent;
  box-shadow: none;
}

.mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  margin-left: 2px;
  border-radius: 50%;
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 1;
}

.alert-mark {
  background: var(--bridge-amber);
  color: var(--bridge-on-amber);
}

.question-mark {
  background: var(--bridge-question);
  color: var(--bridge-surface);
}

.call-popup {
  position: absolute;
  top: 100%;
  left: 50%;
  z-index: 20;
  padding-top: 4px;
  transform: translateX(calc(-50% + var(--nudge, 0px)));
}

/* The dark card of the component kit. Plain text only. */
.call-box {
  width: max-content;
  max-width: 260px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--bridge-popup);
  color: var(--bridge-on-popup);
  box-shadow: 0 8px 24px var(--bridge-shadow-strong);
  text-align: left;
  font-size: 0.9rem;
  line-height: 1.4;
  white-space: normal;
  overflow-wrap: anywhere;
}

.call-box p {
  margin: 0 0 6px;
}

.call-title {
  font-weight: 700;
}

.alert-text,
.no-alert,
.question-text {
  color: var(--bridge-on-popup-muted);
}

.popup-action {
  display: block;
  width: 100%;
  min-height: 40px;
  margin-top: 8px;
  padding: 0 12px;
  border: 0;
  border-radius: 9px;
  background: var(--bridge-popup-action);
  color: var(--bridge-on-popup-action);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
}

.popup-action.ask-in-chat {
  background: var(--bridge-popup-button);
  color: var(--bridge-on-popup);
}

.popup-action:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
