# Karushala Server

Backend API for **Karushala**, a Bengali handcraft marketplace connecting village artisans directly with buyers across Bangladesh.

---

## Tech Stack

- **Express 5.2.1** + **TypeScript 7** (ESM, `"type": "module"`)
- **MongoDB 7.5.0** (native driver, no ORM)
- **Better Auth** — JWT verification via JWKS (`jose-cjs` for token validation)
- **cors** — cross-origin config bound to `BETTER_AUTH_URL`
- **dotenv** — environment config
- **tsx + nodemon** — dev server with hot reload
- **tsc** — production build

---

## Project Structure

```
karushala-server/
  src/
    index.ts        # app entry: middleware, routes, DB connection
  dist/              # compiled output (tsc build)
  .env               # environment variables (not committed)
```

Currently single-file (`src/index.ts`) containing all routes, middleware, and DB logic.

---

## Auth & Middleware

- **`verifyToken`** — validates `Authorization: Bearer <token>` against Better Auth's remote JWKS (`{BETTER_AUTH_URL}/api/auth/jwks`). Returns `401` if missing, `403` if invalid.
- **`restrictDemoUser`** — blocks demo accounts (`demo@karushala.com`, `demo@example.com`, `test@karushala.com`) from mutating actions (create/update/delete). Returns `403` with `DEMO_RESTRICTED` code. Checks email from body, query, or `x-user-email` header.
- Most write routes (`POST`/`PUT`/`DELETE`) stack `restrictDemoUser` + `verifyToken`; public reads (`GET /api/crafts`, `/api/reviews/public`) are open.

---

## Database

**MongoDB** (`karushala_db`) — collections:

| Collection | Purpose |
|---|---|
| `All-Craft` | Craft/product listings |
| `Reviews` | Separate collection, linked via `craftId`; avg rating synced back to craft on new review |
| `Orders` | Sales data (aggregated by month for dashboard charts); collection created lazily |
| `user` | Better Auth user records, extended with profile/settings fields |

---

## API Routes

### Crafts
| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/crafts` | — | List all crafts |
| POST | `/api/crafts` | Token + demo-restricted | Add craft |
| GET | `/api/crafts/my-crafts` | Token | Crafts by seller email |
| GET | `/api/crafts/my-crafts/paginated` | Token | Paginated version (page/limit) |
| GET | `/api/crafts/:id` | — | Craft details |
| PUT | `/api/crafts/:id` | Demo-restricted | Update craft |
| DELETE | `/api/crafts/:id` | Demo-restricted | Delete craft |

### Reviews
| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/crafts/:id/reviews` | — | Reviews for a craft |
| POST | `/api/crafts/:id/reviews` | Token | Add review; recalculates & syncs avg rating |
| GET | `/api/reviews/public` | — | Latest 10 reviews site-wide, with craft titles |

### Dashboard
| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/dashboard` | Token | Full dashboard payload: stats, sales chart, recent crafts, recent reviews |
| GET | `/api/dashboard/sales` | Token | Monthly sales aggregation |
| GET | `/api/dashboard/reviews` | — | All reviews for artisan's crafts, with titles |
| GET | `/api/dashboard/stats` | Token | Totals only (crafts, sales, reviews, avg rating) |

### Profile & Settings
| Method | Route | Auth | Description |
|---|---|---|---|
| GET | `/api/profile` | Token | Full profile + computed stats |
| PUT | `/api/profile` | Token + demo-restricted | Update profile fields |
| POST | `/api/profile/avatar` | Demo-restricted | Update avatar URL |
| GET | `/api/settings` | Token | Settings (with sane defaults) |
| PUT | `/api/settings` | Token + demo-restricted | Section-based update (profile/notifications/privacy/store/appearance/language) |

---

## Environment Variables

```
PORT=
MONGODB_URI=
BETTER_AUTH_URL=
```

- `BETTER_AUTH_URL` is used both for CORS origin and building the JWKS endpoint URL.

---

## Scripts

```bash
npm run dev     # nodemon + tsx, hot reload on src/index.ts
npm run build   # tsc -> dist/
npm start       # node dist/index.js (production)
```

---

## Local Setup

```bash
npm install
cp .env.example .env   # fill in MONGODB_URI, BETTER_AUTH_URL, PORT
npm run dev
```

---

## Known Gaps / Notes

- Single-file architecture — no route/controller/service separation yet; a natural next step as the API grows.
- Orders collection is checked lazily (`db.listCollections()`) rather than guaranteed to exist — sales endpoints fall back to mock zero-data when absent.
- `restrictDemoUser` reads email from `body`/`query`/header inconsistently across routes — works today since each route only uses one source, but worth standardizing.
- No centralized error-handling middleware; each route has its own try/catch.
