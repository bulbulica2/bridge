import { alertController } from '@ionic/vue';
import type { Phase, PublicPlaying } from '@/services/game';
import { UNATTENDED_MINUTES } from '@/services/tables';
import type { BroadcastTable, Seat, Table } from '@/services/tables';
import type { PublicUser } from '@/services/users';
import { AWAY_REPLACE_SECONDS, isAway } from '@/utils/away';
import type { SetAtStake } from '@/utils/away';
import { currentSet } from '@/utils/sets';

// How long a held seat is kept, whoever's turn it is (bb#138), and what it
// costs meanwhile.
const AWAY_COST = `Your seat is kept for ${AWAY_REPLACE_SECONDS / 60} minutes: come back before then, or a robot takes it for the rest of the set. Your time for the set keeps running when it's your turn.`;

function tableLabel(table: Pick<Table, 'id' | 'name'>) {
  return table.name || `table #${table.id}`;
}

/**
 * Who still sits at `table` once `userId` has gone: nobody (it is deleted),
 * only robots (it is kept, unattended, for UNATTENDED_MINUTES; the robots
 * wait and nobody manages it), or other people.
 */
export function whoIsLeft(table: Table, userId: number): 'nobody' | 'robots' | 'people' {
  const others = table.seats.filter((s) => s.user_id !== userId);
  if (others.length === 0) {
    return 'nobody';
  }
  return others.every((s) => s.user.is_robot) ? 'robots' : 'people';
}

/**
 * The second half of a Leave confirmation: what becomes of the table. Without
 * the table at hand it can only say what may happen.
 */
export function leaveNote(table: Table | null, userId: number | null): string {
  const left = table && userId !== null ? whoIsLeft(table, userId) : null;
  if (left === 'nobody') {
    return 'Your seat will be freed. Nobody else sits here, so the table is deleted.';
  }
  if (left === 'robots') {
    return `Your seat will be freed. Only robots are left: the table waits ${UNATTENDED_MINUTES} minutes for somebody to take it over, then it is deleted.`;
  }
  if (left === 'people') {
    return 'Your seat will be freed.';
  }
  return 'Your seat will be freed. If nobody is left, the table is deleted.';
}

/**
 * Whether walking out of the set at stake hands the user's seat to a robot
 * for the rest of it (bb#120): it does when a Leave would hold the seat
 * (`stake.held`) and another human is left there to play on with the robot;
 * otherwise the set is broken off with no winner.
 */
export function robotTakesOver(from: Table, userId: number, stake: SetAtStake | null): boolean {
  return !!stake?.held && whoIsLeft(from, userId) === 'people';
}

/**
 * What moving off `from` costs, one sentence each: taking a seat at another
 * table frees the old one with every consequence of leaving it
 * (bridge_backend docs/API.md, POST /tables/{table}/seats). `phase` is that
 * table's board, when known: a finished one isn't abandoned. `stake` is the
 * set going on there (`setAtStake`): walking out on it mid-set hands the
 * seat to a robot at once (`robotTakesOver`), which plays the board on, or
 * else breaks the set off.
 */
export function moveConsequences(
  from: Table,
  userId: number,
  phase: Phase | null = null,
  stake: SetAtStake | null = null,
): string[] {
  const label = tableLabel(from);
  const mySeat = from.seats.find((s) => s.user_id === userId)?.seat;
  const lines = [`You give up ${mySeat ? `seat ${mySeat} at ` : 'your seat at '}${label} for good.`];
  const inProgress = from.board_id !== null && phase !== 'finished';
  if (stake) {
    const board = inProgress ? ', and the board in progress there is abandoned' : '';
    lines.push(
      robotTakesOver(from, userId, stake)
        ? `A robot takes your seat there for the rest of set ${stake.number}, and you can't sit down there again until it is over.`
        : `Set ${stake.number} there ends with no winner${board}.`,
    );
  }
  const left = whoIsLeft(from, userId);
  if (left === 'nobody') {
    lines.push(`Nobody else sits there, so ${label} will be deleted.`);
  } else if (left === 'robots') {
    lines.push(
      `Only robots are left there: ${label} waits ${UNATTENDED_MINUTES} minutes for somebody to take it over, then it is deleted.`,
    );
  } else {
    if (from.moderated_by === userId) {
      lines.push(`You manage ${label}; that role passes to another player.`);
    }
    if (inProgress && !stake) {
      lines.push(`The board in progress there will be abandoned for the other three players.`);
    }
  }
  return lines;
}

// One confirmation alert, answered with the role of the button pressed.
// The pages close their own sheets and modals first, so nothing of theirs
// stands over it (#121).
async function ask(header: string, message: string, buttons: { text: string; role: string }[]) {
  const alert = await alertController.create({ header, message, buttons });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  return role;
}

/** Asks before a seat request that moves the user off another table. */
export async function confirmMove(
  from: Table,
  to: Pick<Table, 'id' | 'name'>,
  userId: number,
  phase: Phase | null = null,
  stake: SetAtStake | null = null,
) {
  const role = await ask(
    stake ? `Move to ${tableLabel(to)} and leave set ${stake.number}?` : `Move to ${tableLabel(to)}?`,
    moveConsequences(from, userId, phase, stake).join(' '),
    [
      { text: 'Cancel', role: 'cancel' },
      { text: stake ? 'Move anyway' : 'Move', role: 'confirm' },
    ],
  );
  return role === 'confirm';
}

/**
 * What leaving costs, by the phase of the table's board: during one it is
 * abandoned for the other three, between boards (`finished`) nothing is lost
 * (bridge_backend docs/API.md, POST /tables/{table}/playing/next). In the
 * middle of a set (`stake`) a Leave only holds the seat, for
 * AWAY_REPLACE_SECONDS whoever's turn it is: back by then, play goes on,
 * otherwise a robot takes the seat for the rest of the set (bridge_backend
 * docs/API.md, Away mid-set). Where
 * the seat isn't held (an admin, or an admin here away), it breaks the set
 * off instead. Empty when there is no board or its phase is unknown, outside
 * a set.
 */
export function leaveWarning(
  phase: Phase | null,
  boardNumber: number | null = null,
  stake: SetAtStake | null = null,
): string {
  const board = boardNumber ? `Board ${boardNumber}` : 'The board';
  const inProgress = phase === 'auction' || phase === 'play';
  if (stake?.held) {
    const held = inProgress
      ? `${board} is in progress and set ${stake.number} isn't over: your seat is held, and the board waits for you.`
      : `Set ${stake.number} isn't over: your seat is held for you.`;
    return `${held} ${AWAY_COST}`;
  }
  if (stake) {
    return inProgress
      ? `Set ${stake.number} isn't over: leaving ends it with no winner and abandons ${board.toLowerCase()} for the other three players.`
      : `Set ${stake.number} isn't over: leaving ends it with no winner.`;
  }
  if (inProgress) {
    return `${board} is in progress: leaving abandons it for the other three players.`;
  }
  if (phase === 'finished') {
    return `${board} is over, so leaving abandons nothing: its score is kept.`;
  }
  return '';
}

/**
 * The whole Leave confirmation: what leaving costs the board or the set, then
 * what becomes of the seat and the table (not freed yet when it is held).
 */
export function leaveMessage(
  table: Table | null,
  userId: number | null,
  phase: Phase | null,
  boardNumber: number | null = null,
  stake: SetAtStake | null = null,
): string {
  return [leaveWarning(phase, boardNumber, stake), stake?.held ? '' : leaveNote(table, userId)]
    .filter(Boolean)
    .join(' ');
}

/** Asks before a Leave, more sternly when it can cost the set. */
export async function confirmLeave(
  table: Table | null,
  userId: number | null,
  phase: Phase | null,
  boardNumber: number | null = null,
  stake: SetAtStake | null = null,
) {
  const role = await ask(
    stake ? `Leave in the middle of set ${stake.number}?` : 'Leave this table?',
    leaveMessage(table, userId, phase, boardNumber, stake),
    [
      { text: 'Cancel', role: 'cancel' },
      { text: stake ? 'Leave anyway' : 'Leave', role: 'destructive' },
    ],
  );
  return role === 'destructive';
}

/**
 * What taking the player at `seat` out costs the set going on there
 * (bridge_backend docs/API.md, DELETE /tables/{table}/seats/{user}): a
 * player away is replaced by a robot for the rest of it (unless nobody else
 * human is left to play with it), one who is there breaks it off. Nothing
 * once the set is over (the board's own `set` knows that first), nor for a
 * robot, whose seat a manager frees between sets.
 */
export function removeCost(table: BroadcastTable, playing: PublicPlaying | null, seat: Seat): string {
  const set = currentSet(table, playing);
  const theirs = table.seats.find((s) => s.seat === seat);
  if (!set || set.finished || !theirs || theirs.user.is_robot) {
    return '';
  }
  const othersHuman = table.seats.some((s) => s.seat !== seat && !s.user.is_robot);
  return isAway(theirs) && othersHuman
    ? `They are away, so a robot takes their seat for the rest of set ${set.number}.`
    : `Set ${set.number} ends with no winner.`;
}

/** The Remove confirmation's message: what becomes of the seat, and the set. */
export function removeMessage(
  user: Pick<PublicUser, 'username' | 'is_robot'>,
  seat: Seat,
  cost = '',
): string {
  if (user.is_robot) {
    return `The robot leaves seat ${seat}, which becomes free.`;
  }
  return [`${user.username} loses seat ${seat}. They can sit down again afterwards.`, cost]
    .filter(Boolean)
    .join(' ');
}

/** Asks before taking another player (or a robot) out of their seat. */
export async function confirmRemove(
  user: Pick<PublicUser, 'username' | 'is_robot'>,
  seat: Seat,
  cost = '',
) {
  const role = await ask(`Remove ${user.username}?`, removeMessage(user, seat, cost), [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Remove', role: 'destructive' },
  ]);
  return role === 'destructive';
}

// The toast after a Leave that held the seat: its clock runs from now,
// whoever's turn it is.
export function heldNotice(): string {
  return `You left in the middle of a set. ${AWAY_COST}`;
}

/**
 * Watching a table (#182) is never done from a seat: the backend refuses
 * (409) while we sit anywhere. So Watch from another table's seat leaves it
 * first, with Leave's own words for what that costs; in the middle of a set
 * a Leave only holds the seat, which still counts as seated, so there is
 * nothing to offer (`watchBlockedText` says why instead).
 */
export async function confirmWatch(
  from: Table,
  to: Pick<Table, 'id' | 'name'>,
  userId: number,
  phase: Phase | null = null,
  boardNumber: number | null = null,
  stake: SetAtStake | null = null,
) {
  const role = await ask(
    `Leave ${tableLabel(from)} to watch ${tableLabel(to)}?`,
    leaveMessage(from, userId, phase, boardNumber, stake),
    [
      { text: 'Cancel', role: 'cancel' },
      { text: 'Leave and watch', role: 'destructive' },
    ],
  );
  return role === 'destructive';
}

// Why Watch can't be had from a seat held in the middle of a set.
export function watchBlockedText(from: Pick<Table, 'id' | 'name'>, stake: Pick<SetAtStake, 'number'>): string {
  return `You're in the middle of set ${stake.number} at ${tableLabel(from)}: you can watch another table once it's over.`;
}
