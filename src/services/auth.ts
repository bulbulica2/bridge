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
  description?: string | null;
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

// Ends the session (204). The XSRF-TOKEN cookie can outlive a page reload but
// not the session lifetime, so refresh it before posting.
export async function logout(): Promise<void> {
  await http.get('/sanctum/csrf-cookie');
  await http.post('/logout');
}

export async function fetchUser(): Promise<User> {
  const { data } = await http.get<User>('/api/user');
  return data;
}

export interface PasswordResetRequest {
  email: string;
}

export interface PasswordResetData {
  token: string;
  email: string;
  password: string;
  password_confirmation: string;
}

// Both password endpoints answer 200 {"status": "<human readable message>"}
// and 422 {message, errors} on failure (bridge_backend
// PasswordResetLinkController / NewPasswordController).
interface StatusResponse {
  status: string;
}

// Emails a reset link pointing at the SPA's /password-reset/:token?email=… route.
export async function requestPasswordReset(data: PasswordResetRequest): Promise<string> {
  await http.get('/sanctum/csrf-cookie');
  const { data: body } = await http.post<StatusResponse>('/forgot-password', data);
  return body.status;
}

// Consumes the token from that link. The backend does not log the user in
// afterwards, so the page sends them to /login.
export async function resetPassword(data: PasswordResetData): Promise<string> {
  await http.get('/sanctum/csrf-cookie');
  const { data: body } = await http.post<StatusResponse>('/reset-password', data);
  return body.status;
}

// Only these two fields are editable; the backend ignores anything else
// (username, email and password can't be changed yet). `description: null`
// clears it.
export interface ProfileUpdate {
  name?: string;
  description?: string | null;
}

// PATCH /api/user answers with the game endpoints' envelope,
// {status, message, data}, where data is the full own record (same shape as
// GET /api/user). 422 {message, errors} for an invalid name/description.
export async function updateProfile(data: ProfileUpdate): Promise<User> {
  await http.get('/sanctum/csrf-cookie');
  const { data: body } = await http.patch<{ data: User }>('/api/user', data);
  return body.data;
}
