<template>
  <!-- An empty seat's menu (#192): a small dropdown opened at the plate that
       was tapped, its arrow pointing at it, on the table's side of it (see
       placeSeatMenu): Sit here (Move here when we sit at this table
       already), and for a manager Seat a player… and Add robot. Laid in its
       own layer over the table (BridgeTable's `menu` slot), so the table
       never moves. A tap outside, Escape, Tab or a pick closes it; Escape
       and a pick put the focus back on the plate. -->
  <div ref="layer" class="seat-menu-layer">
    <div
      v-if="seat"
      ref="panel"
      class="seat-menu"
      :class="[`seat-menu-${position.placement}`, { 'is-placed': placed }]"
      :style="{ left: `${position.left}px`, top: `${position.top}px`, '--arrow': `${position.arrow}px` }"
      :data-seat="seat"
      @keydown="onKey"
    >
      <span class="seat-menu-arrow" aria-hidden="true" />
      <p :id="titleId" class="seat-menu-title">{{ SEAT_NAMES[seat] }} is free</p>
      <div role="menu" class="seat-menu-list" :aria-labelledby="titleId">
        <button type="button" role="menuitem" class="seat-menu-item seat-menu-sit" @click="pick('sit')">
          {{ moveHere ? 'Move here' : 'Sit here' }}
        </button>
        <template v-if="canManage">
          <button type="button" role="menuitem" class="seat-menu-item seat-menu-player" @click="pick('player')">
            Seat a player…
          </button>
          <button type="button" role="menuitem" class="seat-menu-item seat-menu-robot" @click="pick('robot')">
            Add robot
          </button>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import type { Seat } from '@/services/tables';
import { SEAT_NAMES } from '@/utils/auction';
import type { ScreenSide } from '@/utils/cards';
import { placeSeatMenu, seatMenuPlacement } from '@/utils/seatMenu';
import type { SeatMenuPosition } from '@/utils/seatMenu';

const props = withDefaults(
  defineProps<{
    // The empty seat it is open for; null keeps it closed.
    seat: Seat | null;
    // The plate tapped, and the side of the table it is drawn on.
    anchor: HTMLElement | null;
    side: ScreenSide;
    // We sit at this table already: taking the seat is a seat change.
    moveHere?: boolean;
    // A manager also seats somebody else or a robot there.
    canManage?: boolean;
  }>(),
  { moveHere: false, canManage: false },
);

const emit = defineEmits<{
  sit: [seat: Seat];
  player: [seat: Seat];
  robot: [seat: Seat];
  close: [];
}>();

const layer = ref<HTMLElement | null>(null);
const panel = ref<HTMLElement | null>(null);
const titleId = `seat-menu-${useId()}`;
// Hidden until measured and placed, so it never shows at the wrong place.
const placed = ref(false);
const position = ref<SeatMenuPosition>({ placement: seatMenuPlacement(props.side), left: 0, top: 0, arrow: 0 });

function items(): HTMLElement[] {
  return Array.from(panel.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
}

function place() {
  if (!panel.value || !layer.value || !props.anchor) {
    return;
  }
  const anchor = props.anchor.getBoundingClientRect();
  const box = layer.value.getBoundingClientRect();
  const menu = panel.value.getBoundingClientRect();
  position.value = placeSeatMenu(
    anchor,
    { width: menu.width, height: menu.height },
    props.side,
    box,
    { width: document.documentElement.clientWidth, height: window.innerHeight },
  );
  placed.value = true;
}

function close(refocus: boolean) {
  const anchor = props.anchor;
  emit('close');
  if (refocus && anchor?.isConnected) {
    anchor.focus();
  }
}

function pick(action: 'sit' | 'player' | 'robot') {
  const seat = props.seat!;
  if (action === 'sit') {
    emit('sit', seat);
  } else if (action === 'player') {
    emit('player', seat);
  } else {
    emit('robot', seat);
  }
  close(true);
}

// The menu pattern's keys: up and down go round the options, Home and End
// to the first and last; Tab leaves the menu, which closes it.
function onKey(event: KeyboardEvent) {
  const list = items();
  const at = list.indexOf(document.activeElement as HTMLElement);
  const to: Record<string, number> = {
    ArrowDown: (at + 1) % list.length,
    ArrowUp: (at - 1 + list.length) % list.length,
    Home: 0,
    End: list.length - 1,
  };
  if (event.key in to) {
    event.preventDefault();
    list[to[event.key]].focus();
  } else if (event.key === 'Tab') {
    close(false);
  }
}

// A tap anywhere but the menu closes it; a tap on its own plate is left to
// the plate (the page closes it then), another seat's moves it there.
function onPointerDown(event: PointerEvent) {
  const target = event.target as Node;
  if (!panel.value?.contains(target) && !props.anchor?.contains(target)) {
    close(false);
  }
}

function onEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    close(true);
  }
}

function listen(on: boolean) {
  const method = on ? 'addEventListener' : 'removeEventListener';
  document[method]('pointerdown', onPointerDown as EventListener);
  document[method]('keydown', onEscape as EventListener);
  window[method]('resize', place);
}

// Opened (or moved to another seat): placed at its plate, then the focus
// goes to its first option.
watch(
  () => [props.seat, props.anchor] as const,
  async ([seat], [was]) => {
    if (!seat) {
      placed.value = false;
      listen(false);
      return;
    }
    if (!was) {
      listen(true);
    }
    placed.value = false;
    position.value = { ...position.value, placement: seatMenuPlacement(props.side) };
    await nextTick();
    place();
    items()[0]?.focus();
  },
);

onBeforeUnmount(() => listen(false));
</script>

<style scoped>
/* The table's whole box, under nothing that is tapped: only the menu in it
   takes taps. Above the table's corners (z-index 20). */
.seat-menu-layer {
  position: absolute;
  inset: 0;
  z-index: 40;
  pointer-events: none;
}

.seat-menu {
  position: absolute;
  box-sizing: border-box;
  width: max-content;
  min-width: 176px;
  max-width: calc(100vw - 16px);
  padding: 6px;
  border-radius: var(--bridge-radius-button);
  background: var(--bridge-surface);
  color: var(--bridge-ink);
  box-shadow: 0 8px 24px var(--bridge-shadow-strong);
  pointer-events: auto;
  text-align: left;
  visibility: hidden;
}

.seat-menu.is-placed {
  visibility: visible;
}

/* A square turned 45°, half of it out of the menu's edge facing the
   plate, at `--arrow` along that edge. */
.seat-menu-arrow {
  position: absolute;
  width: 12px;
  height: 12px;
  background: var(--bridge-surface);
  transform: rotate(45deg);
}

.seat-menu-below .seat-menu-arrow {
  top: -6px;
  left: calc(var(--arrow) - 6px);
}

.seat-menu-above .seat-menu-arrow {
  bottom: -6px;
  left: calc(var(--arrow) - 6px);
}

.seat-menu-right .seat-menu-arrow {
  left: -6px;
  top: calc(var(--arrow) - 6px);
}

.seat-menu-left .seat-menu-arrow {
  right: -6px;
  top: calc(var(--arrow) - 6px);
}

.seat-menu-title {
  position: relative;
  margin: 4px 10px 6px;
  color: var(--bridge-muted);
  font-size: 0.8rem;
  font-weight: 700;
}

.seat-menu-list {
  position: relative;
  display: flex;
  flex-direction: column;
}

.seat-menu-item {
  min-height: 44px;
  padding: 0 12px;
  border: 0;
  border-radius: 8px;
  background: none;
  color: inherit;
  font: inherit;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}

.seat-menu-item:hover,
.seat-menu-item:focus-visible {
  background: var(--bridge-action-tint);
}

.seat-menu-item:focus-visible {
  outline: 2px solid var(--bridge-amber);
  outline-offset: -2px;
}
</style>
