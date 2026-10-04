<template>
  <!-- One call of the auction grid. An alerted call stands out (amber, with
       a "!") and its explanation pops up the way the last trick does:
       hovering with a mouse, or a tap until a tap outside or Escape. While
       the board lasts, any opponent's call also pops up an Ask button, and
       a call of ours an opponent asked about an Answer button. Any other
       call is just its label. -->
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
      :class="{ alerted: !!call.alert, questioned: !!call.question }"
      :aria-label="buttonLabel"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="popupId"
      @click="toggle"
    >
      <CallLabel :bid="call.bid" />
      <span v-if="call.alert" class="mark alert-mark" aria-hidden="true">!</span>
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
        <p v-if="call.alert" class="alert-text">
          <template v-if="mine">You alerted: </template>{{ alertText(call.alert) }}
        </p>
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
  <CallLabel v-else :bid="call.bid" />
</template>

<script setup lang="ts">
import { computed, useId } from 'vue';
import CallLabel from '@/components/CallLabel.vue';
import { usePopover } from '@/composables/usePopover';
import type { AuctionCall } from '@/services/game';
import type { Seat } from '@/services/tables';
import { SEAT_NAMES, callLabel, callName } from '@/utils/auction';
import { alertText, isOpponent } from '@/utils/alerts';

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
  }>(),
  { live: false, busy: false },
);

const emit = defineEmits<{ ask: [index: number]; explain: [index: number] }>();

const { root, button, popup, open, nudge, hover, toggle, close } = usePopover();
const popupId = `call-${useId()}`;

const mine = computed(() => props.mySeat !== null && props.call.seat === props.mySeat);
const opponents = computed(() => isOpponent(props.call.seat, props.mySeat));
const canAsk = computed(() => props.live && opponents.value && !props.call.question);
const canAnswer = computed(() => props.live && mine.value && !!props.call.question);
const interactive = computed(
  () => !!props.call.alert || (props.live && opponents.value) || canAnswer.value,
);

const title = computed(() =>
  mine.value
    ? `Your ${callLabel(props.call.bid)}`
    : `${callLabel(props.call.bid)} by ${SEAT_NAMES[props.call.seat]}`,
);

const buttonLabel = computed(() => {
  const notes = [props.call.alert && 'alerted', props.call.question && 'asked about'];
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
</script>

<style scoped>
.call-cell {
  position: relative;
  display: inline-flex;
}

.call-button {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 32px;
  justify-content: center;
  padding: 1px 6px;
  border: 1px dashed transparent;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.call-button:hover,
.call-button[aria-expanded='true'] {
  border-color: var(--ion-color-step-300, #b3b3b3);
}

.call-button:focus-visible {
  outline: 2px solid var(--ion-color-primary, #3880ff);
  outline-offset: 2px;
}

/* An alert stands out in amber, translucent so it reads in light and dark
   mode alike, and never in the red and green of vulnerability. */
.call-button.alerted {
  border: 1px solid #e0a800;
  background: rgba(255, 193, 7, 0.28);
}

.mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  font-size: 0.65rem;
  font-weight: 800;
  line-height: 1;
}

.alert-mark {
  background: #e0a800;
  color: #1a1a1a;
}

.question-mark {
  background: var(--ion-color-medium, #636469);
  color: var(--ion-color-medium-contrast, #fff);
}

.call-popup {
  position: absolute;
  top: 100%;
  left: 50%;
  z-index: 20;
  padding-top: 4px;
  transform: translateX(calc(-50% + var(--nudge, 0px)));
}

.call-box {
  width: max-content;
  max-width: 240px;
  padding: 8px 10px;
  border: 1px solid var(--ion-color-step-150, #e0e0e0);
  border-radius: 8px;
  background: var(--ion-background-color, #fff);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
  text-align: left;
  font-size: 0.85rem;
  white-space: normal;
  overflow-wrap: anywhere;
}

.call-box p {
  margin: 0 0 4px;
}

.call-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--ion-color-medium);
}

.no-alert,
.question-text {
  color: var(--ion-color-medium);
}

.popup-action {
  display: block;
  width: 100%;
  margin-top: 6px;
  padding: 4px 8px;
  border: 1px solid var(--ion-color-primary, #3880ff);
  border-radius: 999px;
  background: var(--ion-background-color, #fff);
  color: var(--ion-color-primary, #3880ff);
  font: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
}

.popup-action:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
