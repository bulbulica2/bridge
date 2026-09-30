import { describe, expect, test } from 'vitest'
import { leaveNote, moveConsequences, whoIsLeft } from '@/utils/seatMove'
import type { Seat, Table } from '@/services/tables'

// Seats are given as seat -> user id; ids from 100 up are robots.
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
    unattended_since: null,
    created_at: '2026-09-20T10:00:00.000000Z',
    updated_at: '2026-09-20T10:00:00.000000Z',
    seats: taken.map(([seat, userId], i) => ({
      id: i + 1,
      table_id: 4,
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

describe('with robots at the table', () => {
  test('whoIsLeft tells nobody, only robots and people apart', () => {
    expect(whoIsLeft(makeTable({ N: 1 }), 1)).toBe('nobody')
    expect(whoIsLeft(makeTable({ N: 1, E: 100, S: 101 }), 1)).toBe('robots')
    expect(whoIsLeft(makeTable({ N: 1, E: 100, S: 2 }), 1)).toBe('people')
  })

  test('moving away from robots keeps the table for a while, and says nothing of a role or a board', () => {
    const lines = moveConsequences(makeTable({ N: 1, E: 100, S: 101, W: 102 }, { boardId: 9 }), 1)

    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('Only robots are left there')
    expect(lines[1]).toContain('10 minutes')
    expect(lines[1]).not.toContain('will be deleted.')
  })

  test('a person still seated gets the manager role, robots or not', () => {
    const lines = moveConsequences(makeTable({ N: 1, E: 100, S: 2 }), 1)

    expect(lines[1]).toContain('role passes')
  })
})

describe('leaveNote', () => {
  test('says the table is deleted when nobody else sits there', () => {
    expect(leaveNote(makeTable({ N: 1 }), 1)).toContain('the table is deleted')
  })

  test('says only robots stay, for a while, when they are all that is left', () => {
    const note = leaveNote(makeTable({ N: 1, E: 100 }), 1)

    expect(note).toContain('Only robots are left')
    expect(note).toContain('10 minutes')
  })

  test('says only that the seat is freed when people stay', () => {
    expect(leaveNote(makeTable({ N: 1, E: 2 }), 1)).toBe('Your seat will be freed.')
  })

  test('falls back to what may happen without the table', () => {
    expect(leaveNote(null, 1)).toContain('If nobody is left')
  })
})
