import http from './http';

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegistrationData {
  name: string;
  username: string;
  email: string;
  password: string;
  password_confirmation: string;
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

// Creates the account and logs it in (204, session cookie set).
export async function register(data: RegistrationData): Promise<void> {
  await http.get('/sanctum/csrf-cookie');
  await http.post('/register', data);
}

export async function fetchUser(): Promise<User> {
  const { data } = await http.get<User>('/api/user');
  return data;
}
