import type { Seat } from '@/services/tables';
import type { Claim, Playing, PublicPlaying } from '@/services/game';
import { SEAT_NAMES } from '@/utils/auction';
import { playsForDeclarer } from '@/utils/play';

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
// no other claim is pending and tricks are left. A robot declarer's dummy
// claims as declarer (claimSeatOf).
export function canClaim(state: PublicPlaying, seat: Seat | null): boolean {
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
