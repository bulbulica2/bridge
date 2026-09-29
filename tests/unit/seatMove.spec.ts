import { describe, expect, test } from 'vitest'
import { moveConsequences } from '@/utils/seatMove'
import type { Seat, Table } from '@/services/tables'

// Seats are given as seat -> user id.
function makeTable(
  seats: Partial<Record<Seat, number>>,
  { moderatedBy = 1, boardId = null }: { moderatedBy?: number; boardId?: number | null } = {},
): Table {
  const taken = Object.entries(seats) as [Seat, number][]
  return {
    id: 4,
    name: 'Friday club',
    created_by: 1,
    moderated_by: moderatedBy,
    board_id: boardId,
    created_at: '2026-09-20T10:00:00.000000Z',
    updated_at: '2026-09-20T10:00:00.000000Z',
    seats: taken.map(([seat, userId], i) => ({
      id: i + 1,
      table_id: 4,
      user_id: userId,
      seat,
      user: { id: userId, name: `User ${userId}`, username: `user${userId}`, description: null },
    })),
    free_seats: (['N', 'E', 'S', 'W'] as Seat[]).filter((s) => !(s in seats)),
    can_manage: false,
  }
}

describe('moveConsequences', () => {
  test('always names the seat given up', () => {
    const lines = moveConsequences(makeTable({ N: 1, E: 2 }, { moderatedBy: 2 }), 1)

    expect(lines).toEqual(['You give up seat N at Friday club for good.'])
  })

  test('warns that the last player moving away deletes the table', () => {
    const lines = moveConsequences(makeTable({ S: 1 }), 1)

    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('will be deleted')
  })

  test('warns that the manager role is handed on', () => {
    const lines = moveConsequences(makeTable({ N: 1, E: 2 }), 1)

    expect(lines[1]).toContain('role passes')
  })

  test('warns that a board in progress is abandoned', () => {
    const lines = moveConsequences(makeTable({ N: 1, E: 2, S: 3, W: 4 }, { moderatedBy: 2, boardId: 9 }), 1)

    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('abandoned for the other three')
  })
})
