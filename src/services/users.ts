import http from './http';

// Game endpoints answer with an envelope: {status, message, data}.
// See bridge_backend docs/API.md.
interface ApiResponse<T> {
  status: number;
  message: string;
  data: T;
}

// What other players see of a user (the backend's UserResource): the same
// shape GET /users/{user} serves and every table payload embeds per seat.
// Never carries the email; only the own record from GET /api/user does.
// `is_robot` marks a computer player (bridge_backend's docs/ROBOTS.md): it
// takes a seat nobody else is in and can't log in.
export interface PublicUser {
  id: number;
  name: string;
  username: string;
  // Only GET /users/{id} carries it: a seat's `user` and the game state's
  // `players` leave it out to keep broadcasts small (bridge_backend
  // docs/API.md, Message size).
  description?: string | null;
  is_robot: boolean;
  // An admin: their seat has no Remove for anyone but another admin, and they
  // can't be banned (bridge_backend docs/API.md, Users).
  is_admin?: boolean;
  // Only for an admin reading GET /users/{id}: the ban in force (null when
  // there is none) and every ban the user has had, latest first.
  ban?: UserBan | null;
  bans?: UserBan[];
}

// A ban as admins see it (bridge_backend docs/API.md, Bans): who gave it and
// who lifted it. `active` is false once lifted or past `until`.
export interface UserBan {
  id: number;
  user_id: number;
  reason: string;
  banned_at: string;
  until: string;
  banned_by: PublicUser | null;
  lifted_at: string | null;
  lifted_by: PublicUser | null;
  active: boolean;
}

export interface BanRequest {
  days: number;
  reason: string;
}

// Another user's public profile. 404 for an unknown id, 401 for guests.
export async function getUser(id: number): Promise<PublicUser> {
  const { data } = await http.get<ApiResponse<PublicUser>>(`/users/${id}`);
  return data.data;
}

// A search hit: the public profile plus whether the user already sits at a
// table, where a manager seating them would get a 409.
export interface SearchedUser extends PublicUser {
  seated: boolean;
}

// Up to 10 users whose username or name contains `search` (2–255 characters,
// 422 otherwise), ordered by username, the caller included, robots never
// (a manager seats one with seatRobot instead). Throttled to 30 a
// minute (429), so callers debounce the input.
export async function searchUsers(search: string): Promise<SearchedUser[]> {
  const { data } = await http.get<ApiResponse<SearchedUser[]>>('/users', { params: { search } });
  return data.data;
}

// Admins only: bans the user for `days` (1–365) with a reason they are shown.
// The backend frees their seat (mid-set their side forfeits), logs them out
// and sends UserBanned. 201 with the ban and a message naming its end (plus
// the forfeit, if it cost a set); 403 for a non-admin or a target that can't
// be banned (yourself, an admin, a robot), 422 for bad fields.
export async function banUser(id: number, request: BanRequest): Promise<{ ban: UserBan; message: string }> {
  const { data } = await http.post<ApiResponse<UserBan>>(`/users/${id}/ban`, request);
  return { ban: data.data, message: data.message };
}

// Admins only: lifts the ban in force at once. 200 with the lifted ban
// (`active: false`), 404 when the user isn't banned.
export async function liftBan(id: number): Promise<UserBan> {
  const { data } = await http.delete<ApiResponse<UserBan>>(`/users/${id}/ban`);
  return data.data;
}
