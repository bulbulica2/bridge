import { describe, expect, test } from 'vitest'
import { canRemove, seatsOf } from '@/services/tables'
import type { Seat, Table } from '@/services/tables'

// Seats are given as seat -> user id, so a test can put a specific person
// in a specific chair without building the whole payload by hand. Ids from
// 100 up are robots.
function makeTable(seats: Partial<Record<Seat, number>> = {}): Table {
  const taken = Object.entries(seats) as [Seat, number][]
  return {
    id: 1,
    name: 'Table 1',
    created_by: 1,
    moderated_by: 1,
    board_id: null,
    unattended_since: null,
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
        is_robot: userId >= 100,
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

describe('canRemove', () => {
  const since = '2026-10-01T10:00:00.000000Z'

  function seated(table: Table, id: number) {
    return table.seats.find((s) => s.user_id === id)!.user
  }

  test('a manager may remove anyone, robot or person', () => {
    const table = { ...makeTable({ N: 1, E: 2, S: 100 }), can_manage: true }

    expect(canRemove(table, seated(table, 2))).toBe(true)
    expect(canRemove(table, seated(table, 100))).toBe(true)
  })

  test('anyone else may not, while a person sits there', () => {
    const table = makeTable({ N: 1, E: 100 })

    expect(canRemove(table, seated(table, 1))).toBe(false)
    expect(canRemove(table, seated(table, 100))).toBe(false)
  })

  test('anyone may remove a robot from an unattended table', () => {
    const table = { ...makeTable({ E: 100, S: 101 }), moderated_by: null, unattended_since: since }

    expect(canRemove(table, seated(table, 100))).toBe(true)
  })
})
