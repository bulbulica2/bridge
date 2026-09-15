import axios from 'axios';

// Sanctum SPA auth is cookie based: send cookies cross-origin and echo the
// XSRF-TOKEN cookie back as the X-XSRF-TOKEN header.
const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  withCredentials: true,
  withXSRFToken: true,
  headers: {
    Accept: 'application/json',
  },
});

export default http;
