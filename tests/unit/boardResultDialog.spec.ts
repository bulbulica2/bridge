import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { nextTick } from 'vue'
import BoardResultDialog from '@/components/BoardResultDialog.vue'
import ResultPill from '@/components/ResultPill.vue'
import type { Bid, BoardResult } from '@/services/game'
import type { BoardResults, DoubleDummy, SetResults } from '@/services/history'
import type { Seat } from '@/services/tables'
import type { PublicUser } from '@/services/users'
import { OTHER_TABLES_MAX } from '@/utils/result'
import { NEXT_BOARD_SECONDS } from '@/utils/sets'

const NOW = Date.parse('2026-10-08T12:00:00Z')
const inSeconds = (s: number) => new Date(NOW + s * 1000).toISOString()

function bid(call: string): Bid {
  const level = Number(call[0])
  const strain = call.slice(1) as Bid['strain']
  return { id: 100 + level, call, level, strain, special: false }
}

function person(id: number, username: string, isRobot = false): PublicUser {
  return { id, name: username, username, description: null, is_robot: isRobot, is_admin: false }
}

const PEOPLE: Partial<Record<Seat, PublicUser | null>> = {
  N: person(1, 'ann'),
  E: person(2, 'bob'),
  S: person(3, 'cy'),
  W: person(4, 'di'),
}

// 4♠ by South, made with an overtrick, by claim.
function result(overrides: Partial<BoardResult> = {}): BoardResult {
  return {
    contract: bid('4S'),
    doubled: 0,
    declarer: 'S',
    tricks_won: 11,
    score_ns: 450,
    made_by: 1,
    claimed: true,
    ...overrides,
  }
}

const PASSED_OUT: BoardResult = {
  contract: null,
  doubled: null,
  declarer: null,
  tricks_won: null,
  score_ns: 0,
  made_by: null,
  claimed: false,
}

// The board at `count` tables, ours (playing 42) third best.
function others(count: number): BoardResults {
  return {
    board: { id: 7, number: 7, dealer: 'N', vulnerable: '' },
    top: count - 1,
    results: Array.from({ length: count }, (_, i) => ({
      playing_id: i === 2 ? 42 : 100 + i,
      table_id: i + 1,
      players: { N: person(10 + i, `n${i}`), E: null, S: person(20 + i, `s${i}`), W: null },
      contract: bid('4S'),
      doubled: 0 as const,
      declarer: 'S' as Seat,
      tricks_won: 12 - i,
      score_ns: 480 - i * 30,
      made_by: 2 - i,
      matchpoints: { ns: count - 1 - i, ew: i },
      finished_at: '2026-10-08T12:00:00Z',
    })),
  }
}

const READY: DoubleDummy = {
  status: 'ready',
  table: {
    N: { C: 7, D: 5, H: 6, S: 10, NT: 6 },
    E: { C: 5, D: 7, H: 6, S: 3, NT: 6 },
    S: { C: 7, D: 5, H: 6, S: 10, NT: 6 },
    W: { C: 5, D: 7, H: 6, S: 3, NT: 6 },
  },
}

function setOver(): SetResults {
  return {
    id: 5,
    number: 3,
    table_id: 9,
    of: 4,
    boards_dealt: 4,
    started_at: '2026-10-08T11:00:00Z',
    finished_at: '2026-10-08T12:00:00Z',
    finished: true,
    ended: 'completed',
    replaced: [],
    players: { N: PEOPLE.N!, E: PEOPLE.E!, S: PEOPLE.S!, W: PEOPLE.W! },
    boards: [1, 2, 3, 4].map((position) => ({
      ...result(),
      position,
      playing_id: 40 + position,
      board: { id: position, number: position, dealer: 'N' as const, vulnerable: '' as const },
      top: 2,
      matchpoints: { ns: 1, ew: 1 },
    })),
    totals: { score: { ns: 1800, ew: -1800 }, matchpoints: { ns: 4, ew: 4 }, top: 8 },
    winner: null,
  }
}

const modalStub = {
  name: 'IonModal',
  props: ['isOpen'],
  emits: ['didDismiss'],
  template: '<div class="modal-stub" :data-open="isOpen"><slot /></div>',
}

type Props = InstanceType<typeof BoardResultDialog>['$props']

function mountDialog(props: Partial<Props> = {}) {
  return mount(BoardResultDialog, {
    props: { open: true, result: result(), mySeat: 'S', players: PEOPLE, ...props } as Props,
    global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub } },
  })
}

// An ion-button's `disabled`, as given (the wrapper renders no attribute).
function disabled(wrapper: ReturnType<typeof mountDialog>, cls: string): boolean {
  return wrapper.findAllComponents({ name: 'IonButton' }).find((b) => b.classes(cls))!.props('disabled')
}

// The header holds Leave and Last board; the dialog offers neither (#188).
function noLeaveOrReview(wrapper: ReturnType<typeof mountDialog>) {
  expect(wrapper.find('.result-leave').exists()).toBe(false)
  expect(wrapper.find('.result-review').exists()).toBe(false)
  expect(wrapper.find('.foot-links').exists()).toBe(false)
  expect(wrapper.text()).not.toMatch(/Leave|Review/)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('BoardResultDialog: the result', () => {
  test('the contract by declarer and how it went, our score big, the tricks under it', () => {
    const wrapper = mountDialog()

    expect(wrapper.get('.result-title').text()).toBe('Board result')
    expect(wrapper.get('.dialog-contract').text().replace(/\s+/g, ' ')).toBe('4♠ by South +1')
    expect(wrapper.get('.dialog-made').classes()).toContain('made-ok')
    expect(wrapper.get('.dialog-score').text()).toBe('+450')
    expect(wrapper.get('.dialog-score').classes()).not.toContain('score-minus')
    expect(wrapper.get('.dialog-detail').text()).toBe('11 tricks · by claim')
    expect(wrapper.find('.dialog-side').exists()).toBe(false)
    // Nothing else to read: no matchpoints, tables, analysis or vote yet.
    expect(wrapper.find('.dialog-mp').exists()).toBe(false)
    expect(wrapper.find('.others').exists()).toBe(false)
    expect(wrapper.find('.dialog-skeleton').exists()).toBe(false)
    expect(wrapper.find('.dialog-dd').exists()).toBe(false)
    expect(wrapper.find('.vote').exists()).toBe(false)
    expect(wrapper.find('.result-foot').exists()).toBe(false)
    noLeaveOrReview(wrapper)
  })

  test("the defenders' side sees it as a minus, someone without a seat as N-S's", () => {
    const defender = mountDialog({ mySeat: 'E' })
    expect(defender.get('.dialog-score').text()).toBe('−450')
    expect(defender.get('.dialog-score').classes()).toContain('score-minus')

    const outsider = mountDialog({ mySeat: null })
    expect(outsider.get('.dialog-side').text()).toBe('N-S')
    expect(outsider.get('.dialog-score-value').text()).toBe('+450')
  })

  test('played out and down doubled: one trick, the undertrick in red', () => {
    const wrapper = mountDialog({
      result: result({ doubled: 1, made_by: -1, tricks_won: 1, score_ns: -100, claimed: false }),
    })

    expect(wrapper.get('.dialog-contract').text().replace(/\s+/g, ' ')).toBe('4♠X by South −1')
    expect(wrapper.get('.dialog-made').classes()).toContain('made-down')
    expect(wrapper.get('.dialog-detail').text()).toBe('1 trick')
  })

  test('a passed-out board', () => {
    const wrapper = mountDialog({ result: PASSED_OUT })

    expect(wrapper.get('.dialog-contract').text()).toBe('Passed out')
    expect(wrapper.get('.dialog-score').text()).toBe('0')
    expect(wrapper.find('.dialog-detail').exists()).toBe(false)
  })

  test("the matchpoints for our side, with a bar, once another table played it", () => {
    const wrapper = mountDialog({ mySeat: 'E', extras: { matchpoints: { ns: 1, ew: 2 }, top: 3 } })

    expect(wrapper.get('.dialog-mp-value').text()).toBe('67 %')
    expect(wrapper.get('.dialog-mp-bar').attributes('style')).toContain('width: 67%')

    expect(mountDialog({ extras: { matchpoints: { ns: 0, ew: 0 }, top: 0 } }).find('.dialog-mp').exists()).toBe(false)
  })

  test('without a result or a set, only the frame', () => {
    const wrapper = mountDialog({ result: null })

    expect(wrapper.find('.dialog-hero').exists()).toBe(false)
    expect(wrapper.get('.result-title').text()).toBe('Board result')
  })
})

describe('BoardResultDialog: the other tables', () => {
  test('a skeleton line while they are read', () => {
    const wrapper = mountDialog({ othersLoading: true })

    expect(wrapper.find('.others-skeleton').exists()).toBe(true)
    expect(wrapper.find('.others').exists()).toBe(false)
  })

  test('up to four, ours tinted, and the whole list a tap away when longer', () => {
    const wrapper = mountDialog({ others: others(6), playingId: 42, boardId: 7 })

    const rows = wrapper.findAll('.others-row:not(.others-head)')
    expect(rows).toHaveLength(OTHER_TABLES_MAX)
    expect(rows.map((r) => r.get('.others-contract').text())).toEqual(['4♠ S +2', '4♠ S +1', '4♠ S =', '4♠ S −1'])
    expect(rows.map((r) => r.get('.others-score').text())).toEqual(['+480', '+450', '+420', '+390'])
    expect(rows[2].classes()).toContain('others-mine')
    expect(rows[2].attributes('aria-current')).toBe('true')
    expect(rows[0].attributes('aria-current')).toBeUndefined()
    const compare = wrapper.findAllComponents({ name: 'IonButton' }).find((b) => b.classes('others-compare'))
    expect(compare?.props('routerLink')).toBe('/boards/7/results')
    expect(compare?.text()).toBe('Compare with other tables')
  })

  test('four or fewer: no link; only this table: nothing at all', () => {
    const four = mountDialog({ others: others(4), playingId: 42, boardId: 7 })
    expect(four.findAll('.others-row:not(.others-head)')).toHaveLength(4)
    expect(four.find('.others-compare').exists()).toBe(false)

    expect(mountDialog({ others: others(1), playingId: 42, boardId: 7 }).find('.others').exists()).toBe(false)
  })
})

describe('BoardResultDialog: the double dummy line', () => {
  test('a skeleton line while it is read, then the line once ready', () => {
    expect(mountDialog({ ddLoading: true }).find('.dd-skeleton').exists()).toBe(true)

    const wrapper = mountDialog({ doubleDummy: READY, ddLoading: true })
    expect(wrapper.find('.dd-skeleton').exists()).toBe(false)
    expect(wrapper.get('.dialog-dd').text()).toBe('Double dummy: 4♠ by South makes 10')
  })

  test('still pending once the reads are done, or no solver: nothing', () => {
    expect(mountDialog({ doubleDummy: { status: 'pending', table: null } }).find('.dialog-dd').exists()).toBe(false)
    expect(mountDialog({ doubleDummy: { status: 'unavailable', table: null } }).find('.dialog-dd').exists()).toBe(
      false,
    )
    expect(mountDialog({ doubleDummy: READY, result: PASSED_OUT }).find('.dialog-dd').exists()).toBe(false)
  })
})

describe('BoardResultDialog: the countdown and the vote', () => {
  test('the ring counts down to next_board_at, then the deal', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const wrapper = mountDialog({ vote: true, nextBoardAt: inSeconds(12) })

    const ring = () => wrapper.get('.vote-ring')
    expect(ring().text()).toBe('0:12')
    expect(ring().attributes('aria-label')).toBe('Next board in 0:12')
    expect(ring().attributes('style')).toContain(`--ring-fill: ${Math.round((12 / NEXT_BOARD_SECONDS) * 100)}%`)
    expect(wrapper.get('.vote-button').text()).toBe('Deal next board')

    vi.advanceTimersByTime(2000)
    await nextTick()
    expect(ring().text()).toBe('0:10')

    vi.advanceTimersByTime(10_000)
    await nextTick()
    expect(ring().text()).toBe('0:00')
    expect(wrapper.get('.vote-button').text()).toBe('Dealing…')
    expect(disabled(wrapper, 'vote-button')).toBe(true)
  })

  test('a full ring at most, and no ring without a deadline', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    expect(mountDialog({ vote: true, nextBoardAt: inSeconds(40) }).get('.vote-ring').attributes('style')).toContain(
      '--ring-fill: 100%',
    )

    const none = mountDialog({ vote: true })
    expect(none.find('.vote-ring').exists()).toBe(false)
    expect(none.get('.vote-button').text()).toBe('Deal next board')
  })

  test('the vote, then whom it waits for', async () => {
    const wrapper = mountDialog({ vote: true, ready: ['N'] })

    await wrapper.get('.vote-button').trigger('click')
    expect(wrapper.emitted('next')).toHaveLength(1)

    await wrapper.setProps({ ready: ['N', 'S'] })
    expect(wrapper.get('.vote-button').text()).toBe('Waiting for bob, di…')
    expect(disabled(wrapper, 'vote-button')).toBe(true)
  })

  test('robots never hold it up; a seat nobody names is called by its name', async () => {
    const players = { N: person(5, 'robot-1', true), E: null, S: PEOPLE.S, W: person(6, 'robot-2', true) }
    const wrapper = mountDialog({ vote: true, ready: ['S'], players })
    expect(wrapper.get('.vote-button').text()).toBe('Waiting for East…')

    await wrapper.setProps({ ready: ['E', 'S'] })
    expect(wrapper.get('.vote-button').text()).toBe('Dealing…')
  })

  test('the vote on its way: the button spins', () => {
    const wrapper = mountDialog({ vote: true, busy: true })

    expect(disabled(wrapper, 'vote-button')).toBe(true)
    expect(wrapper.find('.vote-button ion-spinner').exists()).toBe(true)
  })

  test('no seat of our own: the vote still shows', () => {
    const wrapper = mountDialog({ vote: true, mySeat: null, ready: ['N'] })

    expect(wrapper.get('.vote-button').text()).toBe('Deal next board')
  })

  test('the footer holds the vote and nothing else: no Leave or Review (#188)', () => {
    const wrapper = mountDialog({ vote: true, nextBoardAt: inSeconds(10) })

    const foot = wrapper.get('.result-foot')
    expect(foot.find('.vote-ring').exists()).toBe(true)
    expect(foot.find('.vote-button').exists()).toBe(true)
    expect(foot.findAllComponents({ name: 'IonButton' })).toHaveLength(1)
    noLeaveOrReview(wrapper)
  })
})

describe("BoardResultDialog after a set's last board", () => {
  test("the set's results, with no countdown and no vote", () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const wrapper = mountDialog({ set: setOver(), vote: true, nextBoardAt: inSeconds(10) })

    expect(wrapper.get('.result-title').text()).toBe('Set results')
    expect(wrapper.get('.set-results .set-title').text()).toBe('Set 3 over')
    expect(wrapper.findAll('.set-board')).toHaveLength(4)
    expect(wrapper.find('.dialog-hero').exists()).toBe(false)
    expect(wrapper.find('.vote').exists()).toBe(false)
    expect(wrapper.find('.result-foot').exists()).toBe(false)
    noLeaveOrReview(wrapper)
  })
})

describe('BoardResultDialog: closing', () => {
  test('the X asks the parent to close it', async () => {
    const wrapper = mountDialog()

    const close = wrapper.findAllComponents({ name: 'IonButton' }).find((b) => b.classes('result-close'))!
    expect(close.attributes('aria-label')).toBe('Close')
    await close.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  test('the backdrop or Escape close it while open; a close by the parent says nothing', async () => {
    const wrapper = mountDialog()
    const modal = wrapper.findComponent(modalStub)

    modal.vm.$emit('didDismiss')
    await nextTick()
    expect(wrapper.emitted('close')).toHaveLength(1)

    await wrapper.setProps({ open: false })
    modal.vm.$emit('didDismiss')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  test('the content stays until it has finished closing, and comes back on opening', async () => {
    const wrapper = mountDialog({ open: false })
    expect(wrapper.find('.result-sheet').exists()).toBe(false)

    await wrapper.setProps({ open: true })
    expect(wrapper.find('.result-sheet').exists()).toBe(true)

    await wrapper.setProps({ open: false })
    expect(wrapper.find('.result-sheet').exists()).toBe(true)
    wrapper.findComponent(modalStub).vm.$emit('didDismiss')
    await nextTick()
    expect(wrapper.find('.result-sheet').exists()).toBe(false)
  })
})

describe('ResultPill', () => {
  test('"Result · 0:12", counting down, and a tap opens the dialog', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const wrapper = mount(ResultPill, { props: { nextBoardAt: inSeconds(12) } })

    expect(wrapper.text()).toBe('Result · 0:12')
    vi.advanceTimersByTime(3000)
    await nextTick()
    expect(wrapper.text()).toBe('Result · 0:09')

    await wrapper.get('.result-pill').trigger('click')
    expect(wrapper.emitted('open')).toHaveLength(1)
  })

  test('no countdown: "Result" alone', () => {
    expect(mount(ResultPill).text()).toBe('Result')
  })
})
