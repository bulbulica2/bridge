import { SEATS } from '@/services/tables';
import type { Seat } from '@/services/tables';
import type { Card, PlayedCard } from '@/services/game';
import type { PlayingReview } from '@/services/history';
import { sideOf } from '@/utils/result';

// Replaying a finished board card by card (GET /playings/{playing}). A
// "step" is how many cards have been played: 0 is before the opening lead,
// the last step every card the playing recorded. Everything shown at a step
// is worked out from the deal and the tricks alone.

// Every card played, in order: the complete tricks, then the unfinished one
// an accepted claim stopped (four cards a trick, so card i is in trick
// ⌊i / 4⌋).
export function playedCards(review: PlayingReview): PlayedCard[] {
  return [...(review.tricks ?? []).flatMap((trick) => trick.cards), ...(review.current_trick ?? [])];
}

// Playings finished before the backend kept their calls and cards have an
// empty auction (a passed-out board still has its four passes).
export function isRecorded(review: PlayingReview): boolean {
  return (review.auction?.length ?? 0) > 0;
}

export interface ReviewStep {
  step: number;
  // What is left of each hand.
  hands: Record<Seat, Card[]>;
  // The trick in the middle of the table: the one the last card went to.
  trick: PlayedCard[];
  // Set once that trick is complete.
  winner: Seat | null;
  // 1–13, or null before the opening lead.
  trickNumber: number | null;
  // Complete tricks won by each side so far.
  tricksWon: { ns: number; ew: number };
  // The hand the next card comes from, null once every card is shown.
  next: Seat | null;
}

// The table after `step` cards (clamped to what was played).
export function reviewAt(review: PlayingReview, step: number): ReviewStep {
  const plays = playedCards(review);
  const at = clampStep(step, plays.length);
  const gone = new Set(plays.slice(0, at).map(({ card }) => card.id));
  const hands = Object.fromEntries(
    SEATS.map((seat) => [seat, (review.deal?.[seat] ?? []).filter((card) => !gone.has(card.id))]),
  ) as Record<Seat, Card[]>;

  const tricksWon = { ns: 0, ew: 0 };
  for (const trick of (review.tricks ?? []).slice(0, Math.floor(at / 4))) {
    tricksWon[sideOf(trick.winner)] += 1;
  }

  const next = at < plays.length ? plays[at].seat : null;
  if (at === 0) {
    return { step: at, hands, trick: [], winner: null, trickNumber: null, tricksWon, next };
  }
  const index = Math.floor((at - 1) / 4);
  const trick = plays.slice(index * 4, at);
  const winner = trick.length === 4 ? (review.tricks?.[index]?.winner ?? null) : null;
  return { step: at, hands, trick, winner, trickNumber: index + 1, tricksWon, next };
}

export function clampStep(step: number, total: number): number {
  return Math.min(Math.max(Math.trunc(step), 0), total);
}

// The step showing the next trick complete: the end of the trick in
// progress, or of the one after a complete trick. Never past the last card.
export function nextTrickStep(step: number, total: number): number {
  return Math.min(total, (Math.floor(step / 4) + 1) * 4);
}

// The step showing the previous trick complete, or 0 (before the lead) from
// the first trick.
export function previousTrickStep(step: number): number {
  return step <= 0 ? 0 : Math.floor((step - 1) / 4) * 4;
}

// A short line under the trick: who leads or plays next, who won it, or
// that a claim stopped the play there.
export function stepCaption(at: ReviewStep): string {
  if (at.trickNumber === null) {
    return at.next ? `${at.next} to lead` : 'No card played';
  }
  if (at.winner) {
    return `${at.winner} wins`;
  }
  return at.next ? `${at.next} to play` : 'Claimed';
}
