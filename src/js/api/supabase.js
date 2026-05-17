/**
 * Supabase client factory + column mapping.
 * camelCase (app) ↔ snake_case (Supabase)
 */

// ── Column mappers ────────────────────────────────────────────────
export const toSB = e => ({
  cn_no          : e.cnNo,
  cn_date        : e.cnDate,
  weight         : e.weight         ?? null,
  no_of_packages : e.noOfPackages   ?? null,
  consignor      : e.consignor,
  consignee      : e.consignee,
  destination    : e.destination    ?? null,
  truck_no       : e.truckNo        ?? null,
  to_pay         : e.toPay          ?? null,
  tbb            : e.tbb            ?? null,
  challan_no     : e.challanNo      ?? null,
  challan_date   : e.challanDate    ?? null,
  lorry_hire     : e.lorryHire      ?? null,
  advance        : e.advance        ?? null,
  balance        : e.balance        ?? null,
  bill_no_date   : e.billNoDate     ?? null,
  mr_no          : e.mrNo           ?? null,
  payment_side   : e.paymentSide    ?? null,
  updated_at     : new Date().toISOString(),
});

export const fromSB = r => ({
  id            : r.id,
  cnNo          : r.cn_no,
  cnDate        : r.cn_date,
  weight        : r.weight,
  noOfPackages  : r.no_of_packages,
  consignor     : r.consignor,
  consignee     : r.consignee,
  destination   : r.destination,
  truckNo       : r.truck_no,
  toPay         : r.to_pay,
  tbb           : r.tbb,
  challanNo     : r.challan_no,
  challanDate   : r.challan_date,
  lorryHire     : r.lorry_hire,
  advance       : r.advance,
  balance       : r.balance,
  billNoDate    : r.bill_no_date,
  mrNo          : r.mr_no,
  paymentSide   : r.payment_side,
  createdAt     : r.created_at,
  updatedAt     : r.updated_at,
});

// ── Supabase SQL schema (shown in Settings → Copy SQL) ────────────
export const SCHEMA_SQL = `
-- ╔══════════════════════════════════════════════════════╗
-- ║  AIFC Transport — Supabase Schema                   ║
-- ╚══════════════════════════════════════════════════════╝

-- ── 1. LR Entries ─────────────────────────────────────────────────
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
  payment_side   TEXT CHECK (payment_side IN ('consignor','consignee')),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cn_date      ON entries (cn_date DESC);
CREATE INDEX IF NOT EXISTS idx_consignor    ON entries (consignor);
CREATE INDEX IF NOT EXISTS idx_consignee    ON entries (consignee);
CREATE INDEX IF NOT EXISTS idx_mr_no        ON entries (mr_no);
CREATE INDEX IF NOT EXISTS idx_payment_side ON entries (payment_side);

ALTER TABLE entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "entries_auth" ON entries
  FOR ALL TO authenticated
  USING  (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Migration for existing tables (run only if entries table already exists):
-- ALTER TABLE entries
--   ADD COLUMN IF NOT EXISTS payment_side TEXT
--   CHECK (payment_side IN ('consignor','consignee'));

-- ── 2. Smart Ledger — Companies ───────────────────────────────────
CREATE TABLE IF NOT EXISTS sl_companies (
  name            TEXT PRIMARY KEY,
  tracked         BOOLEAN DEFAULT false,
  opening_balance BIGINT  DEFAULT 0,
  added_at        BIGINT
);

ALTER TABLE sl_companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sl_companies_auth" ON sl_companies
  FOR ALL TO authenticated
  USING  (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ── 3. Smart Ledger — Entries ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS sl_ledger_entries (
  id           TEXT PRIMARY KEY,
  company_name TEXT NOT NULL
               REFERENCES sl_companies(name) ON DELETE CASCADE,
  date         DATE NOT NULL,
  type         TEXT NOT NULL
               CHECK (type IN ('Payment','Receipt','Journal')),
  vch_no       TEXT NOT NULL,
  side         TEXT NOT NULL
               CHECK (side IN ('debit','credit')),
  debit        BIGINT DEFAULT 0,
  credit       BIGINT DEFAULT 0,
  remarks      TEXT,
  source       TEXT DEFAULT 'manual',
  lr_id        TEXT,
  payment_side TEXT,
  created_at   BIGINT,
  updated_at   BIGINT
);

CREATE INDEX IF NOT EXISTS idx_sl_company
  ON sl_ledger_entries (company_name, date);

ALTER TABLE sl_ledger_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sl_ledger_auth" ON sl_ledger_entries
  FOR ALL TO authenticated
  USING  (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);


-- ── SECURITY MIGRATION: Drop open anon policies, add auth-only ──
-- Run this in Supabase SQL Editor if tables already exist:
--
-- DROP POLICY IF EXISTS "entries_all"       ON entries;
-- DROP POLICY IF EXISTS "entries_auth"      ON entries;
-- DROP POLICY IF EXISTS "sl_companies_all"  ON sl_companies;
-- DROP POLICY IF EXISTS "sl_companies_auth" ON sl_companies;
-- DROP POLICY IF EXISTS "sl_ledger_all"     ON sl_ledger_entries;
-- DROP POLICY IF EXISTS "sl_ledger_auth"    ON sl_ledger_entries;
--
-- CREATE POLICY "entries_auth" ON entries
--   FOR ALL TO authenticated
--   USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
--
-- CREATE POLICY "sl_companies_auth" ON sl_companies
--   FOR ALL TO authenticated
--   USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
--
-- CREATE POLICY "sl_ledger_auth" ON sl_ledger_entries
--   FOR ALL TO authenticated
--   USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
`;
