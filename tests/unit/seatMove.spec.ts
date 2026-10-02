import { beforeEach, describe, expect, test, vi } from 'vitest'
import { alertController } from '@ionic/vue'
import {
  confirmLeave,
  confirmMove,
  heldNotice,
  leaveMessage,
  leaveNote,
  leaveWarning,
  moveConsequences,
  whoIsLeft,
} from '@/utils/seatMove'
import type { SetAtStake } from '@/utils/away'
import type { Seat, Table } from '@/services/tables'

// The alert answers with whichever role the test picks.
let dismissedWith: string | undefined
vi.mock('@ionic/vue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ionic/vue')>()),
  alertController: {
    create: vi.fn(async () => ({
      present: vi.fn(),
      onDidDismiss: async () => ({ role: dismissedWith }),
    })),
  },
}))

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

// Mid-set (setAtStake): set 3, the user sits North.
const STAKE: SetAtStake = { number: 3, seat: 'N', side: 'ns', forfeits: true }
const NO_FORFEIT: SetAtStake = { ...STAKE, forfeits: false }

describe('leaving mid-set', () => {
  test('a Leave only holds the seat, and not coming back loses the set', () => {
    const during = leaveWarning('play', 7, STAKE)
    expect(during).toContain('Board 7 is in progress and set 3 isn\'t over: your seat is held')
    expect(during).toContain("If you don't come back within 3 minutes, N-S lose the set.")

    const between = leaveWarning('finished', 7, STAKE)
    expect(between).toBe(
      "Set 3 isn't over: your seat is held for you. If you don't come back within 3 minutes, N-S lose the set.",
    )
  })

  test('the seat is not freed yet, so the confirmation leaves out what becomes of it', () => {
    const table = makeTable({ N: 1, E: 2, S: 3, W: 4 }, { boardId: 9 })

    expect(leaveMessage(table, 1, 'play', 7, STAKE)).not.toContain('Your seat will be freed')
    expect(leaveMessage(table, 1, 'play', 7, null)).toBe(
      'Board 7 is in progress: leaving abandons it for the other three players. Your seat will be freed.',
    )
  })

  test('where nobody can forfeit (an admin), leaving breaks the set off at once', () => {
    const table = makeTable({ N: 1, E: 2, S: 3, W: 4 }, { boardId: 9 })

    expect(leaveWarning('auction', 7, NO_FORFEIT)).toBe(
      "Set 3 isn't over: leaving ends it with no winner and abandons board 7 for the other three players.",
    )
    expect(leaveMessage(table, 1, 'finished', 7, NO_FORFEIT)).toBe(
      "Set 3 isn't over: leaving ends it with no winner. Your seat will be freed.",
    )
  })

  test('the toast after a held Leave says how long and what is at stake', () => {
    expect(heldNotice(STAKE)).toBe(
      'You left in the middle of a set. Your seat is held for 3 minutes: come back before then, or N-S lose the set.',
    )
    expect(heldNotice(null)).toContain('or your side loses the set.')
  })
})

describe('moving mid-set', () => {
  test('your side loses the set now, and says so in place of the abandoned board', () => {
    const lines = moveConsequences(makeTable({ N: 1, E: 2, S: 3, W: 4 }, { moderatedBy: 2, boardId: 9 }), 1, 'play', STAKE)

    expect(lines).toEqual([
      'You give up seat N at Friday club for good.',
      'Your side loses the set now: N-S forfeit set 3, and the board in progress there is abandoned.',
    ])
  })

  test('between boards there is no board to abandon, robots or not', () => {
    const lines = moveConsequences(makeTable({ N: 1, E: 100, S: 101, W: 102 }, { boardId: 9 }), 1, 'finished', STAKE)

    expect(lines[1]).toBe('Your side loses the set now: N-S forfeit set 3.')
    expect(lines[2]).toContain('Only robots are left there')
  })

  test('where nobody can forfeit, the set there just ends', () => {
    const lines = moveConsequences(makeTable({ N: 1, E: 2, S: 3, W: 4 }, { moderatedBy: 2, boardId: 9 }), 1, 'finished', NO_FORFEIT)

    expect(lines[1]).toBe('Set 3 there ends with no winner.')
  })
})

describe('confirmation alerts', () => {
  const stake: SetAtStake = { number: 2, seat: 'N', side: 'NS', forfeits: true }

  beforeEach(() => {
    vi.mocked(alertController.create).mockClear()
  })

  function lastAlert() {
    return vi.mocked(alertController.create).mock.calls.at(-1)![0] as {
      header: string
      message: string
      buttons: { text: string; role: string }[]
    }
  }

  test('confirmMove asks before moving and says yes only on Move', async () => {
    const from = makeTable({ N: 1, E: 2 }, { moderatedBy: 2 })
    dismissedWith = 'confirm'

    await expect(confirmMove(from, { id: 9, name: 'Late night' }, 1)).resolves.toBe(true)
    expect(lastAlert().header).toBe('Move to Late night?')
    expect(lastAlert().message).toBe(moveConsequences(from, 1).join(' '))
    expect(lastAlert().buttons.map((b) => b.text)).toEqual(['Cancel', 'Move'])

    dismissedWith = 'cancel'
    await expect(confirmMove(from, { id: 9, name: 'Late night' }, 1)).resolves.toBe(false)
  })

  test('confirmMove is sterner when the move loses the set', async () => {
    dismissedWith = 'backdrop'

    await expect(
      confirmMove(makeTable({ N: 1, E: 2, S: 3, W: 4 }), { id: 9, name: 'Late night' }, 1, 'play', stake),
    ).resolves.toBe(false)
    expect(lastAlert().header).toBe('Move to Late night and lose the set?')
    expect(lastAlert().buttons[1].text).toBe('Move anyway')
  })

  test('confirmLeave asks before leaving and says yes only on Leave', async () => {
    const table = makeTable({ N: 1, E: 2 })
    dismissedWith = 'destructive'

    await expect(confirmLeave(table, 1, 'finished', 3)).resolves.toBe(true)
    expect(lastAlert().header).toBe('Leave this table?')
    expect(lastAlert().message).toBe(leaveMessage(table, 1, 'finished', 3))
    expect(lastAlert().buttons[1].text).toBe('Leave')

    dismissedWith = 'cancel'
    await expect(confirmLeave(table, 1, 'finished', 3)).resolves.toBe(false)
  })

  test('confirmLeave names the set at stake', async () => {
    dismissedWith = 'destructive'

    await confirmLeave(makeTable({ N: 1, E: 2, S: 3, W: 4 }), 1, 'play', 2, stake)
    expect(lastAlert().header).toBe('Leave in the middle of set 2?')
    expect(lastAlert().buttons[1].text).toBe('Leave anyway')

    await confirmLeave(makeTable({ N: 1, E: 2, S: 3, W: 4 }), 1, 'play', 2, { ...stake, forfeits: false })
    expect(lastAlert().buttons[1].text).toBe('Leave')
  })
})
