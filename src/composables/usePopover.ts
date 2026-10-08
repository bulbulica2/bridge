import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

// A small pop-up next to a button, opened the way `LastTrickPopover` and the
// auction's alerted calls open theirs: a mouse hovering opens it and moving
// away closes it; a tap or a key (touch has no hover) opens it until a tap
// outside, the button again, or Escape. It stays clear of the screen's
// edges (`nudge`, in px sideways from where it opens: centred under the
// button, or one aligned to its right edge like the last trick's); a panel
// pinned on the right marked `data-right-edge` (the chat beside the table)
// counts as the right edge. One opening upward (a button low on the table)
// that would cross the screen's top comes down by `drop` px instead.
//
// Bind `root` on the element wrapping both button and pop-up (with
// `hover(true|false, $event)` on its pointerenter/pointerleave), `button` on
// the button (`toggle` on its click) and `popup` on the pop-up.
export function usePopover() {
  const root = ref<HTMLElement | null>(null);
  const button = ref<HTMLElement | null>(null);
  const popup = ref<HTMLElement | null>(null);

  const open = ref(false);
  // Opened by a mouse hovering: leaving closes it. A click pins it open.
  const byHover = ref(false);
  const nudge = ref(0);
  const drop = ref(0);
  const EDGE = 8;

  // Only a mouse hovers: a touch also sends pointerenter/leave around its
  // tap, which the click that follows handles instead.
  function hover(entering: boolean, event: PointerEvent) {
    if (event.pointerType !== 'mouse') {
      return;
    }
    if (entering && !open.value) {
      open.value = true;
      byHover.value = true;
    } else if (!entering && byHover.value) {
      open.value = false;
    }
  }

  function toggle() {
    if (open.value && byHover.value) {
      byHover.value = false;
      return;
    }
    open.value = !open.value;
    byHover.value = false;
  }

  function close() {
    open.value = false;
  }

  function onPointerDown(event: PointerEvent) {
    if (!root.value?.contains(event.target as Node)) {
      close();
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      const inside = root.value?.contains(document.activeElement);
      close();
      if (inside) {
        button.value?.focus();
      }
    }
  }

  function listen(on: boolean) {
    const method = on ? 'addEventListener' : 'removeEventListener';
    document[method]('pointerdown', onPointerDown as EventListener);
    document[method]('keydown', onKeyDown as EventListener);
  }

  function rightEdge() {
    const panel = document.querySelector('[data-right-edge]')?.getBoundingClientRect();
    return panel?.width ? panel.left : document.documentElement.clientWidth;
  }

  // Centred on the button, unless that would cross an edge of the screen.
  async function keepOnScreen() {
    nudge.value = 0;
    drop.value = 0;
    await nextTick();
    const box = popup.value?.getBoundingClientRect();
    if (!box || box.width === 0) {
      return;
    }
    const right = rightEdge() - EDGE;
    if (box.left < EDGE) {
      nudge.value = EDGE - box.left;
    } else if (box.right > right) {
      nudge.value = Math.max(right - box.right, EDGE - box.left);
    }
    if (box.top < EDGE) {
      drop.value = EDGE - box.top;
    }
  }

  watch(open, (isOpen) => {
    listen(isOpen);
    if (isOpen) {
      keepOnScreen();
    } else {
      byHover.value = false;
    }
  });

  onBeforeUnmount(() => listen(false));

  return { root, button, popup, open, nudge, drop, hover, toggle, close };
}
