import type { ScreenSide } from '@/utils/cards';

// Where the trick's four cards lie in the table's centre (#201), in cards:
// x in card widths, y in card heights, from the trick's top-left corner.
// TrickArea binds these, so the geometry spec checks what is drawn.
//
// A pinwheel: the top card is pushed left and the bottom one right, so the
// right card meets the top one edge to edge and the left card the bottom
// one. Only two corners overlap, top over left and bottom over right, each
// on a corner with no index. Whatever order the cards come in (the last
// one on top), no card covers another's rank and suit.
export const TRICK_WIDTH = 2.6;
export const TRICK_HEIGHT = 2.4;

export const TRICK_SLOTS: Record<ScreenSide, { x: number; y: number }> = {
  top: { x: 0.56, y: 0 },
  left: { x: 0, y: 0.7 },
  right: { x: TRICK_WIDTH - 1, y: 0.7 },
  bottom: { x: TRICK_WIDTH - 1 - 0.56, y: TRICK_HEIGHT - 1 },
};

// A card's corner index (rank over suit, see PlayingCard) with some room
// to spare, measured like the slots: a "10" over its suit ends about 0.45
// of a card's width in and 0.54 of its height down.
export const INDEX_AREA = { width: 0.52, height: 0.6 };
