import type { ScreenSide } from '@/utils/cards';

// Where an empty seat's menu (SeatMenu, #192) opens: next to the plate that
// was tapped, pointing at it, on the table's side of it, so it lies over the
// table: below the top seat, above the bottom seat, to the inside of a side
// seat (West's to its right, East's to its left). A side seat's menu that
// wouldn't fit beside the plate on a narrow screen opens below it instead.
// Along the plate it is centred, kept `SEAT_MENU_EDGE` px off the screen's
// edges, its arrow still on the plate's centre.

export type SeatMenuPlacement = 'below' | 'above' | 'right' | 'left';

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SeatMenuPosition {
  placement: SeatMenuPlacement;
  // The menu's top-left corner, in px from the layer's (the table's).
  left: number;
  top: number;
  // The arrow's centre along the menu's edge facing the plate, in px from
  // the menu's left (below, above) or top (right, left).
  arrow: number;
}

// Kept off the screen's edges; the room between plate and menu, the arrow's.
export const SEAT_MENU_EDGE = 8;
export const SEAT_MENU_GAP = 10;
// The arrow stays this far from the menu's corners (they are rounded).
const ARROW_INSET = 16;

const PLACEMENT: Record<ScreenSide, SeatMenuPlacement> = {
  top: 'below',
  bottom: 'above',
  left: 'right',
  right: 'left',
};

export function seatMenuPlacement(side: ScreenSide): SeatMenuPlacement {
  return PLACEMENT[side];
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

// The menu's place for a plate (`anchor`) on `side`, the menu `menu` px big,
// all boxes in the screen's px; `layer` is the box the menu is placed in
// (the table), `screen` the screen's size.
export function placeSeatMenu(
  anchor: Box,
  menu: { width: number; height: number },
  side: ScreenSide,
  layer: { left: number; top: number },
  screen: { width: number; height: number },
): SeatMenuPosition {
  let placement = seatMenuPlacement(side);
  const centreX = anchor.left + anchor.width / 2;
  const centreY = anchor.top + anchor.height / 2;
  const fitsRight = anchor.left + anchor.width + SEAT_MENU_GAP + menu.width <= screen.width - SEAT_MENU_EDGE;
  const fitsLeft = anchor.left - SEAT_MENU_GAP - menu.width >= SEAT_MENU_EDGE;
  if ((placement === 'right' && !fitsRight) || (placement === 'left' && !fitsLeft)) {
    placement = 'below';
  }

  let left: number;
  let top: number;
  let arrow: number;
  if (placement === 'below' || placement === 'above') {
    left = clamp(centreX - menu.width / 2, SEAT_MENU_EDGE, screen.width - SEAT_MENU_EDGE - menu.width);
    top = placement === 'below' ? anchor.top + anchor.height + SEAT_MENU_GAP : anchor.top - SEAT_MENU_GAP - menu.height;
    arrow = centreX - left;
    arrow = clamp(arrow, ARROW_INSET, Math.max(ARROW_INSET, menu.width - ARROW_INSET));
  } else {
    left = placement === 'right' ? anchor.left + anchor.width + SEAT_MENU_GAP : anchor.left - SEAT_MENU_GAP - menu.width;
    top = clamp(centreY - menu.height / 2, SEAT_MENU_EDGE, screen.height - SEAT_MENU_EDGE - menu.height);
    arrow = clamp(centreY - top, ARROW_INSET, Math.max(ARROW_INSET, menu.height - ARROW_INSET));
  }
  return { placement, left: left - layer.left, top: top - layer.top, arrow };
}
