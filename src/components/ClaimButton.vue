<template>
  <!-- Claim in the table's bottom-right corner on the play page (#171): a
       small light button on the navy, its tap area 44 px tall all the same.
       After a refused claim nobody claims until the next card (bb#115): it
       reads "Claim · locked" in grey and, tapped or hovered, says why in a
       small pop-up above it (usePopover), which is also its description for
       a screen reader. `disabled` while a card or a claim is in flight. -->
  <span
    ref="root"
    class="claim-peek"
    @pointerenter="locked && hover(true, $event)"
    @pointerleave="hover(false, $event)"
  >
    <button
      ref="button"
      type="button"
      class="claim-button"
      :class="{ 'is-locked': locked }"
      :disabled="disabled"
      :aria-disabled="locked ? 'true' : undefined"
      :aria-describedby="locked ? noteId : undefined"
      :aria-expanded="locked ? open : undefined"
      @click="tap"
    >
      {{ locked ? 'Claim · locked' : 'Claim' }}
    </button>
    <!-- Always there while locked, so the button's aria-describedby finds
         it; shown only while open. -->
    <span
      v-if="locked"
      v-show="open"
      :id="noteId"
      ref="popup"
      class="claim-locked-note"
      role="tooltip"
      :style="{ '--nudge': `${nudge}px`, '--drop': `${drop}px` }"
    >
      <span class="claim-locked-box">{{ CLAIM_LOCKED_TEXT }}</span>
    </span>
  </span>
</template>

<script setup lang="ts">
import { useId, watch } from 'vue';
import { usePopover } from '@/composables/usePopover';
import { CLAIM_LOCKED_TEXT } from '@/utils/claim';

const props = withDefaults(defineProps<{ locked?: boolean; disabled?: boolean }>(), {
  locked: false,
  disabled: false,
});

const emit = defineEmits<{ claim: [] }>();

const { root, button, popup, open, nudge, drop, hover, toggle, close } = usePopover();
const noteId = `claim-locked-${useId()}`;

// Locked, a tap says why; else it claims.
function tap() {
  if (props.locked) {
    toggle();
  } else {
    emit('claim');
  }
}

// The next card unlocks it: nothing left to explain.
watch(
  () => props.locked,
  (locked) => {
    if (!locked) {
      close();
    }
  },
);
</script>

<style scoped>
.claim-peek {
  position: relative;
  display: inline-flex;
}

/* 36 px to see, 44 px to tap (the ::before reaches 4 px past each edge). */
.claim-button {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  min-height: 36px;
  padding: 2px 12px;
  border: 0;
  border-radius: var(--bridge-radius-button);
  background: var(--bridge-surface);
  color: var(--bridge-ink);
  font: inherit;
  font-size: 0.875rem;
  font-weight: 700;
  line-height: 1.15;
  cursor: pointer;
}

.claim-button::before {
  content: '';
  position: absolute;
  inset: -4px;
}

.claim-button:focus-visible {
  outline: 2px solid var(--bridge-amber);
  outline-offset: 2px;
}

/* Refused, until the next card: grey on the navy. */
.claim-button.is-locked {
  background: var(--bridge-on-table-chip);
  color: var(--bridge-on-table-muted);
  cursor: help;
}

.claim-button:disabled {
  opacity: 0.6;
  cursor: default;
}

/* Above the button, over the table; kept clear of the screen's edges. */
.claim-locked-note {
  position: absolute;
  bottom: 100%;
  left: 50%;
  z-index: 30;
  box-sizing: border-box;
  width: min(240px, calc(100vw - 16px));
  padding-bottom: 8px;
  transform: translate(calc(-50% + var(--nudge, 0px)), var(--drop, 0px));
}

.claim-locked-box {
  display: block;
  padding: 10px 12px;
  border-radius: var(--bridge-radius-button);
  background: var(--bridge-popup);
  color: var(--bridge-on-popup);
  box-shadow: 0 4px 16px var(--bridge-shadow-strong);
  font-size: 0.875rem;
  font-weight: 400;
  line-height: 1.35;
  text-align: left;
}
</style>
