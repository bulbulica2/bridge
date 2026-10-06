import { describe, expect, test } from 'vitest'
import type { Strain } from '@/services/game'
import { contractScore } from '@/utils/result'

// Duplicate scoring (bridge_backend docs/GAME-RULES.md §6), from declarer's
// side: `tricks` is every trick declarer's side took.
const bid = (level: number, strain: Strain) => ({ level, strain })

describe('contractScore', () => {
  test('part-scores: trick points and 50, overtricks at the trick value', () => {
    expect(contractScore(bid(2, 'C'), 0, false, 8)).toBe(90)
    expect(contractScore(bid(2, 'C'), 0, false, 10)).toBe(130)
    expect(contractScore(bid(1, 'NT'), 0, true, 7)).toBe(90)
    expect(contractScore(bid(2, 'H'), 0, false, 9)).toBe(140)
    expect(contractScore(bid(3, 'D'), 0, true, 9)).toBe(110)
  })

  test('games: 300 not vulnerable, 500 vulnerable', () => {
    expect(contractScore(bid(4, 'S'), 0, false, 10)).toBe(420)
    expect(contractScore(bid(4, 'S'), 0, true, 10)).toBe(620)
    expect(contractScore(bid(4, 'S'), 0, true, 11)).toBe(650)
    expect(contractScore(bid(3, 'NT'), 0, false, 9)).toBe(400)
    expect(contractScore(bid(3, 'NT'), 0, true, 10)).toBe(630)
    expect(contractScore(bid(5, 'C'), 0, false, 11)).toBe(400)
  })

  test('slams: the small and grand slam bonuses on top of game', () => {
    expect(contractScore(bid(6, 'H'), 0, false, 12)).toBe(980)
    expect(contractScore(bid(6, 'H'), 0, true, 12)).toBe(1430)
    expect(contractScore(bid(6, 'NT'), 0, false, 13)).toBe(1020)
    expect(contractScore(bid(7, 'NT'), 0, false, 13)).toBe(1520)
    expect(contractScore(bid(7, 'C'), 0, true, 13)).toBe(2140)
  })

  test('doubled and redoubled: trick points ×2 / ×4, the insult, and overtricks by the 100', () => {
    // 2♥X: 120, game.
    expect(contractScore(bid(2, 'H'), 1, false, 8)).toBe(470)
    expect(contractScore(bid(2, 'H'), 1, false, 9)).toBe(570)
    expect(contractScore(bid(2, 'H'), 1, true, 9)).toBe(870)
    // 1♣X: 40, a part-score still.
    expect(contractScore(bid(1, 'C'), 1, false, 7)).toBe(140)
    expect(contractScore(bid(1, 'C'), 2, false, 7)).toBe(230)
    expect(contractScore(bid(1, 'C'), 2, false, 8)).toBe(430)
    expect(contractScore(bid(1, 'C'), 2, true, 8)).toBe(630)
    expect(contractScore(bid(4, 'S'), 1, true, 10)).toBe(790)
  })

  test('undertricks, undoubled: 50 or 100 each', () => {
    expect(contractScore(bid(4, 'S'), 0, false, 9)).toBe(-50)
    expect(contractScore(bid(4, 'S'), 0, false, 7)).toBe(-150)
    expect(contractScore(bid(4, 'S'), 0, true, 8)).toBe(-200)
  })

  test('undertricks, doubled: 100, 200, 200, then 300 not vulnerable; 200, then 300 vulnerable', () => {
    expect(contractScore(bid(3, 'NT'), 1, false, 8)).toBe(-100)
    expect(contractScore(bid(3, 'NT'), 1, false, 7)).toBe(-300)
    expect(contractScore(bid(3, 'NT'), 1, false, 6)).toBe(-500)
    expect(contractScore(bid(3, 'NT'), 1, false, 5)).toBe(-800)
    expect(contractScore(bid(3, 'NT'), 1, true, 8)).toBe(-200)
    expect(contractScore(bid(3, 'NT'), 1, true, 6)).toBe(-800)
  })

  test('undertricks, redoubled: twice the doubled', () => {
    expect(contractScore(bid(3, 'NT'), 2, false, 8)).toBe(-200)
    expect(contractScore(bid(3, 'NT'), 2, false, 5)).toBe(-1600)
    expect(contractScore(bid(3, 'NT'), 2, true, 7)).toBe(-1000)
  })
})
