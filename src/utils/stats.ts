import type { AbandonReason, UserStats } from '@/services/users';
import { percentText } from '@/utils/result';

// Shown for a rate or average with nothing to divide by (the backend's null).
export const NO_FIGURE = '—';

export const STATS_EXPLAINED =
  'Won = more than half the matchpoints on a board; a set is won by the side with more matchpoints.';

// A 0–1 rate as a whole percentage: "65 %", or "—".
export function rateText(rate: number | null): string {
  return rate === null ? NO_FIGURE : percentText(Math.round(rate * 100));
}

// A 0–100 average to one decimal: "56.0 %", or "—".
export function averageText(percent: number | null): string {
  return percent === null ? NO_FIGURE : percentText(percent.toFixed(1));
}

// "12 played · 7 won (58 %) · avg 54.2 %".
export function setsLine(stats: UserStats): string {
  const { played, won, win_rate, average_percent } = stats.sets;
  return `${played} played · ${won} won (${rateText(win_rate)}) · avg ${averageText(average_percent)}`;
}

// "48 played · 31 won (65 %) · avg 56.0 %": won and the average count only
// the boards another table has played too (see comparedNote).
export function boardsLine(stats: UserStats): string {
  const { played, won, win_rate, average_percent } = stats.boards;
  return `${played} played · ${won} won (${rateText(win_rate)}) · avg ${averageText(average_percent)}`;
}

// "40 compared with other tables", when some boards played have nothing to
// be compared with yet; null when every one has.
export function comparedNote(stats: UserStats): string | null {
  const { played, compared } = stats.boards;
  return compared < played ? `${compared} compared with other tables` : null;
}

// "2 abandoned (8 %)": the share of the sets they were in that they left.
export function leavingLine(stats: UserStats): string {
  const { abandoned, left_rate } = stats.leaving;
  return `${abandoned} abandoned (${rateText(left_rate)})`;
}

const REASON_TEXT: Record<AbandonReason, string> = {
  turn_timeout: 'out of time',
  set_time: 'out of time for the set',
  away: 'away',
  moved: 'moved table',
  kicked: 'removed',
  left: 'left',
};

// "1 out of time · 1 moved table": why, for the reasons that happened;
// null when they never left a set.
export function leavingReasons(stats: UserStats): string | null {
  const counts = stats.leaving.abandoned_by_reason ?? {};
  const parts = (Object.keys(REASON_TEXT) as AbandonReason[])
    .filter((reason) => (counts[reason] ?? 0) > 0)
    .map((reason) => `${counts[reason]} ${REASON_TEXT[reason]}`);
  return parts.length ? parts.join(' · ') : null;
}

// The profile sheet's one line: "48 boards · 65 % won · avg 56.0 %", or
// "No boards played yet.".
export function statsSummary(stats: UserStats): string {
  const { played, win_rate, average_percent } = stats.boards;
  if (played === 0) {
    return 'No boards played yet.';
  }
  return `${played} board${played === 1 ? '' : 's'} · ${rateText(win_rate)} won · avg ${averageText(average_percent)}`;
}
