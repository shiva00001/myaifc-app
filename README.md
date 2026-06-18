# AIFC Transport Management

A full-stack transport management system for consignment notes, lorry receipts, and P&L analytics — built with Vite and Supabase.

---

## Features

- **Lorry Receipts (LR)** — create, edit, delete, filter, and search consignment entries
- **Dashboard** — monthly income, pending balance, and recent bookings
- **Party Ledger** — Tally-style Dr/Cr ledger per consignor/consignee with PDF print & WhatsApp share
- **Reports & P&L** — monthly bar/line chart + filtered Excel export
- **Import/Export** — CSV and XLSX bulk import; Excel export with column formatting
- **Offline Mode** — IndexedDB cache + write queue, auto-syncs on reconnect
- **Privacy PIN** — 4-digit lock for financial columns (TBB, balance, income)
- **Supabase Auth** — sign-in, forgot password, set new password

---

## Tech Stack

| Layer    | Technology                          |
|----------|-------------------------------------|
| Build    | Vite 5                              |
| Backend  | Supabase (PostgreSQL + Auth)        |
| Offline  | IndexedDB (custom cache + queue)    |
| Charts   | Chart.js 4 (lazy-loaded)            |
| Sheets   | SheetJS / xlsx (lazy-loaded)        |
| Styling  | Vanilla CSS with custom properties  |

---

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and add your Supabase project URL and anon key:

```
```

### 3. Create the Supabase table

In your Supabase dashboard → SQL Editor, run the SQL shown in the app's Settings page (or copy from `src/js/api/supabase.js` → `SCHEMA_SQL`).

### 4. Start development server

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### 5. Build for production

```bash
npm run build
```

Output goes to `dist/`. Deploy to any static host (Netlify, Vercel, Cloudflare Pages, etc.).

---

## Project Structure

```
aifc-transport/
├── public/               Static assets (favicon, manifest, robots.txt)
├── src/
│   ├── index.html        Main HTML template (Vite entry)
│   ├── styles/
│   │   ├── abstracts/    CSS variables / tokens
│   │   ├── base/         Reset + animations
│   │   ├── components/   Buttons, cards, tables, forms, modals
│   │   ├── layouts/      Sidebar, header
│   │   ├── pages/        Login, ledger drawer
│   │   └── main.css      Single import file
│   └── js/
│       ├── api/          Supabase client, column mappers, CRUD, IDB cache
│       ├── auth/         Sign-in/out, forgot password, PIN system
│       ├── components/   Sidebar, modals, toasts
│       ├── pages/        dashboard, receipts, create, reports, ledger, settings
│       ├── utils/        constants, helpers (formatters, debounce, parsers)
│       └── main.js       App bootstrapper
├── .env.example          Env template — safe to commit
├── .env                  Real secrets — DO NOT COMMIT
├── .gitignore
├── .prettierrc
├── package.json
├── vite.config.js
└── README.md
```

---

## Environment Variables

| Variable               | Description                            |
|------------------------|----------------------------------------|
| `VITE_SUPABASE_URL`    | Your Supabase project URL              |
| `VITE_SUPABASE_ANON_KEY` | Public anon key (safe for frontend)  |

> The app also accepts these values entered directly in the Settings page (stored in `localStorage`), so the `.env` is optional for local dev without a build step.

---

## Supabase Table Schema

```sql
CREATE TABLE IF NOT EXISTS entries (
  id             BIGSERIAL PRIMARY KEY,
  cn_no          TEXT UNIQUE NOT NULL,
  cn_date        DATE NOT NULL,
  weight         NUMERIC,
  no_of_packages TEXT,
  consignor      TEXT NOT NULL,
  consignee      TEXT NOT NULL,
  destination    TEXT,
  truck_no       TEXT,
  to_pay         NUMERIC,
  tbb            NUMERIC,
  challan_no     TEXT,
  challan_date   DATE,
  lorry_hire     NUMERIC,
  advance        NUMERIC,
  balance        NUMERIC,
  bill_no_date   TEXT,
  mr_no          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all" ON entries FOR ALL TO anon USING (true) WITH CHECK (true);
```

---

## Default PIN

The default privacy PIN is **1234**. Change it in Settings → Privacy PIN.

---

## Deployment

The built `dist/` folder is a pure static site. Deploy to:

- **Netlify** — drag & drop `dist/` or connect your repo
- **Vercel** — `vercel --prod`
- **Cloudflare Pages** — connect repo, build command `npm run build`, output `dist`

---

## License

Private / proprietary. All rights reserved.
