import type { Seat } from '@/services/tables';
import type { Claim, Playing, PublicPlaying } from '@/services/game';
import { SEAT_NAMES, callLabel } from '@/utils/auction';
import { formatClock, secondsLeft } from '@/utils/away';
import { isVulnerable } from '@/utils/cards';
import { playsForDeclarer } from '@/utils/play';
import { contractScore, doubledMark, formatScore, madeSuffix, sideOf } from '@/utils/result';

// Claims (bridge_backend docs/API.md, Claims; GAME-RULES.md §5), mirrored as
// a hint for which buttons to show. The backend's ClaimService is the final
// word: anything that slips past these answers 409 with its reason.

const SEATS: Seat[] = ['N', 'E', 'S', 'W'];

// The tricks still to play: 13 less the complete ones, so a trick in
// progress still counts. What a claim may take at most.
export function tricksLeft(state: Pick<PublicPlaying, 'tricks'>): number {
  return 13 - (state.tricks?.length ?? 0);
}

// The seat the viewer claims and answers claims for: their own, except for
// a robot declarer's dummy, who plays declarer's game and so claims for
// declarer's seat (bridge_backend docs/API.md, Claims).
export function claimSeatOf(state: Playing): Seat | null {
  return playsForDeclarer(state) ? state.contract!.declarer : state.my_seat;
}

// Whether `seat` may claim now: any player but dummy, during the play, while
// no other claim is pending, tricks are left and no claim was refused since
// the last card (`claim_locked`, bb#115). A robot declarer's dummy claims as
// declarer (claimSeatOf).
export function canClaim(state: PublicPlaying, seat: Seat | null): boolean {
  return mayClaimButForLock(state, seat) && !state.claim_locked;
}

// `seat` would be free to claim but for a claim refused (rejected, expired
// or withdrawn) since the last card: nobody claims until the next card is
// played, which clears `claim_locked` by itself.
export function claimLocked(state: PublicPlaying, seat: Seat | null): boolean {
  return !!state.claim_locked && mayClaimButForLock(state, seat);
}

// The note under the disabled Claim button while claims are locked.
export const CLAIM_LOCKED_TEXT = 'The claim was refused: play a card before claiming again.';

function mayClaimButForLock(state: PublicPlaying, seat: Seat | null): boolean {
  return (
    state.phase === 'play' &&
    !!state.contract &&
    seat !== null &&
    seat !== state.contract.dummy &&
    state.claim === null &&
    tricksLeft(state) > 0
  );
}

// Who has to agree to the pending claim: every player but the claimer and
// dummy, in N, E, S, W order.
export function claimAnswerers(state: PublicPlaying): Seat[] {
  const claim = state.claim;
  if (!claim || !state.contract) {
    return [];
  }
  return SEATS.filter((seat) => seat !== claim.seat && seat !== state.contract!.dummy);
}

// Those still to answer: the answerers who haven't accepted yet.
export function claimWaitingFor(state: PublicPlaying): Seat[] {
  const accepted = state.claim?.accepted ?? [];
  return claimAnswerers(state).filter((seat) => !accepted.includes(seat));
}

// What `seat` can do about the pending claim: the claimer may withdraw it,
// a player who still has to answer accepts or rejects, anyone else (dummy,
// or a player who has accepted) waits.
export function claimAction(state: PublicPlaying, seat: Seat | null): 'withdraw' | 'answer' | null {
  if (!state.claim || seat === null) {
    return null;
  }
  if (state.claim.seat === seat) {
    return 'withdraw';
  }
  return claimWaitingFor(state).includes(seat) ? 'answer' : null;
}

// "South claims 4 of the remaining 5 tricks", "… claims all 5 remaining
// tricks", "… concedes the remaining 5 tricks"; `you` for the viewer's own,
// and "You claim … for North" when the viewer claimed for `actsFor`, a
// robot declarer's seat.
export function claimText(
  claim: Claim,
  remaining: number,
  mySeat: Seat | null = null,
  actsFor: Seat | null = mySeat,
): string {
  const mine = claim.seat === mySeat || claim.seat === actsFor;
  const who = mine ? 'You' : SEAT_NAMES[claim.seat];
  const verb = (word: string) => (mine ? word : `${word}s`);
  const forSeat = mine && claim.seat !== mySeat ? ` for ${SEAT_NAMES[claim.seat]}` : '';
  if (remaining === 1) {
    return `${who} ${verb(claim.tricks === 0 ? 'concede' : 'claim')} the last trick${forSeat}`;
  }
  if (claim.tricks === 0) {
    return `${who} ${verb('concede')} the remaining ${remaining} tricks${forSeat}`;
  }
  if (claim.tricks === remaining) {
    return `${who} ${verb('claim')} all ${remaining} remaining tricks${forSeat}`;
  }
  return `${who} ${verb('claim')} ${claim.tricks} of the remaining ${remaining} tricks${forSeat}`;
}

// Whole seconds before silence rejects the pending claim, never below 0;
// null for a claim without a deadline.
export function claimSecondsLeft(claim: Claim, now: number): number | null {
  return claim.expires_at ? secondsLeft(claim.expires_at, now) : null;
}

// The claim's deadline has passed: no answer counts any more, even before
// the backend's PlayingUpdated clears it.
export function claimExpired(claim: Claim, now: number): boolean {
  return claimSecondsLeft(claim, now) === 0;
}

// The pending claim's clock as `seat` (claimSeatOf) sees it: "Answer within
// 0:07" for a player who still has to answer, "Waiting for East and West ·
// 0:07" for everyone else, "Time is up: no answer counts as no." once it has
// run out. Null without a deadline, or with nobody left to answer.
export function claimClockText(state: PublicPlaying, seat: Seat | null, now: number): string | null {
  const left = state.claim ? claimSecondsLeft(state.claim, now) : null;
  const waiting = claimWaitingFor(state);
  if (left === null || waiting.length === 0) {
    return null;
  }
  if (left === 0) {
    return 'Time is up: no answer counts as no.';
  }
  if (claimAction(state, seat) === 'answer') {
    return `Answer within ${formatClock(left)}`;
  }
  return `Waiting for ${waiting.map((s) => SEAT_NAMES[s]).join(' and ')} · ${formatClock(left)}`;
}

// The toast for a claim going away mid-play. Gone at or after its deadline,
// silence rejected it; before, somebody rejected or withdrew it. Either way
// claims are locked until the next card (`claim_locked`).
export function claimOffText(claim: Claim, now: number): string {
  const off = claimExpired(claim, now)
    ? 'Nobody answered: the claim is off.'
    : `${SEAT_NAMES[claim.seat]}'s claim is off.`;
  return `${off} Play on: no claim until the next card.`;
}

// What claiming `tricks` of the tricks left would make of the contract,
// from `seat`'s side (the claimer's, claimSeatOf): the result as the table
// writes it ("4♠ +1", "4♠X −2"), whether it goes down, and the side's score
// ("+450", "−50"; contractScore, a hint). Null without a contract.
export interface ClaimOutcome {
  result: string;
  down: boolean;
  score: string;
}

export function claimOutcome(state: PublicPlaying, seat: Seat, tricks: number): ClaimOutcome | null {
  const contract = state.contract;
  const { level, strain } = contract?.bid ?? {};
  if (!contract || !level || !strain) {
    return null;
  }
  const declarerSide = sideOf(contract.declarer);
  const ours = sideOf(seat) === declarerSide;
  const won = state.tricks_won?.[declarerSide] ?? 0;
  const taken = won + (ours ? tricks : tricksLeft(state) - tricks);
  const vulnerable = isVulnerable(contract.declarer, state.board?.vulnerable ?? '');
  const score = contractScore({ level, strain }, contract.doubled, vulnerable, taken);
  const made = taken - (level + 6);
  return {
    result: `${callLabel(contract.bid)}${doubledMark(contract.doubled)} ${madeSuffix(made)}`,
    down: made < 0,
    score: formatScore(ours ? score : 0 - score),
  };
}
