import { alertController } from '@ionic/vue';
import type { Phase } from '@/services/game';
import { UNATTENDED_MINUTES } from '@/services/tables';
import type { Table } from '@/services/tables';
import { SET_FORFEIT_MINUTES } from '@/utils/away';
import type { SetAtStake } from '@/utils/away';
import { SIDE_LABELS } from '@/utils/result';

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
 * What moving off `from` costs, one sentence each: taking a seat at another
 * table frees the old one with every consequence of leaving it
 * (bridge_backend docs/API.md, POST /tables/{table}/seats). `phase` is that
 * table's board, when known: a finished one isn't abandoned. `stake` is the
 * set going on there (`setAtStake`): walking out on it mid-set forfeits it
 * for the user's side at once, or breaks it off when nobody can forfeit.
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
      stake.forfeits
        ? `Your side loses the set now: ${SIDE_LABELS[stake.side]} forfeit set ${stake.number}${board}.`
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

/** Asks before a seat request that moves the user off another table. */
export async function confirmMove(
  from: Table,
  to: Pick<Table, 'id' | 'name'>,
  userId: number,
  phase: Phase | null = null,
  stake: SetAtStake | null = null,
) {
  const forfeits = !!stake?.forfeits;
  const alert = await alertController.create({
    header: forfeits ? `Move to ${tableLabel(to)} and lose the set?` : `Move to ${tableLabel(to)}?`,
    message: moveConsequences(from, userId, phase, stake).join(' '),
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      { text: forfeits ? 'Move anyway' : 'Move', role: 'confirm' },
    ],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  return role === 'confirm';
}

/**
 * What leaving costs, by the phase of the table's board: during one it is
 * abandoned for the other three, between boards (`finished`) nothing is lost
 * (bridge_backend docs/API.md, POST /tables/{table}/playing/next). In the
 * middle of a set (`stake`) a Leave only holds the seat, and the clock runs
 * only once the board waits for the user (at once on their turn): back
 * within SET_FORFEIT_MINUTES of their turn, play goes on, otherwise their
 * side loses the set (bridge_backend docs/API.md, Away mid-set). Where nobody
 * can forfeit (an admin), it breaks the set off instead. Empty when there is no board or
 * its phase is unknown, outside a set.
 */
export function leaveWarning(
  phase: Phase | null,
  boardNumber: number | null = null,
  stake: SetAtStake | null = null,
): string {
  const board = boardNumber ? `Board ${boardNumber}` : 'The board';
  const inProgress = phase === 'auction' || phase === 'play';
  if (stake?.forfeits) {
    const held = inProgress
      ? `${board} is in progress and set ${stake.number} isn't over: your seat is held, and the board waits for you.`
      : `Set ${stake.number} isn't over: your seat is held for you.`;
    return `${held} ${SIDE_LABELS[stake.side]} lose the set if you aren't back within ${SET_FORFEIT_MINUTES} minutes of your turn.`;
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
  return [leaveWarning(phase, boardNumber, stake), stake?.forfeits ? '' : leaveNote(table, userId)]
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
  const forfeits = !!stake?.forfeits;
  const alert = await alertController.create({
    header: stake ? `Leave in the middle of set ${stake.number}?` : 'Leave this table?',
    message: leaveMessage(table, userId, phase, boardNumber, stake),
    buttons: [
      { text: 'Cancel', role: 'cancel' },
      { text: forfeits ? 'Leave anyway' : 'Leave', role: 'destructive' },
    ],
  });
  await alert.present();
  const { role } = await alert.onDidDismiss();
  return role === 'destructive';
}

// The toast after a Leave that held the seat. The clock starts once the
// board waits for the user, so the time counts from their turn.
export function heldNotice(stake: Pick<SetAtStake, 'side'> | null): string {
  const loses = stake ? `${SIDE_LABELS[stake.side]} lose` : 'your side loses';
  return `You left in the middle of a set. Your seat is held: ${loses} the set if you aren't back within ${SET_FORFEIT_MINUTES} minutes of your turn.`;
}
