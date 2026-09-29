import { describe, expect, test } from 'vitest'
import type { AuctionCall, Bid, Strain } from '@/services/game'
import type { Seat } from '@/services/tables'
import {
  auctionColumns,
  auctionRows,
  callLabel,
  callName,
  canDouble,
  canRedouble,
  contractLabel,
  isLegalCall,
  lastBid,
} from '@/utils/auction'

// Ids run against the rank on purpose (7NT is 1, P is 38): the rules must
// never look at them.
const CODES = ['P', 'X', 'XX']
for (const level of [1, 2, 3, 4, 5, 6, 7]) {
  for (const strain of ['C', 'D', 'H', 'S', 'NT']) {
    CODES.push(`${level}${strain}`)
  }
}

function bid(call: string): Bid {
  const id = 38 - CODES.indexOf(call)
  const match = /^(\d)(C|D|H|S|NT)$/.exec(call)
  return match
    ? { id, call, level: Number(match[1]), strain: match[2] as Strain, special: false }
    : { id, call, level: null, strain: null, special: true }
}

// 'N 1H, E P, S X' → the auction so far.
function calls(written: string): AuctionCall[] {
  if (!written) {
    return []
  }
  return written.split(', ').map((made) => {
    const [seat, call] = made.split(' ')
    return { seat: seat as Seat, bid: bid(call) }
  })
}

function legal(written: string, seat: Seat, call: string) {
  return isLegalCall(bid(call), calls(written), seat)
}

describe('bids', () => {
  test('anything goes before the first bid', () => {
    expect(legal('', 'N', '1C')).toBe(true)
    expect(legal('N P, E P', 'S', '7NT')).toBe(true)
  })

  test('a bid must outrank the last one: level first, then ♣ < ♦ < ♥ < ♠ < NT', () => {
    expect(legal('N 1H', 'E', '1H')).toBe(false)
    expect(legal('N 1H', 'E', '1D')).toBe(false)
    expect(legal('N 1H', 'E', '1S')).toBe(true)
    expect(legal('N 1H', 'E', '1NT')).toBe(true)
    expect(legal('N 1NT', 'E', '2C')).toBe(true)
    expect(legal('N 2C', 'E', '1NT')).toBe(false)
  })

  test('the last bid counts, not the last call', () => {
    expect(lastBid(calls('N 1H, E X, S 2C, W P'))?.bid.call).toBe('2C')
    expect(legal('N 1H, E X, S 2C, W P', 'N', '1S')).toBe(false)
    expect(legal('N 1H, E X, S 2C, W P', 'N', '2D')).toBe(true)
  })

  test('pass is always legal', () => {
    expect(legal('', 'N', 'P')).toBe(true)
    expect(legal('N 7NT, E X, S XX', 'W', 'P')).toBe(true)
  })
})

describe('double', () => {
  test('needs a bid to double', () => {
    expect(canDouble(calls(''), 'N')).toBe(false)
    expect(canDouble(calls('N P, E P'), 'S')).toBe(false)
  })

  test("an opponent's bid may be doubled, even through passes", () => {
    expect(legal('N 1H', 'E', 'X')).toBe(true)
    // GAME-RULES §4: N 1♥, E P, S P, West may still double 1♥.
    expect(legal('N 1H, E P, S P', 'W', 'X')).toBe(true)
  })

  test("never your own side's bid", () => {
    expect(legal('N 1H, E P', 'S', 'X')).toBe(false)
    expect(legal('N 1H, E P, S P, W P', 'N', 'X')).toBe(false)
  })

  test('a doubled bid cannot be doubled again', () => {
    expect(legal('N 1H, E X, S P', 'W', 'X')).toBe(false)
    expect(legal('N 1H, E X, S XX', 'W', 'X')).toBe(false)
  })
})

describe('redouble', () => {
  test("only on an opponent's double", () => {
    expect(legal('N 1H', 'E', 'XX')).toBe(false)
    expect(legal('N 1H, E X', 'S', 'XX')).toBe(true)
    expect(legal('N 1H, E X', 'N', 'XX')).toBe(true)
  })

  test('passes in between do not matter', () => {
    // GAME-RULES §4: N 1♥, E X, S P, W P, N XX is legal.
    expect(legal('N 1H, E X, S P, W P', 'N', 'XX')).toBe(true)
  })

  test("never your own side's double", () => {
    expect(legal('N 1H, E X, S P', 'W', 'XX')).toBe(false)
  })

  test('cannot be redoubled twice', () => {
    expect(canRedouble(calls('N 1H, E X, S XX, W P'), 'N')).toBe(false)
    expect(canRedouble(calls('N 1H, E X, S XX, W P'), 'E')).toBe(false)
  })
})

describe('a new bid clears X and XX', () => {
  test('after a double', () => {
    const auction = 'N 1H, E X, S 2C'
    expect(legal(auction, 'W', 'X')).toBe(true)
    expect(legal(auction, 'W', 'XX')).toBe(false)
  })

  test('after a redouble', () => {
    const auction = 'N 1H, E X, S XX, W 2C'
    expect(legal(auction, 'N', 'X')).toBe(true)
    expect(legal(auction, 'N', 'XX')).toBe(false)
    expect(legal(auction, 'E', 'X')).toBe(false)
  })
})

describe('labels', () => {
  test('calls as players write them', () => {
    expect(['1C', '3D', '4H', '6S', '7NT', 'P', 'X', 'XX'].map((c) => callLabel(bid(c)))).toEqual([
      '1♣',
      '3♦',
      '4♥',
      '6♠',
      '7NT',
      'Pass',
      'X',
      'XX',
    ])
  })

  test('calls spoken out', () => {
    expect(['1S', '2H', '3NT', 'P', 'X', 'XX'].map((c) => callName(bid(c)))).toEqual([
      '1 spade',
      '2 hearts',
      '3 no trump',
      'Pass',
      'Double',
      'Redouble',
    ])
  })

  test('contracts', () => {
    expect(contractLabel({ bid: bid('4S'), doubled: 0, declarer: 'N', dummy: 'S' })).toBe('4♠ by North')
    expect(contractLabel({ bid: bid('4S'), doubled: 1, declarer: 'N', dummy: 'S' })).toBe(
      '4♠ doubled by North',
    )
    expect(contractLabel({ bid: bid('3NT'), doubled: 2, declarer: 'W', dummy: 'E' })).toBe(
      '3NT redoubled by West',
    )
  })
})

describe('the auction grid', () => {
  test('columns follow the table: the viewer last, so South sees W N E S', () => {
    expect(auctionColumns('S')).toEqual(['W', 'N', 'E', 'S'])
    expect(auctionColumns('N')).toEqual(['E', 'S', 'W', 'N'])
    expect(auctionColumns('E')).toEqual(['S', 'W', 'N', 'E'])
    expect(auctionColumns(null)).toEqual(['W', 'N', 'E', 'S'])
  })

  test("the first row starts in the dealer's column", () => {
    const rows = auctionRows(calls('E 1H, S P, W 2C, N P, E P'), 'E', ['W', 'N', 'E', 'S'])

    expect(rows.map((row) => row.map((cell) => (cell.kind === 'call' ? cell.bid.call : cell.kind)))).toEqual([
      ['empty', 'empty', '1H', 'P'],
      ['2C', 'P', 'P', 'empty'],
    ])
    expect(rows[0][2]).toMatchObject({ seat: 'E' })
  })

  test('marks where the next call goes', () => {
    const rows = auctionRows(calls('W P, N 1C, E P'), 'W', ['W', 'N', 'E', 'S'], 'S')

    expect(rows).toHaveLength(1)
    expect(rows[0][3]).toEqual({ kind: 'next', seat: 'S' })
  })

  test('a dealer on the left starts a new row with the next call waited on', () => {
    const rows = auctionRows([], 'W', ['W', 'N', 'E', 'S'], 'W')

    expect(rows).toEqual([[{ kind: 'next', seat: 'W' }, { kind: 'empty' }, { kind: 'empty' }, { kind: 'empty' }]])
  })
})
