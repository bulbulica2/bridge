import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { nextTick } from 'vue'
import ClaimAnswerDialog from '@/components/ClaimAnswerDialog.vue'
import type { Bid, Card, Claim, Playing, Suit, Trick } from '@/services/game'
import type { Seat } from '@/services/tables'

// Players 1–4 sit N, E, S, W; South (3) declares 4♠ and North is dummy.
const PLAYERS = {
  N: { id: 1, name: 'Ann', username: 'ann', description: null },
  E: { id: 2, name: 'Bob', username: 'bob', description: null },
  S: { id: 3, name: 'Cy', username: 'cy', description: null },
  W: { id: 4, name: 'Di', username: 'di', description: null },
}
const ROBOT_NORTH = { ...PLAYERS, N: { ...PLAYERS.N, username: 'robot-1', is_robot: true } }
const FOUR_SPADES: Bid = { id: 20, call: '4S', level: 4, strain: 'S', special: false }

const RANKS: Record<string, number> = { J: 12, Q: 13, K: 14, A: 15 }
function c(name: string): Card {
  const suit = name[0] as Suit
  const rank = RANKS[name.slice(1)] ?? Number(name.slice(1))
  return { id: 'SHDC'.indexOf(suit) * 20 + rank, suit, rank, rank_name: name.slice(1) }
}
const cards = (...names: string[]) => names.map(c)

function tricks(count: number): Trick[] {
  return Array.from({ length: count }, (_, round) => ({
    round: round + 1,
    leader: 'S' as Seat,
    cards: (['S', 'W', 'N', 'E'] as Seat[]).map((seat, i) => ({
      seat,
      card: { id: 1000 + round * 4 + i, suit: 'C' as Suit, rank: 2, rank_name: '2' },
    })),
    winner: 'S' as Seat,
  }))
}

// Clubs first in the hand as given: the dialog lays them out in bridge order.
const SOUTH = cards('D2', 'HK', 'SA', 'SK', 'S7')

const NOW = Date.parse('2026-10-04T12:00:00Z')
const inSeconds = (s: number) => new Date(NOW + s * 1000).toISOString()

function pending(overrides: Partial<Claim> = {}): Claim {
  return { seat: 'S', tricks: 4, hand: SOUTH, accepted: [], expires_at: '', ...overrides }
}

// 8 tricks gone, 5 left, South claiming.
function state(overrides: Partial<Playing> = {}): Playing & { claim: Claim } {
  return {
    phase: 'play',
    playing_id: 42,
    board: { id: 7, number: 7, dealer: 'N', vulnerable: '' },
    players: PLAYERS,
    turn: 'S',
    acting_user_id: 3,
    auction: [],
    contract: { bid: FOUR_SPADES, doubled: 0, declarer: 'S', dummy: 'N' },
    tricks: tricks(8),
    current_trick: [],
    tricks_won: { ns: 8, ew: 0 },
    dummy_hand: [],
    claim: pending(),
    claim_locked: false,
    result: null,
    deal: null,
    ready: null,
    my_seat: 'S',
    hand: [],
    ...overrides,
  } as Playing & { claim: Claim }
}

const modalStub = {
  name: 'IonModal',
  props: ['isOpen', 'backdropDismiss'],
  emits: ['didDismiss'],
  template: '<div class="modal-stub" :data-open="isOpen" :data-backdrop="String(backdropDismiss)"><slot /></div>',
}

type Props = InstanceType<typeof ClaimAnswerDialog>['$props']

function mountDialog(props: Partial<Props> = {}) {
  return mount(ClaimAnswerDialog, {
    props: { open: true, state: state(), mySeat: 'E', players: PLAYERS, ...props } as Props,
    global: { stubs: { IonModal: modalStub, 'ion-modal': modalStub } },
  })
}

// An ion-button's `disabled`, as given (the wrapper renders no attribute).
function disabled(wrapper: ReturnType<typeof mountDialog>, cls: string): boolean {
  return wrapper.findAllComponents({ name: 'IonButton' }).find((b) => b.classes(cls))!.props('disabled')
}

const buttons = (wrapper: ReturnType<typeof mountDialog>) =>
  wrapper.findAll('.claim-buttons ion-button').map((b) => b.text())

afterEach(() => {
  vi.useRealTimers()
})

describe('ClaimAnswerDialog: what it shows', () => {
  test('a centred dialog titled Claim, with the claim in one line and what it makes', () => {
    const wrapper = mountDialog()

    const modal = wrapper.get('.modal-stub')
    expect(modal.classes()).toContain('claim-answer-dialog')
    expect(modal.attributes('aria-labelledby')).toBe('claim-answer-title')
    expect(modal.attributes('breakpoints')).toBeUndefined()
    expect(wrapper.get('.claim-answer-title').text()).toBe('Claim')
    expect(wrapper.get('.claim-answer-text').text()).toBe('South claims 4 of 5')
    // 8 + 4 = 12 tricks in 4♠: +2, from South's side.
    expect(wrapper.get('.claim-answer-outcome').text()).toBe('4♠ +2')
    expect(wrapper.get('.claim-answer-outcome').classes()).not.toContain('down')
  })

  test('the claimer reads it as theirs; a claim going down is marked', () => {
    const wrapper = mountDialog({ mySeat: 'S', state: state({ tricks_won: { ns: 5, ew: 3 }, claim: pending({ tricks: 4 }) }) })

    expect(wrapper.get('.claim-answer-text').text()).toBe('You claim 4 of 5')
    expect(wrapper.get('.claim-answer-outcome').text()).toBe('4♠ −1')
    expect(wrapper.get('.claim-answer-outcome').classes()).toContain('down')
  })

  test('no outcome without a contract to make', () => {
    const wrapper = mountDialog({ state: state({ contract: null }) })

    expect(wrapper.find('.claim-answer-outcome').exists()).toBe(false)
    expect(wrapper.findAll('.claim-answers li')).toHaveLength(0)
  })

  test("the claimer's cards in bridge order, spades first", () => {
    const wrapper = mountDialog()

    const hand = wrapper.get('.claim-answer-hand')
    expect(hand.classes()).toContain('single-row')
    expect(hand.attributes('aria-label')).toBe("South's cards")
    expect(hand.findAll('.playing-card').map((card) => card.attributes('aria-label'))).toEqual([
      'A of spades',
      'K of spades',
      '7 of spades',
      'K of hearts',
      '2 of diamonds',
    ])
  })

  test('each answerer with a tick once accepted, "you" for the viewer', () => {
    const wrapper = mountDialog({ state: state({ claim: pending({ accepted: ['W'] }) }) })

    const east = wrapper.get('[data-seat="E"]')
    const west = wrapper.get('[data-seat="W"]')
    expect(wrapper.findAll('.claim-answers li').map((li) => li.attributes('data-seat'))).toEqual(['E', 'W'])
    expect(east.text()).toBe('… East you to answer')
    expect(east.classes()).not.toContain('is-accepted')
    expect(west.text()).toBe('✓ West di accepted')
    expect(west.classes()).toContain('is-accepted')
  })

  test('a seat without a player names nobody', () => {
    const wrapper = mountDialog({ players: { ...PLAYERS, W: null } })

    expect(wrapper.get('[data-seat="W"] .claim-answer-who').text()).toBe('')
  })
})

describe('ClaimAnswerDialog: the countdown ring', () => {
  test('counts down from expires_at, full at 10 s, red under 4 s', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const wrapper = mountDialog({ state: state({ claim: pending({ expires_at: inSeconds(10) }) }) })

    const ring = () => wrapper.get('.claim-ring')
    expect(ring().attributes('role')).toBe('timer')
    expect(ring().attributes('aria-label')).toBe('Time left to answer: 0:10')
    expect(ring().text()).toBe('0:10')
    expect(ring().attributes('style')).toContain('--ring-fill: 100%')
    expect(ring().classes()).not.toContain('claim-ring-urgent')

    vi.advanceTimersByTime(3000)
    await nextTick()
    expect(ring().text()).toBe('0:07')
    expect(ring().attributes('style')).toContain('--ring-fill: 70%')

    vi.advanceTimersByTime(3000)
    await nextTick()
    expect(ring().text()).toBe('0:04')
    expect(ring().classes()).not.toContain('claim-ring-urgent')

    vi.advanceTimersByTime(1000)
    await nextTick()
    expect(ring().text()).toBe('0:03')
    expect(ring().classes()).toContain('claim-ring-urgent')
  })

  test('a deadline further off than 10 s still fills the ring only once', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const wrapper = mountDialog({ state: state({ claim: pending({ expires_at: inSeconds(30) }) }) })

    expect(wrapper.get('.claim-ring').attributes('style')).toContain('--ring-fill: 100%')
  })

  test('no ring without expires_at', () => {
    expect(mountDialog().find('.claim-ring').exists()).toBe(false)
  })
})

describe('ClaimAnswerDialog: the buttons', () => {
  test('an answerer gets Accept (orange) and Reject (outline)', async () => {
    const wrapper = mountDialog()

    expect(buttons(wrapper)).toEqual(['Accept', 'Reject'])
    const button = (cls: string) => wrapper.findAllComponents({ name: 'IonButton' }).find((b) => b.classes(cls))!
    expect(button('accept').props('color')).toBe('action')
    expect(button('reject').props('fill')).toBe('outline')
    expect(wrapper.find('.claim-answer-waiting').exists()).toBe(false)

    await wrapper.get('.accept').trigger('click')
    await wrapper.get('.reject').trigger('click')
    expect(wrapper.emitted('accept')).toHaveLength(1)
    expect(wrapper.emitted('reject')).toHaveLength(1)
  })

  test('the claimer gets Withdraw, and whom the claim waits for', async () => {
    const wrapper = mountDialog({ mySeat: 'S' })

    expect(buttons(wrapper)).toEqual(['Withdraw'])
    expect(wrapper.get('.claim-answer-waiting').text()).toBe('Waiting for East and West…')
    await wrapper.get('.withdraw').trigger('click')
    expect(wrapper.emitted('withdraw')).toHaveLength(1)
  })

  test('after accepting, the buttons go and "Waiting for West…" shows', () => {
    const wrapper = mountDialog({ state: state({ claim: pending({ accepted: ['E'] }) }) })

    expect(wrapper.find('.claim-buttons').exists()).toBe(false)
    expect(wrapper.get('.claim-answer-waiting').text()).toBe('Waiting for West…')
  })

  test('dummy and a kibitzer get no buttons', () => {
    expect(mountDialog({ mySeat: 'N' }).find('.claim-buttons').exists()).toBe(false)
    expect(mountDialog({ mySeat: null }).find('.claim-buttons').exists()).toBe(false)
    expect(mountDialog({ mySeat: null }).get('.claim-answer-waiting').text()).toBe('Waiting for East and West…')
  })

  test('disabled while an answer is on its way', () => {
    const answerer = mountDialog({ busy: true })
    expect(disabled(answerer, 'accept')).toBe(true)
    expect(disabled(answerer, 'reject')).toBe(true)
    expect(disabled(mountDialog({ mySeat: 'S', busy: true }), 'withdraw')).toBe(true)
    expect(disabled(mountDialog(), 'accept')).toBe(false)
  })

  test('disabled once the time is up', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const claim = pending({ expires_at: inSeconds(2) })
    const answerer = mountDialog({ state: state({ claim }) })
    const claimer = mountDialog({ mySeat: 'S', state: state({ claim }) })
    expect(disabled(answerer, 'accept')).toBe(false)
    expect(disabled(claimer, 'withdraw')).toBe(false)

    vi.advanceTimersByTime(2000)
    await nextTick()
    expect(disabled(answerer, 'accept')).toBe(true)
    expect(disabled(answerer, 'reject')).toBe(true)
    expect(disabled(claimer, 'withdraw')).toBe(true)
    expect(answerer.get('.claim-ring').text()).toBe('0:00')
  })
})

describe('ClaimAnswerDialog: for a robot declarer', () => {
  const forRobot = (claim: Claim) =>
    state({
      players: ROBOT_NORTH,
      contract: { bid: FOUR_SPADES, doubled: 0, declarer: 'N', dummy: 'S' },
      claim,
    })

  test("the claim made for declarer's seat is ours to withdraw, under its seat's name", () => {
    const wrapper = mountDialog({ state: forRobot(pending({ seat: 'N' })), mySeat: 'S', actsFor: 'N', players: ROBOT_NORTH })

    expect(wrapper.get('.claim-answer-title').text()).toBe('Claim for North')
    expect(wrapper.get('.claim-answer-text').text()).toBe('You claim 4 of 5')
    expect(buttons(wrapper)).toEqual(['Withdraw'])
    expect(wrapper.find('.claim-answer-close').exists()).toBe(false)
  })

  test("a defender's claim is ours to answer, on declarer's behalf", () => {
    const wrapper = mountDialog({
      state: forRobot(pending({ seat: 'E', tricks: 0 })),
      mySeat: 'S',
      actsFor: 'N',
      players: ROBOT_NORTH,
    })

    expect(wrapper.get('.claim-answer-title').text()).toBe('Claim')
    expect(wrapper.get('.claim-answer-text').text()).toBe('East concedes all 5')
    expect(buttons(wrapper)).toEqual(['Accept', 'Reject'])
    expect(wrapper.get('[data-seat="N"]').text()).toContain('you')
  })
})

describe('ClaimAnswerDialog: closing', () => {
  test('those with something to do get no X and no backdrop dismiss', () => {
    for (const mySeat of ['E', 'S'] as Seat[]) {
      const wrapper = mountDialog({ mySeat })
      expect(wrapper.find('.claim-answer-close').exists()).toBe(false)
      expect(wrapper.get('.modal-stub').attributes('data-backdrop')).toBe('false')
    }
  })

  test('anyone else closes it with the X, the backdrop or Escape', async () => {
    const wrapper = mountDialog({ mySeat: 'N' })

    expect(wrapper.get('.modal-stub').attributes('data-backdrop')).toBe('true')
    const close = wrapper.findAllComponents({ name: 'IonButton' }).find((b) => b.classes('claim-answer-close'))!
    expect(close.attributes('aria-label')).toBe('Close')
    await close.trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)

    wrapper.findComponent(modalStub).vm.$emit('didDismiss')
    await nextTick()
    expect(wrapper.emitted('close')).toHaveLength(2)
  })

  test('an answerer who accepted may close it', () => {
    const wrapper = mountDialog({ state: state({ claim: pending({ accepted: ['E'] }) }) })

    expect(wrapper.find('.claim-answer-close').exists()).toBe(true)
  })

  test('closed by the parent (the claim gone), it says nothing and keeps the last claim until it has closed', async () => {
    const wrapper = mountDialog()
    const modal = wrapper.findComponent(modalStub)

    await wrapper.setProps({ open: false, state: null })
    expect(wrapper.get('.claim-answer-text').text()).toBe('South claims 4 of 5')

    modal.vm.$emit('didDismiss')
    await nextTick()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.find('.claim-answer').exists()).toBe(false)
  })

  test('opens on the next claim with that claim', async () => {
    const wrapper = mountDialog({ open: false, state: null })
    expect(wrapper.find('.claim-answer').exists()).toBe(false)

    await wrapper.setProps({ open: true, state: state({ claim: pending({ seat: 'W', tricks: 2 }) }) })
    expect(wrapper.get('.claim-answer-text').text()).toBe('West claims 2 of 5')
  })
})
