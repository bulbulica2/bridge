import { describe, expect, test } from 'vitest'
import type { ScreenSide } from '@/utils/cards'
import { INDEX_AREA, TRICK_HEIGHT, TRICK_SLOTS, TRICK_WIDTH } from '@/utils/trickLayout'

// The trick's geometry (#201), in TrickArea's units: x in card widths, y in
// card heights.
type Rect = { left: number; top: number; right: number; bottom: number }

const SIDES: ScreenSide[] = ['top', 'left', 'right', 'bottom']

function cardAt(side: ScreenSide): Rect {
  const { x, y } = TRICK_SLOTS[side]
  return { left: x, top: y, right: x + 1, bottom: y + 1 }
}

function indexAt(side: ScreenSide): Rect {
  const { x, y } = TRICK_SLOTS[side]
  return { left: x, top: y, right: x + INDEX_AREA.width, bottom: y + INDEX_AREA.height }
}

// Overlapping by more than touching edges.
function overlaps(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

function orders(items: ScreenSide[]): ScreenSide[][] {
  if (items.length <= 1) {
    return [items]
  }
  return items.flatMap((first) => orders(items.filter((x) => x !== first)).map((rest) => [first, ...rest]))
}

describe('the trick layout', () => {
  test('every card lies inside the box', () => {
    for (const side of SIDES) {
      const card = cardAt(side)
      expect(card.left).toBeGreaterThanOrEqual(0)
      expect(card.top).toBeGreaterThanOrEqual(0)
      expect(card.right).toBeLessThanOrEqual(TRICK_WIDTH + 1e-9)
      expect(card.bottom).toBeLessThanOrEqual(TRICK_HEIGHT + 1e-9)
    }
  })

  test('the box leaves more room than two cards each way', () => {
    expect(TRICK_WIDTH).toBeGreaterThan(2)
    expect(TRICK_HEIGHT).toBeGreaterThan(2)
  })

  test('in any of the 24 orders of play, no later card covers an earlier card\'s rank and suit', () => {
    const all = orders(SIDES)
    expect(all).toHaveLength(24)
    for (const order of all) {
      order.forEach((under, i) => {
        for (const over of order.slice(i + 1)) {
          expect(overlaps(cardAt(over), indexAt(under)), `${over} over ${under} in ${order.join(' ')}`).toBe(false)
        }
      })
    }
  })

  test('the cards still touch or overlap a little: top with left, bottom with right', () => {
    expect(overlaps(cardAt('top'), cardAt('left'))).toBe(true)
    expect(overlaps(cardAt('bottom'), cardAt('right'))).toBe(true)
    expect(overlaps(cardAt('top'), cardAt('bottom'))).toBe(false)
    expect(overlaps(cardAt('left'), cardAt('right'))).toBe(false)
  })
})
