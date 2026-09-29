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
