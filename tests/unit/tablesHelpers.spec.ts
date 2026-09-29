import { describe, expect, test } from 'vitest'
import { seatsOf } from '@/services/tables'
import type { Seat, Table } from '@/services/tables'

// Seats are given as seat -> user id, so a test can put a specific person
// in a specific chair without building the whole payload by hand.
function makeTable(seats: Partial<Record<Seat, number>> = {}): Table {
  const taken = Object.entries(seats) as [Seat, number][]
  return {
    id: 1,
    name: 'Table 1',
    created_by: 1,
    moderated_by: 1,
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
        description: null,
      },
    })),
    free_seats: (['N', 'E', 'S', 'W'] as Seat[]).filter((s) => !(s in seats)),
    can_manage: false,
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
