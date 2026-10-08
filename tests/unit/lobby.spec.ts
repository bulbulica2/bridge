import { RouterLinkStub, flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import RecentBoards from '@/components/RecentBoards.vue'
import SetStrip from '@/components/SetStrip.vue'
import YourForm from '@/components/YourForm.vue'
import YourTableHero from '@/components/YourTableHero.vue'
import * as historyService from '@/services/history'
import type { PlayingHistoryEntry, SetResults } from '@/services/history'
import type { Playing, SetPosition } from '@/services/game'
import * as usersService from '@/services/users'
import type { Seat, Table } from '@/services/tables'
import { useAuthStore } from '@/stores/auth'
import { useGameStore } from '@/stores/game'
import { useTablesStore } from '@/stores/tables'
import {
  compassSeats,
  filterCounts,
  matchesFilter,
  tableMeta,
  tableStatus,
  yourTableLine,
} from '@/utils/lobby'

vi.mock('@/services/users', () => ({ getMyStats: vi.fn() }))
vi.mock('@/services/history', () => ({ getMyPlayings: vi.fn(), getSet: vi.fn() }))
vi.mock('@/services/echo', () => ({
  listenToTable: vi.fn(),
  leaveTable: vi.fn(),
  listenToUser: vi.fn(),
  leaveUser: vi.fn(),
  onReconnect: vi.fn(),
  disconnectEcho: vi.fn(),
}))

const ana = { id: 1, name: 'Ana', username: 'ana', email: 'ana@example.com' }

function set(overrides: Partial<SetPosition> = {}): SetPosition {
  return {
    id: 3,
    number: 2,
    board: 2,
    of: 4,
    finished: false,
    ended: null,
    replaced: [],
    minutes: 16,
    time_left: { N: null, E: null, S: null, W: null },
    ...overrides,
  }
}

// Seats are given as seat -> username; `robot-…` are robots, a trailing `!`
// marks the player away (for two minutes from now).
function makeTable(id: number, seats: Partial<Record<Seat, string>>, extra: Partial<Table> = {}): Table {
  const taken = Object.entries(seats) as [Seat, string][]
  return {
    id,
    name: `Table ${id}`,
    created_by: 1,
    moderated_by: 1,
    board_id: null,
    unattended_since: null,
    set_minutes: 16,
    set: null,
    created_at: '',
    updated_at: '',
    seats: taken.map(([seat, label], i) => {
      const username = label.replace('!', '')
      const userId = username === 'ana' ? 1 : id * 10 + i + 100
      const away = label.endsWith('!')
      return {
        id: id * 10 + i,
        table_id: id,
        user_id: userId,
        seat,
        ready: false,
        away_since: away ? new Date(Date.now() - 1000).toISOString() : null,
        replace_at: away ? new Date(Date.now() + 120_000).toISOString() : null,
        user: {
          id: userId,
          name: username,
          username,
          description: null,
          is_robot: username.startsWith('robot-'),
          is_admin: false,
        },
      }
    }),
    free_seats: (['N', 'E', 'S', 'W'] as Seat[]).filter((s) => !(s in seats)),
    can_manage: false,
    ...extra,
  }
}

describe('lobby filters and wording', () => {
  const open = makeTable(1, { N: 'bob' })
  const playing = makeTable(2, { N: 'bob', E: 'cy', S: 'di', W: 'ed' }, { board_id: 5, set: set() })
  const robots = makeTable(3, { E: 'robot-1' }, { unattended_since: '2026-10-01T10:00:00Z' })
  const full = makeTable(4, { N: 'bob', E: 'cy', S: 'di', W: 'ed' })

  test('each chip keeps its tables, and counts them', () => {
    expect(matchesFilter(open, 'all')).toBe(true)
    expect(matchesFilter(open, 'free')).toBe(true)
    expect(matchesFilter(playing, 'free')).toBe(false)
    expect(matchesFilter(playing, 'playing')).toBe(true)
    expect(matchesFilter(robots, 'robots')).toBe(true)
    expect(matchesFilter(open, 'robots')).toBe(false)
    expect(filterCounts([open, playing, robots, full])).toEqual({ all: 4, free: 2, playing: 1, robots: 1 })
  })

  test('the status pill', () => {
    expect(tableStatus(open)).toEqual({ text: '3 seats free', tone: 'wait' })
    expect(tableStatus(makeTable(5, { N: 'a', E: 'b', S: 'c' }))).toEqual({ text: '1 seat free', tone: 'wait' })
    expect(tableStatus(playing)).toEqual({ text: 'Playing', tone: 'play' })
    expect(tableStatus(full)).toEqual({ text: 'Full', tone: 'play' })
    expect(tableStatus(robots)).toEqual({ text: 'Robots only', tone: 'robots' })
  })

  test('the meta line', () => {
    expect(tableMeta(open)).toBe('16 min · no set yet')
    expect(tableMeta(playing)).toBe('16 min · set 2 · board 2/4')
    expect(tableMeta({ ...full, set_minutes: 20, set: set({ finished: true }) })).toBe('20 min · set 2 over')
    const now = Date.parse('2026-10-01T10:04:30Z')
    expect(tableMeta(robots, now)).toBe('left 4 min ago · closes in 6')
    // Past the backend's deadline (the table is about to go) and a clock behind.
    expect(tableMeta(robots, Date.parse('2026-10-01T10:15:00Z'))).toBe('left 15 min ago · closes in 0')
    expect(tableMeta(robots, Date.parse('2026-10-01T09:59:00Z'))).toBe('left 0 min ago · closes in 10')
  })

  test('the compass: the viewer, robots, away players, players and empty seats', () => {
    const seats = compassSeats(makeTable(6, { N: 'ana', E: 'robot-1', S: 'cy!', W: 'robot-2!' }), 1)
    expect(seats.N.kind).toBe('me')
    expect(seats.E.kind).toBe('robot')
    expect(seats.S.kind).toBe('away')
    // A robot is a robot, never away.
    expect(seats.W.kind).toBe('robot')

    const other = compassSeats(open, 1)
    expect(other.N).toMatchObject({ seat: 'N', kind: 'player', user: { username: 'bob' } })
    expect(other.E).toEqual({ seat: 'E', user: null, kind: 'empty' })
  })

  test('the Your table line', () => {
    const table = makeTable(7, { S: 'ana', N: 'radu' })
    expect(yourTableLine(table, 1, set())).toBe('Set 2 · Board 2 of 4 · you sit South with radu')
    expect(yourTableLine(table, 1, null)).toBe('No set yet · you sit South with radu')
    expect(yourTableLine(table, 1, set({ finished: true }))).toBe('Set 2 over · you sit South with radu')
    expect(yourTableLine(makeTable(7, { E: 'ana' }), 1, null)).toBe('No set yet · you sit East')
    // Not seated there (a stale copy): only where the table is.
    expect(yourTableLine(table, 99, set())).toBe('Set 2 · Board 2 of 4')
  })
})

describe('SetStrip on the navy card', () => {
  test('"B1" tiles: figures for the boards played, "now" for this one, nothing for the rest', () => {
    const wrapper = mount(SetStrip, {
      props: {
        number: 3,
        of: 4,
        current: 2,
        onTable: true,
        side: 'ew',
        boards: [{ position: 1, matchpoints: { ns: 1, ew: 3 }, top: 4 }],
      },
    })

    expect(wrapper.findAll('.strip-label').map((l) => l.text())).toEqual(['B1', 'B2', 'B3', 'B4'])
    expect(wrapper.findAll('.strip-value').map((v) => v.text())).toEqual(['75 %', 'now', '', ''])
    expect(wrapper.get('.set-strip').classes()).toContain('on-table')
    expect(wrapper.get('.set-strip').attributes('aria-label')).toBe('Set 3 so far')
  })
})

describe('YourTableHero', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    useAuthStore().user = ana
  })

  afterEach(() => {
    useTablesStore().unwatchTable()
  })

  function mountHero(table: Table) {
    const store = useTablesStore()
    store.tables = [table]
    store.loaded = true
    return mount(YourTableHero)
  }

  test('a set under way: the line, the strip with its results, and back to the game', async () => {
    const results = { id: 3, number: 2, of: 4, boards: [{ position: 1, matchpoints: { ns: 3, ew: 1 }, top: 4 }] }
    vi.mocked(historyService.getSet).mockResolvedValue(results as unknown as SetResults)
    const wrapper = mountHero(makeTable(7, { S: 'ana', N: 'radu' }, { board_id: 9, set: set() }))
    await flushPromises()

    expect(wrapper.get('.your-table-line').text()).toBe('Set 2 · Board 2 of 4 · you sit South with radu')
    // The first board finished: the set's results are read for the strip.
    expect(historyService.getSet).toHaveBeenCalledWith(3)
    expect(wrapper.findAll('.strip-value').map((v) => v.text())).toEqual(['75 %', 'now', '', ''])
    expect(wrapper.getComponent('.your-table-go').props('routerLink')).toBe('/tables/7/play')
  })

  test("the board we hold says more than the table: the set's board from the game", async () => {
    vi.mocked(historyService.getSet).mockRejectedValue(new Error('offline'))
    const wrapper = mountHero(makeTable(7, { S: 'ana' }, { board_id: 9, set: set({ board: 1 }) }))
    const game = useGameStore()
    game.tableId = 7
    game.playing = { phase: 'finished', set: set({ board: 3 }) } as unknown as Playing
    await flushPromises()

    expect(wrapper.get('.your-table-line').text()).toBe('Set 2 · Board 3 of 4 · you sit South')
    // A failed read leaves the strip without figures.
    expect(wrapper.findAll('.strip-value').map((v) => v.text())).toEqual(['', '', 'now', ''])
  })

  test('the first board of a set reads nothing, and a set over marks no board', async () => {
    const first = mountHero(makeTable(7, { S: 'ana' }, { set: set({ board: 1 }) }))
    await flushPromises()
    expect(historyService.getSet).not.toHaveBeenCalled()
    expect(first.find('.strip-current').exists()).toBe(true)

    setActivePinia(createPinia())
    useAuthStore().user = ana
    vi.mocked(historyService.getSet).mockReturnValue(new Promise(() => {}))
    const over = mountHero(makeTable(7, { S: 'ana' }, { set: set({ board: 4, finished: true }) }))
    await flushPromises()
    expect(historyService.getSet).toHaveBeenCalledWith(3)
    expect(over.find('.strip-current').exists()).toBe(false)
  })

  test('no set yet: no strip, the game table', () => {
    const wrapper = mountHero(makeTable(7, { S: 'ana' }))

    expect(wrapper.find('.set-strip').exists()).toBe(false)
    expect(wrapper.getComponent('.your-table-go').props('routerLink')).toBe('/tables/7/play')
  })

  test('an away seat comes back, its clock counting down', () => {
    const wrapper = mountHero(makeTable(7, { S: 'ana!' }, { set: set({ board: 1 }) }))

    expect(wrapper.get('.your-table-go').text()).toBe('Come back')
    expect(wrapper.get('.your-table-held').text()).toContain('a robot takes your seat in')
  })

  test('nothing for a banned user or somebody not seated', () => {
    expect(mountHero(makeTable(7, { N: 'bob' })).find('.your-table').exists()).toBe(false)

    useAuthStore().user = { ...ana, ban: { reason: 'x', until: '2026-12-01T00:00:00Z', banned_at: '' } } as never
    expect(mountHero(makeTable(7, { S: 'ana' })).find('.your-table').exists()).toBe(false)
  })
})

describe('YourForm and RecentBoards', () => {
  const stubs = { 'router-link': RouterLinkStub }

  function entry(overrides: Partial<PlayingHistoryEntry> = {}): PlayingHistoryEntry {
    return {
      playing_id: 9,
      table_id: 4,
      set: null,
      board: { id: 7, number: 12, dealer: 'N', vulnerable: '' },
      seat: 'S',
      partner: null,
      contract: null,
      doubled: null,
      declarer: null,
      tricks_won: null,
      score_ns: 0,
      made_by: null,
      score: 0,
      finished_at: '2026-10-01T12:00:00Z',
      ...overrides,
    }
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    useAuthStore().user = ana
  })

  test('the form: dashes until read, and when the read fails', async () => {
    vi.mocked(usersService.getMyStats).mockRejectedValue(new Error('offline'))
    const wrapper = mount(YourForm)

    await (wrapper.vm as unknown as { load: () => Promise<void> }).load()
    expect(wrapper.findAll('.form-figure b').map((b) => b.text())).toEqual(['—', '—', '—'])
  })

  test('the form: no average yet reads as a dash', async () => {
    vi.mocked(usersService.getMyStats).mockResolvedValue({
      user_id: 1,
      boards: { played: 2, compared: 0, won: 0, win_rate: null, average_percent: null },
      sets: { played: 0, won: 0, win_rate: null, average_percent: null },
      leaving: { abandoned: 0, abandoned_by_reason: {} as never, left_rate: null },
    })
    const wrapper = mount(YourForm)

    await (wrapper.vm as unknown as { load: () => Promise<void> }).load()
    await flushPromises()
    expect(wrapper.findAll('.form-figure b').map((b) => b.text())).toEqual(['—', '0 / 0', '2'])
  })

  test('the form for nobody logged in', () => {
    useAuthStore().user = null
    expect(mount(YourForm).findAll('.form-figure b').map((b) => b.text())).toEqual(['—', '—', '—'])
  })

  test('recent boards: the last three, each opening its review', async () => {
    vi.mocked(historyService.getMyPlayings).mockResolvedValue({
      current_page: 1,
      last_page: 1,
      next_page_url: null,
      per_page: 20,
      total: 4,
      data: [
        entry({ playing_id: 1, score: -50 }),
        entry({
          playing_id: 2,
          set: { id: 2, number: 1, board: 4, of: 4 },
          contract: { id: 1, call: '3NT', level: 3, strain: 'NT', special: false },
          doubled: 0,
          declarer: 'N',
          made_by: -1,
          score: -50,
        }),
        entry({ playing_id: 3 }),
        entry({ playing_id: 4 }),
      ],
    })
    const wrapper = mount(RecentBoards, { global: { stubs } })
    expect(wrapper.get('.recent-empty').text()).toBe('Your last boards show here.')

    await (wrapper.vm as unknown as { load: () => Promise<void> }).load()
    await flushPromises()

    const rows = wrapper.findAll('.recent-row')
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.get('.recent-contract').text())).toEqual(['Passed out', '3NT N −1', 'Passed out'])
    expect(rows.map((r) => r.get('.recent-where').text())).toEqual(['Board 12', 'Set 1 · B4', 'Board 12'])
    expect(rows[1].get('.recent-score').text()).toBe('−50')
    expect(wrapper.findAllComponents(RouterLinkStub).map((l) => l.props('to'))).toEqual([
      '/playings/1',
      '/playings/2',
      '/playings/3',
      '/history',
    ])
  })

  test('recent boards: a failed read keeps the placeholder', async () => {
    vi.mocked(historyService.getMyPlayings).mockRejectedValue(new Error('offline'))
    const wrapper = mount(RecentBoards, { global: { stubs } })

    await (wrapper.vm as unknown as { load: () => Promise<void> }).load()
    expect(wrapper.get('.recent-empty').text()).toBe('Your last boards show here.')
  })
})
