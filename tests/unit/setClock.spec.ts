import { describe, expect, test } from 'vitest'
import type { PublicPlaying, SetPosition } from '@/services/game'
import {
  SET_LOW_SECONDS,
  bankLabel,
  bankLeft,
  setBanks,
  setClockText,
} from '@/utils/setClock'

const NOW = Date.parse('2026-10-05T12:00:00.000Z')

// `ago` seconds before NOW, as the backend sends turn_started_at.
function secondsAgo(ago: number): string {
  return new Date(NOW - ago * 1000).toISOString()
}

const PLAYERS = {
  N: { id: 1, name: 'Ann', username: 'ann', is_robot: false, is_admin: false },
  E: { id: 2, name: 'Bob', username: 'bob', is_robot: false, is_admin: false },
  S: { id: 3, name: 'Cy', username: 'cy', is_robot: false, is_admin: true },
  W: { id: 4, name: 'Robot', username: 'robot-1', is_robot: true, is_admin: false },
}

const SET: SetPosition = {
  id: 5,
  number: 1,
  board: 2,
  of: 4,
  finished: false,
  ended: null,
  replaced: [],
  minutes: 16,
  time_left: { N: 812, E: 905, S: null, W: null },
}

// East on turn in the play, since 10 s ago.
function state(overrides: Partial<PublicPlaying> = {}): PublicPlaying {
  return {
    phase: 'play',
    playing_id: 42,
    set: SET,
    players: PLAYERS,
    turn: 'E',
    acting_user_id: 2,
    turn_started_at: secondsAgo(10),
    turn_deadline: new Date(NOW + 50_000).toISOString(),
    turn_deadline_by: 'move',
    claim: null,
    ...overrides,
  } as PublicPlaying
}

describe('a bank counting down', () => {
  test('takes the time since the turn began off what was left then', () => {
    expect(bankLeft(905, secondsAgo(10), NOW)).toBe(895)
    // A part of a second still shows the whole second.
    expect(bankLeft(905, secondsAgo(10.4), NOW)).toBe(895)
    expect(bankLeft(905, secondsAgo(10.6), NOW)).toBe(895)
    expect(bankLeft(905, secondsAgo(11), NOW)).toBe(894)
  })

  test('never below 0, nor above what was left (a clock behind the server)', () => {
    expect(bankLeft(30, secondsAgo(45), NOW)).toBe(0)
    expect(bankLeft(30, secondsAgo(-5), NOW)).toBe(30)
  })

  test('without a start it stands still', () => {
    expect(bankLeft(30, null, NOW)).toBe(30)
    expect(bankLeft(30, 'not a date', NOW)).toBe(30)
  })
})

describe("each seat's time for the set", () => {
  test("the acting seat's runs, the others stand still; robots and admins have none", () => {
    expect(setBanks(state(), NOW)).toEqual({
      N: { seconds: 812, running: false, low: false },
      E: { seconds: 895, running: true, low: false },
    })
  })

  test("on dummy's turn it is declarer's that runs", () => {
    // North is dummy; East can't be, so: West dummy, East declares and plays it.
    const banks = setBanks(state({ turn: 'W' }), NOW)
    expect(banks.E?.running).toBe(true)
    expect(banks.N?.running).toBe(false)
  })

  test('none runs while no turn clock does: a claim, between boards, a robot on turn', () => {
    for (const quiet of [
      state({ turn_deadline: null }),
      state({ phase: 'finished', turn_deadline: null }),
      state({ acting_user_id: 4, turn: 'W', turn_deadline: null }),
    ]) {
      const banks = setBanks(quiet, NOW)
      expect(banks.E).toEqual({ seconds: 905, running: false, low: false })
    }
  })

  test(`turns red under ${SET_LOW_SECONDS} s`, () => {
    expect(SET_LOW_SECONDS).toBe(60)
    const low = (left: number) => setBanks(state({ set: { ...SET, time_left: { ...SET.time_left, E: left } } }), NOW).E
    expect(low(70)).toEqual({ seconds: 60, running: true, low: false })
    expect(low(69)).toEqual({ seconds: 59, running: true, low: true })
    expect(low(5)).toEqual({ seconds: 0, running: true, low: true })
    // Standing still too.
    expect(setBanks(state({ set: { ...SET, time_left: { ...SET.time_left, N: 59 } } }), NOW).N?.low).toBe(true)
  })

  test('nothing without a set, or a set from before the clock', () => {
    expect(setBanks(null, NOW)).toEqual({})
    expect(setBanks(state({ set: null }), NOW)).toEqual({})
    const older = { ...SET, time_left: undefined } as unknown as SetPosition
    expect(setBanks(state({ set: older }), NOW)).toEqual({})
  })

  test('words it', () => {
    expect(bankLabel('N', { seconds: 812, running: false, low: false })).toBe("North's time for the set: 13:32")
    expect(setClockText(16)).toBe('16 minutes each for a set of 4 boards')
  })
})
