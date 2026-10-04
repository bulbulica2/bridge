import { ref } from 'vue';
import { menuController } from '@ionic/vue';

// The side menu stays on screen next to the page from `md` (768 px) up, in
// App.vue's ion-split-pane; below that it is the slide-in overlay. From `md`
// up the header's menu button collapses it and brings it back, and that
// choice is kept per browser. Storage may be missing or refuse: then the
// menu is simply open, and a collapse lasts until the next reload.
export const MENU_PINNED_KEY = 'bridge.menuPinned';

// Ionic's `md` breakpoint, the split pane's `when`.
export const PINNED_FROM = 'md';
const WIDE_QUERY = '(min-width: 768px)';

// Open unless this browser asked for it collapsed.
export function readMenuPinned(): boolean {
  try {
    return localStorage.getItem(MENU_PINNED_KEY) !== 'false';
  } catch {
    return true;
  }
}

export const menuPinned = ref(readMenuPinned());

export function setMenuPinned(pinned: boolean) {
  menuPinned.value = pinned;
  try {
    localStorage.setItem(MENU_PINNED_KEY, String(pinned));
  } catch {
    // Not kept: the menu is open again after a reload.
  }
}

// Whether the split pane may show the menu beside the page at this width.
function wideScreen(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(WIDE_QUERY).matches;
}

// The header's menu button: on a wide screen it collapses or brings back the
// pinned menu, on a phone it slides the overlay in or out, as it always did.
export async function toggleMenu() {
  if (wideScreen()) {
    setMenuPinned(!menuPinned.value);
    return;
  }
  await menuController.toggle();
}
