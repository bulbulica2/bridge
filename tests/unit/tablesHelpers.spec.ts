import { describe, expect, test } from 'vitest'
import { canManage, seatsOf } from '@/services/tables'
import type { Seat, Table } from '@/services/tables'

// Seats are given as seat -> user id, so a test can put a specific person
// in a specific chair without building the whole payload by hand.
function makeTable(
  seats: Partial<Record<Seat, number>> = {},
  { createdBy = 1, moderatedBy = 1 }: { createdBy?: number | null; moderatedBy?: number | null } = {},
): Table {
  const taken = Object.entries(seats) as [Seat, number][]
  return {
    id: 1,
    name: 'Table 1',
    created_by: createdBy,
    moderated_by: moderatedBy,
    board_id: null,
    created_at: '2026-09-20T10:00:00.000000Z',
    updated_at: '2026-09-20T10:00:00.000000Z',
    seats: taken.map(([seat, userId], i) => ({
      id: i + 1,
      table_id: 1,
      user_id: userId,
      seat,
      user: {
        id: userId,
        name: `User ${userId}`,
        username: `user${userId}`,
        email: `user${userId}@example.com`,
      },
    })),
    free_seats: (['N', 'E', 'S', 'W'] as Seat[]).filter((s) => !(s in seats)),
  }
}

describe('seatsOf', () => {
  test('always returns the four seats in N, E, S, W order', () => {
    const seats = seatsOf(makeTable({ S: 7 }))

    expect(seats.map((s) => s.seat)).toEqual(['N', 'E', 'S', 'W'])
  })

  test('fills the seats the backend did not send with null', () => {
    const seats = seatsOf(makeTable({ N: 3, E: 4 }))

    expect(seats.map((s) => s.user?.id ?? null)).toEqual([3, 4, null, null])
  })
})

describe('canManage', () => {
  test('the moderator manages the table', () => {
    expect(canManage(makeTable({ N: 5 }, { createdBy: 9, moderatedBy: 5 }), 5)).toBe(true)
  })

  test('the creator manages it while still seated', () => {
    expect(canManage(makeTable({ N: 5 }, { createdBy: 5, moderatedBy: 9 }), 5)).toBe(true)
  })

  test('a creator who left no longer manages it', () => {
    expect(canManage(makeTable({ N: 9 }, { createdBy: 5, moderatedBy: 9 }), 5)).toBe(false)
  })

  test('an unrelated player does not manage it', () => {
    expect(canManage(makeTable({ N: 5, E: 6 }, { createdBy: 5, moderatedBy: 5 }), 6)).toBe(false)
  })

  test('a logged-out user manages nothing', () => {
    expect(canManage(makeTable({ N: 5 }, { createdBy: 5, moderatedBy: 5 }), null)).toBe(false)
  })
})
