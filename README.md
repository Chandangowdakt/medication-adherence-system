# Medication Adherence Tracker

Full-stack starter: React (Vite) + Express + MongoDB + JWT auth.

## Prerequisites

- [Node.js](https://nodejs.org/) 18+ (20+ recommended for `--watch` on the server)
- [MongoDB](https://www.mongodb.com/try/download/community) running locally, or a [MongoDB Atlas](https://www.mongodb.com/atlas) connection string

## Project layout

- `backend/` — Express API, Mongoose models, JWT auth
- `frontend/` — React app (functional components + hooks), React Router, Axios

## Backend setup

1. Copy environment file (defaults are already in `backend/.env` for local dev; adjust as needed):

   ```text
   cp backend/.env.example backend/.env
   ```

   On Windows PowerShell:

   ```powershell
   Copy-Item backend\.env.example backend\.env
   ```

2. Set `MONGODB_URI` and `JWT_SECRET` in `backend/.env`.

3. Install and run:

   ```bash
   cd backend
   npm install
   npm run dev
   ```

   The API listens on `http://localhost:5001` by default. Health check: `GET http://localhost:5001/api/health`.

## Frontend setup

1. Copy `frontend/.env.example` to `frontend/.env` and set `VITE_API_URL` to your API base (default `http://localhost:5001`).

2. Install and run:

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

3. Open the URL shown in the terminal (usually `http://localhost:5173`).

## Usage

1. Start MongoDB.
2. Start the backend, then the frontend.
3. Register a new user (patient or doctor), or sign in.
4. After login you are redirected to the dashboard, which loads your profile via `GET /api/auth/me`.

## API summary

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Body: `name`, `email`, `password`, optional `role` (`patient` \| `doctor`) |
| POST | `/api/auth/login` | Body: `email`, `password` — returns JWT + user |
| GET | `/api/auth/me` | Header: `Authorization: Bearer <token>` — current user |

JWT is stored in `localStorage` under the key used in `frontend/src/utils/authStorage.js`.

## Production notes

- Use a strong `JWT_SECRET` and HTTPS.
- Restrict CORS `origin` in `backend/server.js` to your real frontend URL.
- Build the frontend: `cd frontend && npm run build` — serve the `dist/` folder with a static host or reverse proxy.
