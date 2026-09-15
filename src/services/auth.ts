import http from './http';

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface User {
  id: number;
  name: string;
  username: string;
  email: string;
}

// See bridge_docs/backend/AUTH.md for the Sanctum SPA flow.
export async function login(credentials: LoginCredentials): Promise<void> {
  await http.get('/sanctum/csrf-cookie');
  await http.post('/login', credentials);
}

export async function fetchUser(): Promise<User> {
  const { data } = await http.get<User>('/api/user');
  return data;
}
