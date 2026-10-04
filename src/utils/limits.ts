// The backend's length limits on the free text it broadcasts, in characters,
// so every event fits in 10 KB (bridge_backend docs/API.md, Message size).
// The forms cap their inputs at these; the backend's 422 stays the last word.

// A user's `name` (register, PATCH /api/user) and `username` (register).
export const NAME_MAX = 50;
export const USERNAME_MAX = 30;
// A table's `name` (POST /tables).
export const TABLE_NAME_MAX = 50;
