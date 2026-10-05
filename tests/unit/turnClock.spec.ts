import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import type { Playing, PublicPlaying } from '@/services/game'
import { useTurnClock } from '@/composables/useTurnClock'
import { useTurnTitle } from '@/composables/useTurnTitle'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import {
  TIME_UP_TEXT,
  TURN_URGENT_SECONDS,
  turnClock,
  turnClockText,
  turnDeadline,
  turnTitle,
  turnUrgent,
} from '@/utils/turnClock'

const NOW = Date.parse('2026-10-05T12:00:00.000Z')

// `left` seconds from NOW, as the backend sends turn_deadline.
function inSeconds(left: number): string {
  return new Date(NOW + left * 1000).toISOString()
}

const PLAYERS = {
  N: { id: 1, name: 'Ann', username: 'ann', is_robot: false, is_admin: false },
  E: { id: 2, name: 'Bob', username: 'bob', is_robot: false, is_admin: false },
  S: { id: 3, name: 'Cy', username: 'cy', is_robot: false, is_admin: false },
  W: { id: 4, name: 'Di', username: 'di', is_robot: false, is_admin: false },
}

// East on turn in the auction, 42 s left.
function state(overrides: Partial<PublicPlaying> = {}): PublicPlaying {
  return {
    phase: 'auction',
    playing_id: 42,
    players: PLAYERS,
    turn: 'E',
    acting_user_id: 2,
    turn_deadline: inSeconds(42),
    claim: null,
    ...overrides,
  } as PublicPlaying
}

describe('the turn clock', () => {
  test('runs only during the auction and the play, from turn_deadline', () => {
    expect(turnDeadline(state())).toBe(inSeconds(42))
    expect(turnDeadline(state({ phase: 'play' }))).toBe(inSeconds(42))
    expect(turnDeadline(state({ phase: 'finished' }))).toBeNull()
    expect(turnDeadline(state({ turn_deadline: null }))).toBeNull()
    // An older payload without the field: no clock.
    expect(turnDeadline({ ...state(), turn_deadline: undefined } as unknown as PublicPlaying)).toBeNull()
    expect(turnDeadline(null)).toBeNull()
  })

  test("the player on turn sees their own, the others whose it is", () => {
    expect(turnClock(state(), 2, NOW)).toEqual({ seconds: 42, mine: true, seat: 'E', by: 'move' })
    expect(turnClock(state(), 3, NOW)).toEqual({ seconds: 42, mine: false, seat: 'E', by: 'move' })
    expect(turnClock(state(), null, NOW)?.mine).toBe(false)
    expect(turnClock(state({ turn_deadline: null }), 2, NOW)).toBeNull()
    expect(turnClock(null, 2, NOW)).toBeNull()
  })

  test("on dummy's turn the clock is declarer's, who plays it", () => {
    // North is dummy; South (3) declares and plays North's card.
    const dummyTurn = state({ phase: 'play', turn: 'N', acting_user_id: 3 })

    expect(turnClock(dummyTurn, 3, NOW)).toEqual({ seconds: 42, mine: true, seat: 'S', by: 'move' })
    expect(turnClock(dummyTurn, 2, NOW)?.seat).toBe('S')
    // Without the players, the turn's own seat.
    expect(turnClock({ ...dummyTurn, players: null }, 2, NOW)?.seat).toBe('N')
  })

  test('words it, and time up until the backend acts', () => {
    expect(turnClockText({ seconds: 42, mine: true, seat: 'E' })).toBe('Your turn · 0:42')
    expect(turnClockText({ seconds: 42, mine: false, seat: 'E' })).toBe('Waiting for East · 0:42')
    expect(turnClockText({ seconds: 61, mine: false, seat: null })).toBe('Waiting · 1:01')
    expect(turnClockText({ seconds: 0, mine: true, seat: 'E' })).toBe(TIME_UP_TEXT)
    expect(TIME_UP_TEXT).toBe('Time is up…')
  })

  test("says which clock it is: the move's, or the time for the set", () => {
    expect(turnClock(state({ turn_deadline_by: 'set' }), 2, NOW)?.by).toBe('set')
    expect(turnClock(state({ turn_deadline_by: 'move' }), 2, NOW)?.by).toBe('move')
    // An older payload without the field: the move's.
    expect(turnClock(state(), 2, NOW)?.by).toBe('move')

    expect(turnClockText({ seconds: 42, mine: true, seat: 'E', by: 'set' })).toBe('Your time for the set: 0:42')
    expect(turnClockText({ seconds: 42, mine: false, seat: 'E', by: 'set' })).toBe("East's time for the set: 0:42")
    expect(turnClockText({ seconds: 42, mine: false, seat: null, by: 'set' })).toBe('The time for the set: 0:42')
    expect(turnClockText({ seconds: 0, mine: true, seat: 'E', by: 'set' })).toBe(TIME_UP_TEXT)
  })

  test('only our own clock turns red, in its last 15 s', () => {
    expect(TURN_URGENT_SECONDS).toBe(15)
    expect(turnUrgent({ seconds: 16, mine: true, seat: 'E' })).toBe(false)
    expect(turnUrgent({ seconds: 15, mine: true, seat: 'E' })).toBe(true)
    expect(turnUrgent({ seconds: 0, mine: true, seat: 'E' })).toBe(true)
    expect(turnUrgent({ seconds: 5, mine: false, seat: 'E' })).toBe(false)
    expect(turnUrgent(null)).toBe(false)
  })

  test("the tab's title", () => {
    expect(turnTitle({ seconds: 42, mine: true, seat: 'E' }, 'Bridge')).toBe('● Your turn (0:42) – Bridge')
  })
})

describe('useTurnClock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('ticks every second while a deadline runs', async () => {
    const shown = ref<PublicPlaying | null>(state())
    const scope = effectScope()
    const clock = scope.run(() => useTurnClock(() => shown.value, () => 2))!

    expect(clock.text.value).toBe('Your turn · 0:42')
    expect(clock.urgent.value).toBe(false)

    vi.advanceTimersByTime(27_000)
    await nextTick()
    expect(clock.text.value).toBe('Your turn · 0:15')
    expect(clock.urgent.value).toBe(true)

    vi.advanceTimersByTime(15_000)
    await nextTick()
    expect(clock.text.value).toBe('Time is up…')

    // The turn taken: no clock, no text.
    shown.value = state({ turn_deadline: null })
    await nextTick()
    expect(clock.clock.value).toBeNull()
    expect(clock.text.value).toBe('')
    expect(clock.urgent.value).toBe(false)
    scope.stop()
  })

  test("counts the acting seat's time for the set down on the same tick", async () => {
    const set = { id: 5, number: 1, board: 1, of: 4, finished: false, ended: null, replaced: [], minutes: 16 }
    const shown = ref<PublicPlaying | null>(
      state({
        set: { ...set, time_left: { N: 300, E: 70, S: 600, W: null } },
        turn_started_at: new Date(NOW).toISOString(),
      }),
    )
    const scope = effectScope()
    const clock = scope.run(() => useTurnClock(() => shown.value, () => 3))!

    expect(clock.banks.value.E).toEqual({ seconds: 70, running: true, low: false })
    expect(clock.banks.value.N).toEqual({ seconds: 300, running: false, low: false })
    expect(clock.banks.value.W).toBeUndefined()

    vi.advanceTimersByTime(11_000)
    await nextTick()
    expect(clock.banks.value.E).toEqual({ seconds: 59, running: true, low: true })
    expect(clock.banks.value.N?.seconds).toBe(300)
    scope.stop()
  })
})

describe('useTurnTitle', () => {
  let visibility: DocumentVisibilityState = 'visible'

  function setVisibility(state: DocumentVisibilityState) {
    visibility = state
    document.dispatchEvent(new Event('visibilitychange'))
  }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    setActivePinia(createPinia())
    visibility = 'visible'
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
    document.title = 'Bridge'
    useAuthStore().user = { id: 2, name: 'Bob', username: 'bob', email: 'bob@example.com' }
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function hold(playing: PublicPlaying | null) {
    const game = useGameStore()
    game.tableId = 5
    game.playing = playing as Playing | null
  }

  test('while hidden on our turn the title counts down, and comes back when the page shows', async () => {
    hold(state())
    const scope = effectScope()
    scope.run(() => useTurnTitle())
    expect(document.title).toBe('Bridge')

    setVisibility('hidden')
    await nextTick()
    expect(document.title).toBe('● Your turn (0:42) – Bridge')

    vi.advanceTimersByTime(2000)
    await nextTick()
    expect(document.title).toBe('● Your turn (0:40) – Bridge')

    setVisibility('visible')
    await nextTick()
    expect(document.title).toBe('Bridge')
    scope.stop()
  })

  test('put back once the turn is taken, even while still hidden', async () => {
    hold(state())
    const scope = effectScope()
    scope.run(() => useTurnTitle())
    setVisibility('hidden')
    await nextTick()
    expect(document.title).toContain('Your turn')

    hold(state({ turn: 'S', acting_user_id: 3, turn_deadline: inSeconds(60) }))
    await nextTick()
    expect(document.title).toBe('Bridge')
    scope.stop()
  })

  test("somebody else's turn, or no clock, leaves the title alone", async () => {
    hold(state({ acting_user_id: 3 }))
    const scope = effectScope()
    scope.run(() => useTurnTitle())
    setVisibility('hidden')
    await nextTick()
    expect(document.title).toBe('Bridge')

    hold(state({ turn_deadline: null }))
    await nextTick()
    expect(document.title).toBe('Bridge')

    hold(null)
    await nextTick()
    expect(document.title).toBe('Bridge')
    scope.stop()
  })

  test('stopping puts the title back and stops listening', async () => {
    hold(state())
    const scope = effectScope()
    scope.run(() => useTurnTitle())
    setVisibility('hidden')
    await nextTick()
    expect(document.title).toContain('Your turn')

    scope.stop()
    expect(document.title).toBe('Bridge')
    setVisibility('visible')
    setVisibility('hidden')
    await nextTick()
    expect(document.title).toBe('Bridge')
  })

  test('a page opened hidden starts out hidden', async () => {
    visibility = 'hidden'
    hold(state())
    const scope = effectScope()
    scope.run(() => useTurnTitle())
    await nextTick()

    expect(document.title).toBe('● Your turn (0:42) – Bridge')
    scope.stop()
  })
})
