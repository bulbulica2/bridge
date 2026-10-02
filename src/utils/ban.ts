import type { Ban, User } from '@/services/auth';
import type { BanRequest, PublicUser } from '@/services/users';

// Bans (bridge_backend docs/API.md, Bans): an admin keeps a user away from
// the game for 1–365 days with a reason the user is shown.

export const MAX_BAN_DAYS = 365;
export const MAX_BAN_REASON = 1000;
// The ban form's quick picks.
export const BAN_QUICK_DAYS = [1, 7, 30];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "12 Oct 2026", in the viewer's time zone, as the backend words its messages.
// Spelled out rather than toLocaleDateString, whose short months vary
// ("Sept") between ICU versions.
export function banDate(iso: string): string {
  const date = new Date(iso);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

// "You are banned until 12 Oct 2026: <reason>", the banner and the notice.
export function banText(ban: Ban): string {
  return `You are banned until ${banDate(ban.until)}: ${ban.reason}`;
}

// Only an admin bans, and never themselves, another admin or a robot (the
// backend's UserPolicy::ban answers 403 to all of those).
export function canBan(viewer: User | null, target: PublicUser | null): boolean {
  return (
    !!viewer?.is_admin &&
    !!target &&
    target.id !== viewer.id &&
    !target.is_admin &&
    !target.is_robot
  );
}

// The ban form's own check, the backend's rules (BanUserRequest): whole days
// from 1 to 365 and a reason of at most 1000 characters. Empty when it may
// be sent.
export function banFormErrors(request: BanRequest): Partial<Record<keyof BanRequest, string>> {
  const errors: Partial<Record<keyof BanRequest, string>> = {};
  if (!Number.isInteger(request.days) || request.days < 1 || request.days > MAX_BAN_DAYS) {
    errors.days = `Choose a whole number of days from 1 to ${MAX_BAN_DAYS}.`;
  }
  if (request.reason.trim() === '') {
    errors.reason = 'Give a reason: the player is shown it.';
  } else if (request.reason.trim().length > MAX_BAN_REASON) {
    errors.reason = `The reason can be at most ${MAX_BAN_REASON} characters.`;
  }
  return errors;
}
