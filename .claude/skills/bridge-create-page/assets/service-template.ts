// Service template: save as src/services/<domain>.ts, or add functions to an
// existing service (auth calls belong in src/services/auth.ts).
// Always go through the shared axios instance; it carries the Sanctum cookie/XSRF setup.
// Confirm paths, payloads and response shapes against bridge_backend's routes and
// controllers, not just bridge_docs.
import http from './http';

export interface __Item__ {
  id: number;
  // fields from bridge_docs/backend/DATA-MODEL.md / the model's $fillable & casts
}

export interface __Create__Payload {
  // request body fields from the controller's validation rules
}

export async function list__Items__(): Promise<__Item__[]> {
  const { data } = await http.get<__Item__[]>('/api/__items__');
  return data;
}

export async function create__Item__(payload: __Create__Payload): Promise<__Item__> {
  // On a fresh session a state-changing request needs the XSRF cookie first.
  await http.get('/sanctum/csrf-cookie');
  const { data } = await http.post<__Item__>('/api/__items__', payload);
  return data;
}
