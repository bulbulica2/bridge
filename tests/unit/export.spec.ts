import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { IonActionSheet } from '@ionic/vue'
import http from '@/services/http'
import type { PlayingReview } from '@/services/history'
import type { Bid, Card, PlayedCard, Suit, Trick } from '@/services/game'
import type { Seat } from '@/services/tables'
import type { PublicUser } from '@/services/users'
import { useAuthStore } from '@/stores/auth'
import { useHistoryStore } from '@/stores/history'
import {
  boardJson,
  boardPbn,
  boardText,
  claimNote,
  exportFileName,
  handText,
  pbnHand,
  playerLabel,
  playingExtras,
} from '@/utils/export'
import BoardPrintout from '@/components/BoardPrintout.vue'
import PlayingReviewPage from '@/views/PlayingReviewPage.vue'

vi.mock('@/services/http', () => ({
  default: { get: vi.fn() },
}))

const route = { params: { id: '42' } as Record<string, string> }
vi.mock('vue-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('vue-router')>()),
  useRoute: () => route,
}))
vi.mock('@ionic/vue', async (importOriginal) => {
  const { onMounted } = await import('vue')
  return {
    ...(await importOriginal<typeof import('@ionic/vue')>()),
    useIonRouter: () => ({ navigate: vi.fn() }),
    onIonViewWillEnter: (hook: () => void) => onMounted(hook),
  }
})
const toast = vi.fn()
vi.mock('@/utils/toast', () => ({ showToast: (...args: unknown[]) => toast(...args) }))

function user(id: number, username: string, robot = false): PublicUser {
  return { id, name: username.toUpperCase(), username, description: null, is_robot: robot }
}

const ann = user(1, 'ann')
const bo = user(2, 'bo')
const cy = user(3, 'cy')
const robot = user(4, 'robot-1', true)

const card = (suit: Suit, rank: number): Card => ({
  id: 'SHDC'.indexOf(suit) * 20 + rank,
  suit,
  rank,
  rank_name: String(rank),
})
const cards = (suit: Suit, ...ranks: number[]) => ranks.map((rank) => card(suit, rank))

// A real deal (J = 12 … A = 15, no 11): West is void in spades.
const DEAL: Record<Seat, Card[]> = {
  N: [...cards('S', 15, 14, 7, 3), ...cards('H', 13, 12, 2), ...cards('D', 10, 9, 4), ...cards('C', 14, 8, 2)],
  E: [...cards('S', 13, 12, 10, 9), ...cards('H', 15, 14, 5), ...cards('D', 8, 7), ...cards('C', 13, 12, 10, 9)],
  S: [...cards('S', 8, 6, 5, 4, 2), ...cards('H', 10, 9), ...cards('D', 15, 14, 13), ...cards('C', 15, 7, 3)],
  W: [...cards('H', 8, 7, 6, 4, 3), ...cards('D', 12, 6, 5, 3, 2), ...cards('C', 6, 5, 4)],
}

const bid = (id: number, call: string, level: number | null = null): Bid => ({
  id,
  call,
  level,
  strain: level ? (call.slice(1) as Bid['strain']) : null,
  special: level === null,
})
const pass = bid(1, 'P')
const oneSpade = bid(7, '1S', 1)
const twoSpades = bid(12, '2S', 2)
const fourSpades = bid(22, '4S', 4)

const NEXT: Record<Seat, Seat> = { N: 'E', E: 'S', S: 'W', W: 'N' }

// Thirteen tricks, the i-th card of each hand in trick i (the export doesn't
// check the rules), East leading first. North wins the first ten, East the
// last three: 4♠ by North, made exactly.
function playTricks(): Trick[] {
  const tricks: Trick[] = []
  let leader: Seat = 'E'
  for (let i = 0; i < 13; i += 1) {
    const order: Seat[] = [leader, NEXT[leader], NEXT[NEXT[leader]], NEXT[NEXT[NEXT[leader]]]]
    const winner: Seat = i < 10 ? 'N' : 'E'
    tricks.push({
      round: i + 1,
      leader,
      cards: order.map((seat): PlayedCard => ({ seat, card: DEAL[seat][i] })),
      winner,
    })
    leader = winner
  }
  return tricks
}

// Dealt by North: 1♠ – Pass – 2♠ – Pass – 4♠ and three passes.
function played(overrides: Partial<PlayingReview> = {}): PlayingReview {
  return {
    phase: 'finished',
    playing_id: 42,
    // The set's second board; 7 is its number in the database (PBN only).
    set: { id: 5, number: 1, board: 2, of: 4 },
    board: { id: 7, number: 7, dealer: 'N', vulnerable: 'E-W' },
    players: { N: ann, E: bo, S: cy, W: robot },
    turn: null,
    acting_user_id: null,
    auction: [
      { seat: 'N', bid: oneSpade },
      { seat: 'E', bid: pass },
      { seat: 'S', bid: twoSpades },
      { seat: 'W', bid: pass },
      { seat: 'N', bid: fourSpades },
      { seat: 'E', bid: pass },
      { seat: 'S', bid: pass },
      { seat: 'W', bid: pass },
    ],
    contract: { bid: fourSpades, doubled: 0, declarer: 'N', dummy: 'S' },
    tricks: playTricks(),
    current_trick: [],
    tricks_won: { ns: 10, ew: 3 },
    dummy_hand: [],
    claim: null,
    result: {
      contract: fourSpades,
      doubled: 0,
      declarer: 'N',
      tricks_won: 10,
      score_ns: 420,
      made_by: 0,
      claimed: false,
    },
    deal: DEAL,
    ...overrides,
  }
}

// Eight tricks (all North's), North leads the ninth, East follows, then the
// claim is accepted: declarer ends with 10, so 2 of the last 5.
function claimed(): PlayingReview {
  const tricks = playTricks()
  return played({
    tricks: tricks.slice(0, 8),
    current_trick: tricks[8].cards.slice(0, 2),
    tricks_won: { ns: 8, ew: 0 },
    result: { ...played().result!, claimed: true },
  })
}

function passedOut(): PlayingReview {
  return played({
    auction: (['N', 'E', 'S', 'W'] as Seat[]).map((seat) => ({ seat, bid: pass })),
    contract: null,
    tricks: null,
    current_trick: null,
    tricks_won: null,
    dummy_hand: null,
    result: {
      contract: null,
      doubled: null,
      declarer: null,
      tricks_won: null,
      score_ns: 0,
      made_by: null,
      claimed: false,
    },
  })
}

// Finished before the backend kept the calls and cards.
const unrecorded = () => played({ auction: [], tricks: [], current_trick: [] })

beforeEach(() => {
  setActivePinia(createPinia())
  vi.resetAllMocks()
  route.params = { id: '42' }
})

describe('export pieces', () => {
  test('a hand by suit, tens as 10 and a void as a dash', () => {
    expect(handText(DEAL.N)).toBe('♠ A K 7 3  ♥ Q J 2  ♦ 10 9 4  ♣ K 8 2')
    expect(handText(DEAL.W)).toBe('♠ —  ♥ 8 7 6 4 3  ♦ J 6 5 3 2  ♣ 6 5 4')
  })

  test('a PBN hand: T for the ten, an empty void', () => {
    expect(pbnHand(DEAL.E)).toBe('QJT9.AK5.87.QJT9')
    expect(pbnHand(DEAL.W)).toBe('.87643.J6532.654')
  })

  test('players are marked as robots, a gone account says so', () => {
    expect(playerLabel(ann)).toBe('ANN @ann')
    expect(playerLabel(robot)).toBe('ROBOT-1 @robot-1 (robot)')
    expect(playerLabel(null)).toBe('(account deleted)')
  })

  test('file names carry the board and the playing', () => {
    expect(exportFileName(played(), 'pbn')).toBe('board-7-playing-42.pbn')
  })

  test('the JSON is the review as received', () => {
    expect(JSON.parse(boardJson(played()))).toEqual(played())
  })
})

describe('playingExtras', () => {
  const board = (playingId: number, ns: number) => ({
    board: { id: 7, number: 7, dealer: 'N' as const, vulnerable: '' as const },
    top: 4,
    results: [{ playing_id: playingId, matchpoints: { ns, ew: 4 - ns } }],
  })
  const set = (playingId: number) => ({ boards: [{ playing_id: playingId, top: 2, matchpoints: { ns: 2, ew: 0 } }] })

  test("a board's results first, else any cached set holding the playing, else nothing", () => {
    const results = { 7: board(42, 3) } as never
    const sets = { 5: set(43) } as never

    expect(playingExtras(results, sets, 7, 42)).toEqual({ matchpoints: { ns: 3, ew: 1 }, top: 4 })
    expect(playingExtras(results, sets, 7, 43)).toEqual({ matchpoints: { ns: 2, ew: 0 }, top: 2 })
    expect(playingExtras(results, sets, null, 43)).toEqual({ matchpoints: { ns: 2, ew: 0 }, top: 2 })
    expect(playingExtras(results, sets, 8, 44)).toEqual({})
    expect(playingExtras(results, sets, 7, null)).toEqual({})
  })
})

describe('boardText', () => {
  test('names the board by its place in the set, plain Board outside one, never its number', () => {
    expect(boardText(played({ set: null })).split('\n')[0]).toBe('Board (playing #42)')
    expect(boardText(played({ set: undefined })).split('\n')[0]).toBe('Board (playing #42)')
  })

  test('a played board: hands, every call, every trick, the result', () => {
    const text = boardText(played(), { matchpoints: { ns: 3, ew: 1 }, top: 4 })
    const lines = text.split('\n')

    expect(lines[0]).toBe('Board 2 of 4 (playing #42)')
    expect(lines[1]).toBe('Dealer: North · Vulnerable: E-W')
    expect(text).toContain('West   ROBOT-1 @robot-1 (robot)')
    expect(text).toContain('North  ♠ A K 7 3  ♥ Q J 2  ♦ 10 9 4  ♣ K 8 2')
    // The grid starts in the dealer's column, West first.
    expect(text).toContain(
      ['Auction', 'West   North  East   South', '       1♠     Pass   2♠', 'Pass   4♠     Pass   Pass', 'Pass'].join(
        '\n',
      ),
    )
    expect(text).toContain('Contract: 4♠ by North, dummy South')
    expect(text).toContain('Opening lead: ♠Q by East')
    expect(text).toContain(' 1. East leads: E ♠Q, S ♠8, W ♥8, N ♠A; won by North')
    expect(text).toContain(' 2. North leads: N ♠K, E ♠J, S ♠6, W ♥7; won by North')
    expect(text).toContain('13. East leads:')
    expect(lines.filter((line) => /^ ?\d+\. /.test(line))).toHaveLength(13)
    expect(text).toContain('Result: 4♠ N = · N-S +420')
    expect(text).toContain('Declarer took 10 tricks.')
    expect(text).toContain('Matchpoints: N-S 3 of 4 (75%), E-W 1 of 4 (25%)')
    expect(text).not.toContain('claim')
    expect(text.endsWith('\n')).toBe(true)
  })

  test('the board’s chat follows the auction, with the call each message is about', () => {
    const at = (h: number, m: number) => new Date(2026, 9, 5, h, m).toISOString()
    const text = boardText({
      ...played(),
      messages: [
        { id: 1, seat: 'E', user_id: 2, to: 'opponents', call_index: 2, body: 'What is 2♠?', created_at: at(12, 5) },
        { id: 2, seat: 'S', user_id: 3, to: 'opponents', call_index: 2, body: 'Natural, 6-9.', created_at: at(12, 6) },
        { id: 3, seat: 'N', user_id: 1, to: 'table', call_index: null, body: 'Well played', created_at: 'later' },
      ],
    })

    expect(text).toContain(
      [
        'Chat',
        '12:05 East (bo) to opponents, about 2♠: What is 2♠?',
        '12:06 South (cy) to opponents, about 2♠: Natural, 6-9.',
        'North (ann) to table: Well played',
      ].join('\n'),
    )
    expect(boardText(played())).not.toContain('Chat')
  })

  test('a claimed board: the unfinished trick, then where the claim came', () => {
    const text = boardText(claimed())

    expect(text).toContain(' 9. North leads: N ♦9, E ♦7 (not finished)')
    expect(text).toContain('Ended by an accepted claim during trick 9: declarer took 2 of the last 5.')
    expect(text).toContain('Result: 4♠ N = · N-S +420')
    expect(text).toContain('Declarer took 10 tricks, by claim.')
    expect(text).not.toContain('10. ')
  })

  test('a claim between tricks, and one before any card', () => {
    const tricks = playTricks()
    expect(claimNote(played({ tricks: tricks.slice(0, 3), current_trick: [], result: claimed().result }))).toBe(
      'Ended by an accepted claim after trick 3: declarer took 7 of the last 10.',
    )
    expect(claimNote(played({ tricks: [], current_trick: [], result: claimed().result }))).toBe(
      'Ended by an accepted claim before the opening lead: declarer took 10 of the last 13.',
    )
    expect(claimNote(played())).toBeNull()
  })

  test('a passed-out board: four passes, no play', () => {
    const text = boardText(passedOut())

    expect(text).toContain('       Pass   Pass   Pass\nPass')
    expect(text).toContain('Contract: Passed out')
    expect(text).not.toContain('\nPlay\n')
    expect(text).toContain('Result: Passed out · 0')
    expect(text).not.toContain('Declarer took')
  })

  test('an unrecorded board: the deal and the result, and why nothing else', () => {
    const text = boardText(unrecorded())

    expect(text).toContain("The auction and play of this board weren't recorded.")
    expect(text).toContain('Contract: 4♠ by North')
    expect(text).toContain('North  ♠ A K 7 3')
    expect(text).not.toContain('Auction')
    expect(text).toContain('Result: 4♠ N = · N-S +420')
  })
})

describe('boardPbn', () => {
  const lines = (review: PlayingReview) => boardPbn(review).split('\r\n')

  test('a played board: the mandatory tags in order, auction, play and score', () => {
    const pbn = lines(played())

    expect(pbn.slice(0, 19)).toEqual([
      '% PBN 2.1',
      '% EXPORT',
      '[Event "?"]',
      '[Site "?"]',
      '[Date "????.??.??"]',
      '[Board "7"]',
      '[West "robot-1"]',
      '[North "ann"]',
      '[East "bo"]',
      '[South "cy"]',
      '[Dealer "N"]',
      '[Vulnerable "EW"]',
      '[Deal "N:AK73.QJ2.T94.K82 QJT9.AK5.87.QJT9 86542.T9.AKQ.A73 .87643.J6532.654"]',
      '[Scoring "MP"]',
      '[Declarer "N"]',
      '[Contract "4S"]',
      '[Result "10"]',
      '[Auction "N"]',
      '1S Pass 2S Pass',
    ])
    expect(pbn[19]).toBe('4S Pass Pass Pass')
    expect(pbn[20]).toBe('[Play "E"]')
    // Fixed columns from the opening leader, E S W N, whoever led the trick.
    expect(pbn[21]).toBe('SQ S8 H8 SA')
    expect(pbn[22]).toBe('SJ S6 H7 SK')
    expect(pbn.slice(21, 34)).toHaveLength(13)
    expect(pbn[34]).toBe('[Score "NS 420"]')
    expect(pbn[35]).toBe('')
    expect(pbn).not.toContain('*')
  })

  test('a claimed board: dashes for the unplayed cards, then *', () => {
    const pbn = lines(claimed())
    const play = pbn.indexOf('[Play "E"]')

    expect(pbn.slice(play + 1, play + 11)).toEqual([
      'SQ S8 H8 SA',
      'SJ S6 H7 SK',
      'ST S5 H6 S7',
      'S9 S4 H4 S3',
      'HA S2 H3 HQ',
      'HK HT DJ HJ',
      'H5 H9 D6 H2',
      'D8 DA D5 DT',
      'D7 - - D9',
      '*',
    ])
    expect(pbn).toContain('[Result "10"]')
  })

  test('a passed-out board: Contract Pass, empty Declarer and Result, no play', () => {
    const pbn = lines(passedOut())

    expect(pbn).toContain('[Declarer ""]')
    expect(pbn).toContain('[Contract "Pass"]')
    expect(pbn).toContain('[Result ""]')
    expect(pbn).toContain('Pass Pass Pass Pass')
    expect(pbn.some((line) => line.startsWith('[Play'))).toBe(false)
    expect(pbn).toContain('[Score "NS 0"]')
  })

  test('an unrecorded board: the deal and contract without auction or play', () => {
    const pbn = lines(unrecorded())

    expect(pbn).toContain('[Contract "4S"]')
    expect(pbn.some((line) => line.startsWith('[Auction') || line.startsWith('[Play'))).toBe(false)
  })

  test('doubled contracts, and quotes in names are escaped', () => {
    const doubled = played({
      players: { N: { ...ann, username: 'a"n\\n' }, E: bo, S: cy, W: robot },
      result: { ...played().result!, doubled: 1 },
    })
    const pbn = lines(doubled)

    expect(pbn).toContain('[Contract "4SX"]')
    expect(pbn).toContain('[North "a\\"n\\\\n"]')
  })
})

describe('export on the review page', () => {
  function answer(data: unknown) {
    vi.mocked(http.get).mockResolvedValueOnce({ data: { status: 200, message: 'OK', data } })
  }

  async function openExport() {
    useAuthStore().user = { ...bo, email: 'bo@example.com' } as never
    answer(played())
    const wrapper = mount(PlayingReviewPage, { attachTo: document.body })
    await flushPromises()
    const button = wrapper.findAll('ion-button').find((b) => b.text().includes('Export'))!
    await button.trigger('click')
    const sheet = wrapper.findComponent(IonActionSheet)
    return { wrapper, sheet }
  }

  function readBlob(blob: Blob): Promise<string> {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.readAsText(blob)
    })
  }

  type Button = { text: string; handler?: () => unknown }
  const press = (buttons: Button[], text: string) => buttons.find((b) => b.text === text)!.handler!()

  test('Export opens the menu with every format', async () => {
    const { wrapper, sheet } = await openExport()

    expect(sheet.props('isOpen')).toBe(true)
    expect((sheet.props('buttons') as Button[]).map((b) => b.text)).toEqual([
      'Copy as text',
      'Download .txt',
      'Download .pbn',
      'Download .json',
      'Print / Save as PDF',
      'Cancel',
    ])
    wrapper.unmount()
  })

  test('Copy as text puts the summary, with matchpoints once known, on the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    const { wrapper, sheet } = await openExport()
    useHistoryStore().results[7] = {
      board: played().board!,
      top: 4,
      results: [
        {
          playing_id: 42,
          table_id: 1,
          players: played().players,
          contract: fourSpades,
          doubled: 0,
          declarer: 'N',
          tricks_won: 10,
          score_ns: 420,
          made_by: 0,
          matchpoints: { ns: 3, ew: 1 },
          finished_at: '2026-10-01T10:00:00Z',
        },
      ],
    }

    await press(sheet.props('buttons') as Button[], 'Copy as text')

    expect(writeText).toHaveBeenCalledWith(
      boardText(played(), { matchpoints: { ns: 3, ew: 1 }, top: 4 }),
    )
    expect(toast).toHaveBeenCalledWith('Board 2 of 4 copied as text.', 'success')
    wrapper.unmount()
  })

  test('a refused clipboard says so', async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no')) } })
    const { wrapper, sheet } = await openExport()

    await press(sheet.props('buttons') as Button[], 'Copy as text')

    expect(toast).toHaveBeenCalledWith(expect.stringContaining('Could not copy'), 'danger')
    wrapper.unmount()
  })

  test('Download .pbn hands over the PBN file', async () => {
    const createObjectURL = vi.fn(() => 'blob:board')
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const { wrapper, sheet } = await openExport()

    await press(sheet.props('buttons') as Button[], 'Download .pbn')

    expect(click).toHaveBeenCalledTimes(1)
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement
    expect(anchor.download).toBe('board-7-playing-42.pbn')
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0]
    expect(await readBlob(blob)).toBe(boardPbn(played()))
    click.mockRestore()
    wrapper.unmount()
  })

  test('Print shows the printout outside the app until the dialog closes', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {})
    const { wrapper, sheet } = await openExport()

    await press(sheet.props('buttons') as Button[], 'Print / Save as PDF')

    expect(print).toHaveBeenCalledTimes(1)
    expect(document.body.classList.contains('printing-board')).toBe(true)
    const printout = document.querySelector('body > .board-printout')!
    expect(printout.querySelector('h1')!.textContent).toBe('Board 2 of 4')
    expect(printout.textContent).toContain('ROBOT-1 @robot-1 (robot)')
    // Who is vulnerable, in words: bo sat East, on the vulnerable side.
    expect(printout.querySelector('.meta')!.textContent).toContain('Vulnerable: E-W (you)')
    expect(printout.querySelectorAll('.play tbody tr')).toHaveLength(13)

    window.dispatchEvent(new Event('afterprint'))
    await flushPromises()

    expect(document.querySelector('.board-printout')).toBeNull()
    expect(document.body.classList.contains('printing-board')).toBe(false)
    print.mockRestore()
    wrapper.unmount()
  })
})

describe('alerts in the exports', () => {
  // North's 1♠ explained, South's 2♠ alerted with nothing said.
  function alerted(): PlayingReview {
    const review = played()
    review.auction![0] = { ...review.auction![0], alert: { explanation: 'Five or more spades' } }
    review.auction![2] = { ...review.auction![2], alert: { explanation: null } }
    return review
  }

  test('the text lists every alert under the auction', () => {
    const lines = boardText(alerted()).split('\n')
    const at = lines.indexOf('Alerts')

    expect(at).toBeGreaterThan(lines.indexOf('Auction'))
    expect(lines.slice(at, at + 4)).toEqual([
      'Alerts',
      '1♠ by North: Five or more spades',
      '2♠ by South: Alerted, no explanation given.',
      '',
    ])
    expect(boardText(played())).not.toContain('Alerts')
  })

  test('PBN marks each alerted call with a note, the notes after the auction', () => {
    const pbn = boardPbn(alerted()).split('\r\n')
    const at = pbn.indexOf('[Auction "N"]')

    expect(pbn.slice(at + 1, at + 5)).toEqual([
      '1S =1= Pass 2S =2= Pass',
      '4S Pass Pass Pass',
      '[Note "1:Five or more spades"]',
      '[Note "2:Alerted, no explanation given."]',
    ])
    expect(pbn[at + 5]).toBe('[Play "E"]')
  })

  test('the JSON keeps the alerts as received', () => {
    expect(JSON.parse(boardJson(alerted())).auction[0].alert).toEqual({ explanation: 'Five or more spades' })
  })

  test('the printout marks alerted calls and lists them', () => {
    const wrapper = mount(BoardPrintout, { props: { review: alerted() } })

    expect(wrapper.findAll('.auction .alert-mark')).toHaveLength(2)
    expect(wrapper.findAll('.alerts li').map((li) => li.text())).toEqual([
      '! 1♠ by North: Five or more spades',
      '! 2♠ by South: Alerted, no explanation given.',
    ])
    expect(mount(BoardPrintout, { props: { review: played() } }).find('.alerts').exists()).toBe(false)
  })

  test("the printout words who is vulnerable, the viewer's side or not", () => {
    const meta = (props: Record<string, unknown>) =>
      mount(BoardPrintout, { props: { review: played(), ...props } }).get('.meta').text()

    expect(meta({})).toContain('Dealer North · Vul: E-W · Playing #42')
    expect(meta({ mySeat: 'W' })).toContain('Vulnerable: E-W (you)')
    expect(meta({ mySeat: 'N' })).toContain('Vul: E-W ·')
    expect(meta({ review: { ...played(), board: null } })).toContain('Dealer ? · Vul: ? ·')
  })
})

describe('double dummy in the exports', () => {
  const TABLE = {
    N: { C: 7, D: 5, H: 6, S: 10, NT: 6 },
    E: { C: 5, D: 7, H: 6, S: 3, NT: 6 },
    S: { C: 7, D: 5, H: 6, S: 10, NT: 6 },
    W: { C: 5, D: 7, H: 6, S: 3, NT: 6 },
  }
  // East led the ♠Q (10 tricks); the ♥5 would have held declarer to 9.
  const LEADS = DEAL.E.map((c) => ({ card: c, tricks: c.suit === 'H' && c.rank === 5 ? 9 : 10 }))

  test('the text adds the table and the opening lead', () => {
    const text = boardText(played({ double_dummy: { status: 'ready', table: TABLE, leads: LEADS } }))

    expect(text).toContain(
      [
        'Double dummy (tricks declarer makes)',
        '       ♣   ♦   ♥   ♠  NT',
        'N      7   5   6  10   6',
        'E      5   7   6   3   6',
        'S      7   5   6  10   6',
        'W      5   7   6   3   6',
        "East's lead ♠Q: declarer can make 10. Best was ♥5: 9.",
      ].join('\n'),
    )
  })

  test('a passed-out board: the table alone; pending: nothing yet', () => {
    const passed = boardText(passedOut())
    expect(passed).not.toContain('Double dummy')

    const table = boardText({ ...passedOut(), double_dummy: { status: 'ready', table: TABLE, leads: null } })
    expect(table).toContain('W      5   7   6   3   6')
    expect(table.trimEnd().endsWith('W      5   7   6   3   6')).toBe(true)

    const pending = boardText(played({ double_dummy: { status: 'pending', table: null, leads: null } }))
    expect(pending).not.toContain('Double dummy')
  })

  test('PBN adds an OptimumResultTable between the auction and the play', () => {
    const pbn = boardPbn(played({ double_dummy: { status: 'ready', table: TABLE, leads: LEADS } }))
    const lines = pbn.split('\r\n')
    const at = lines.indexOf('[OptimumResultTable "Declarer;Denomination\\2R;Result\\2R"]')

    expect(at).toBeGreaterThan(lines.indexOf('[Auction "N"]'))
    expect(lines.slice(at + 1, at + 6)).toEqual(['N NT  6', 'N  S 10', 'N  H  6', 'N  D  5', 'N  C  7'])
    expect(lines.slice(at + 6, at + 21)).toHaveLength(15)
    expect(lines[at + 21]).toBe('[Play "E"]')
    // Not solved yet: no table.
    expect(boardPbn(played())).not.toContain('OptimumResultTable')
  })

  test('an unrecorded board still carries the table after the mandatory tags', () => {
    const pbn = boardPbn({ ...unrecorded(), double_dummy: { status: 'ready', table: TABLE, leads: null } })
    const lines = pbn.split('\r\n')
    const at = lines.findIndex((l) => l.startsWith('[OptimumResultTable'))

    expect(lines[at - 1]).toBe('[Result "10"]')
    expect(lines[at + 21]).toBe('[Score "NS 420"]')
  })
})
