import http from './http';

// Game endpoints answer with an envelope: {status, message, data}.
// See bridge_docs/backend/API.md.
interface ApiResponse<T> {
  status: number;
  message: string;
  data: T;
}

// What other players see of a user (the backend's UserResource): the same
// shape GET /users/{user} serves and every table payload embeds per seat.
// Never carries the email; only the own record from GET /api/user does.
export interface PublicUser {
  id: number;
  name: string;
  username: string;
  description: string | null;
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
// 422 otherwise), ordered by username, the caller included. Throttled to 30 a
// minute (429), so callers debounce the input.
export async function searchUsers(search: string): Promise<SearchedUser[]> {
  const { data } = await http.get<ApiResponse<SearchedUser[]>>('/users', { params: { search } });
  return data.data;
}
