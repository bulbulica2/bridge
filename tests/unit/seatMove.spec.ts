import { beforeEach, describe, expect, test, vi } from 'vitest'
import { alertController } from '@ionic/vue'
import {
  confirmLeave,
  confirmMove,
  confirmRemove,
  confirmWatch,
  heldNotice,
  leaveMessage,
  leaveNote,
  leaveWarning,
  moveConsequences,
  removeCost,
  removeMessage,
  robotTakesOver,
  whoIsLeft,
} from '@/utils/seatMove'
import { setAtStake } from '@/utils/away'
import type { SetAtStake } from '@/utils/away'
import type { PublicPlaying, SetPosition } from '@/services/game'
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
const STAKE: SetAtStake = { number: 3, seat: 'N', side: 'ns', held: true }
// An admin's (or anyone's while an admin there is away): not held.
const NOT_HELD: SetAtStake = { ...STAKE, held: false }

describe('leaving mid-set', () => {
  test("a Leave only holds the seat, for 2 minutes whoever's turn it is", () => {
    const during = leaveWarning('play', 7, STAKE)
    expect(during).toContain("Board 7 is in progress and set 3 isn't over: your seat is held")
    expect(during).toContain(
      'Your seat is kept for 2 minutes: come back before then, or a robot takes it for the rest of the set.',
    )

    const between = leaveWarning('finished', 7, STAKE)
    expect(between).toBe(
      "Set 3 isn't over: your seat is held for you. Your seat is kept for 2 minutes: come back before then, or a robot takes it for the rest of the set. Your time for the set keeps running when it's your turn.",
    )
  })

  test('the seat is not freed yet, so the confirmation leaves out what becomes of it', () => {
    const table = makeTable({ N: 1, E: 2, S: 3, W: 4 }, { boardId: 9 })

    expect(leaveMessage(table, 1, 'play', 7, STAKE)).not.toContain('Your seat will be freed')
    expect(leaveMessage(table, 1, 'play', 7, null)).toBe(
      'Board 7 is in progress: leaving abandons it for the other three players. Your seat will be freed.',
    )
  })

  test('where the seat is not held (an admin), leaving breaks the set off at once', () => {
    const table = makeTable({ N: 1, E: 2, S: 3, W: 4 }, { boardId: 9 })

    expect(leaveWarning('auction', 7, NOT_HELD)).toBe(
      "Set 3 isn't over: leaving ends it with no winner and abandons board 7 for the other three players.",
    )
    expect(leaveMessage(table, 1, 'finished', 7, NOT_HELD)).toBe(
      "Set 3 isn't over: leaving ends it with no winner. Your seat will be freed.",
    )
  })

  test('the toast after a held Leave says how long the seat is kept', () => {
    expect(heldNotice()).toBe(
      "You left in the middle of a set. Your seat is kept for 2 minutes: come back before then, or a robot takes it for the rest of the set. Your time for the set keeps running when it's your turn.",
    )
  })
})

describe('moving mid-set', () => {
  test('a robot takes the seat at once and plays the board on: nothing is abandoned', () => {
    const from = makeTable({ N: 1, E: 2, S: 3, W: 4 }, { moderatedBy: 2, boardId: 9 })

    expect(robotTakesOver(from, 1, STAKE)).toBe(true)
    expect(moveConsequences(from, 1, 'play', STAKE)).toEqual([
      'You give up seat N at Friday club for good.',
      "A robot takes your seat there for the rest of set 3, and you can't sit down there again until it is over.",
    ])
  })

  test('with only robots left there, the set ends instead', () => {
    const from = makeTable({ N: 1, E: 100, S: 101, W: 102 }, { boardId: 9 })

    expect(robotTakesOver(from, 1, STAKE)).toBe(false)
    const lines = moveConsequences(from, 1, 'play', STAKE)
    expect(lines[1]).toBe('Set 3 there ends with no winner, and the board in progress there is abandoned.')
    expect(lines[2]).toContain('Only robots are left there')
    expect(moveConsequences(from, 1, 'finished', STAKE)[1]).toBe('Set 3 there ends with no winner.')
  })

  test('where the seat is not held, the set there just ends', () => {
    const from = makeTable({ N: 1, E: 2, S: 3, W: 4 }, { moderatedBy: 2, boardId: 9 })

    expect(robotTakesOver(from, 1, NOT_HELD)).toBe(false)
    expect(robotTakesOver(from, 1, null)).toBe(false)
    expect(moveConsequences(from, 1, 'finished', NOT_HELD)[1]).toBe('Set 3 there ends with no winner.')
  })
})

describe('confirmation alerts', () => {
  const stake: SetAtStake = { number: 2, seat: 'N', side: 'ns', held: true }

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

  test('confirmMove is sterner mid-set', async () => {
    dismissedWith = 'backdrop'

    await expect(
      confirmMove(makeTable({ N: 1, E: 2, S: 3, W: 4 }), { id: 9, name: 'Late night' }, 1, 'play', stake),
    ).resolves.toBe(false)
    expect(lastAlert().header).toBe('Move to Late night and leave set 2?')
    expect(lastAlert().buttons[1].text).toBe('Move anyway')
  })

  test('confirmWatch (#182) asks before leaving a seat to watch, in the words of Leave', async () => {
    const from = makeTable({ N: 1, E: 2 })
    dismissedWith = 'destructive'

    await expect(confirmWatch(from, { id: 9, name: 'Late night' }, 1, 'finished', 3)).resolves.toBe(true)
    expect(lastAlert().header).toBe('Leave Friday club to watch Late night?')
    expect(lastAlert().message).toBe(leaveMessage(from, 1, 'finished', 3))
    expect(lastAlert().buttons.map((b) => b.text)).toEqual(['Cancel', 'Leave and watch'])

    dismissedWith = 'cancel'
    await expect(confirmWatch(from, { id: 9, name: null }, 1)).resolves.toBe(false)
    expect(lastAlert().header).toBe('Leave Friday club to watch table #9?')
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

  test('confirmLeave names the set at stake, held or broken off', async () => {
    dismissedWith = 'destructive'

    await confirmLeave(makeTable({ N: 1, E: 2, S: 3, W: 4 }), 1, 'play', 2, stake)
    expect(lastAlert().header).toBe('Leave in the middle of set 2?')
    expect(lastAlert().buttons[1].text).toBe('Leave anyway')

    await confirmLeave(makeTable({ N: 1, E: 2, S: 3, W: 4 }), 1, 'play', 2, { ...stake, held: false })
    expect(lastAlert().message).toContain('ends it with no winner')
    expect(lastAlert().buttons[1].text).toBe('Leave anyway')
  })
})

// A set of four boards with robots, played to the end (#121): its last board
// finished and still on show. A board finishing sends no TableUpdated, so the
// table's own copy of the set may still say it runs; the board's knows.
describe('after the last board of a set', () => {
  const running: SetPosition = { id: 8, number: 8, board: 4, of: 4, finished: false, ended: null, replaced: [] }
  const over: SetPosition = { ...running, finished: true, ended: 'completed' }

  // The admin (1) at S with three robots, board 18 still on the table.
  function afterSet(tableSet: SetPosition = running): Table {
    return { ...makeTable({ S: 1, W: 101, N: 102, E: 103 }, { boardId: 18 }), set: tableSet }
  }

  const lastBoard = {
    phase: 'finished',
    set: over,
    board: { id: 18, number: 4, dealer: 'W', vulnerable: '' },
    next_board_at: null,
  } as unknown as PublicPlaying

  test('nothing is at stake, whichever copy of the set says it is over', () => {
    expect(setAtStake(afterSet(), lastBoard, 1, true)).toBeNull()
    expect(setAtStake(afterSet(), lastBoard, 1, false)).toBeNull()
    expect(setAtStake(afterSet(over), null, 1)).toBeNull()
  })

  test('Leave frees the seat at once, with no word of a set', () => {
    const stake = setAtStake(afterSet(), lastBoard, 1, true)

    expect(leaveWarning('finished', 4, stake)).toBe('Board 4 is over, so leaving abandons nothing: its score is kept.')
    expect(leaveMessage(afterSet(), 1, 'finished', 4, stake)).toBe(
      'Board 4 is over, so leaving abandons nothing: its score is kept. Your seat will be freed. Only robots are left: the table waits 10 minutes for somebody to take it over, then it is deleted.',
    )
    expect(leaveMessage(afterSet(), 1, 'finished', 4, stake)).not.toMatch(/set|held/i)
  })

  test('the confirmation is a plain Leave', async () => {
    vi.mocked(alertController.create).mockClear()
    dismissedWith = 'destructive'

    await expect(
      confirmLeave(afterSet(), 1, 'finished', 4, setAtStake(afterSet(), lastBoard, 1, true)),
    ).resolves.toBe(true)
    const alert = vi.mocked(alertController.create).mock.calls[0][0] as { header: string; buttons: { text: string }[] }
    expect(alert.header).toBe('Leave this table?')
    expect(alert.buttons[1].text).toBe('Leave')
  })

  test('removing a robot costs nothing, nor anybody once the set is over', () => {
    expect(removeCost(afterSet(), lastBoard, 'W')).toBe('')
    expect(removeCost({ ...makeTable({ S: 1, N: 2 }, { boardId: 18 }), set: over }, null, 'N')).toBe('')
  })

  test('a confirmation that fails to open rejects, for the page to tell', async () => {
    vi.mocked(alertController.create).mockRejectedValueOnce(new Error('no overlay'))

    await expect(confirmLeave(afterSet(), 1, 'finished', 4)).rejects.toThrow('no overlay')
  })
})

describe('removing a player', () => {
  const running: SetPosition = { id: 3, number: 3, board: 2, of: 4, finished: false, ended: null, replaced: [] }

  // East (2) away or not, mid-set; `seats` as makeTable's.
  function midSet(eastAway: boolean, seats: Partial<Record<Seat, number>> = { N: 1, E: 2, S: 3, W: 4 }): Table {
    const table = { ...makeTable(seats, { boardId: 7 }), set: running }
    return {
      ...table,
      seats: table.seats.map((s) => ({ ...s, away_since: s.seat === 'E' && eastAway ? '2026-10-05T12:00:00Z' : null })),
    }
  }

  test('mid-set, kicking a player away hands their seat to a robot', () => {
    expect(removeCost(midSet(true), null, 'E')).toBe('They are away, so a robot takes their seat for the rest of set 3.')
  })

  test('with nobody else human there, kicking them ends the set', () => {
    expect(removeCost(midSet(true, { N: 100, E: 2, S: 101, W: 102 }), null, 'E')).toBe('Set 3 ends with no winner.')
  })

  test('mid-set, kicking a player who is there only ends the set', () => {
    expect(removeCost(midSet(false), null, 'E')).toBe('Set 3 ends with no winner.')
  })

  test('outside a set, or for an empty seat, it costs nothing', () => {
    expect(removeCost(makeTable({ N: 1, E: 2 }), null, 'E')).toBe('')
    expect(removeCost({ ...midSet(false), seats: [] }, null, 'E')).toBe('')
  })

  test('the message says what becomes of the seat, and of the set', () => {
    expect(removeMessage({ username: 'robot-1', is_robot: true }, 'W')).toBe(
      'The robot leaves seat W, which becomes free.',
    )
    expect(removeMessage({ username: 'bob', is_robot: false }, 'E')).toBe(
      'bob loses seat E. They can sit down again afterwards.',
    )
    expect(removeMessage({ username: 'bob', is_robot: false }, 'E', 'Set 3 ends with no winner.')).toBe(
      'bob loses seat E. They can sit down again afterwards. Set 3 ends with no winner.',
    )
  })

  test('confirmRemove asks first and says yes only on Remove', async () => {
    vi.mocked(alertController.create).mockClear()
    dismissedWith = 'destructive'

    await expect(confirmRemove({ username: 'robot-1', is_robot: true }, 'W')).resolves.toBe(true)
    expect(alertController.create).toHaveBeenCalledWith({
      header: 'Remove robot-1?',
      message: 'The robot leaves seat W, which becomes free.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Remove', role: 'destructive' },
      ],
    })

    dismissedWith = 'cancel'
    await expect(confirmRemove({ username: 'bob', is_robot: false }, 'E')).resolves.toBe(false)
  })
})
