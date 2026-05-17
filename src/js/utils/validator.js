/**
 * utils/validator.js
 * ─────────────────────────────────────────────────────────────────
 * Centralised validation rules for LR entries and ledger entries.
 *
 * WHY: Validation is currently duplicated across create.js, receipts.js,
 *   and ledger.js. Each file re-implements its own checks with slightly
 *   different error messages and missing cases. This creates bugs where
 *   import validation passes data that the UI form would reject.
 *
 * RISK LEVEL: Low — purely additive. Existing validation code is
 *   NOT removed; this file is available for new callers and
 *   gradual migration.
 *
 * BACKWARD COMPATIBLE: Yes — existing validation code continues to work.
 *
 * IMPACT: Single source of truth for all validation rules. Future
 *   changes to rules only need to happen in one place.
 */

// ─────────────────────────────────────────────────────────────────
//  LR ENTRY VALIDATION
// ─────────────────────────────────────────────────────────────────

/**
 * Validate a full LR form submission.
 * Returns { valid: true } or { valid: false, field: string, message: string }
 *
 * @param {object} d — form data object (camelCase keys)
 */
export function validateLR(d) {
  if (!d.cnNo?.trim())
    return { valid: false, field: 'f-cnNo', message: 'CN No. is required.' };

  if (!d.cnDate)
    return { valid: false, field: 'f-cnDate', message: 'CN Date is required.' };

  if (!d.consignor?.trim())
    return { valid: false, field: 'f-consignor', message: 'Consignor name is required.' };

  if (!d.consignee?.trim())
    return { valid: false, field: 'f-consignee', message: 'Consignee name is required.' };

  if (!d.paymentSide)
    return { valid: false, field: 'f-paymentSide', message: 'Please select Payment Side (Consignor or Consignee).' };

  if (!['consignor', 'consignee'].includes(d.paymentSide))
    return { valid: false, field: 'f-paymentSide', message: 'Invalid Payment Side value.' };

  // Numeric range checks — only validate if a value was provided
  if (d.weight !== null && d.weight !== undefined && d.weight < 0)
    return { valid: false, field: 'f-weight', message: 'Weight cannot be negative.' };

  if (d.tbb !== null && d.tbb !== undefined && d.tbb < 0)
    return { valid: false, field: 'f-tbb', message: 'TBB amount cannot be negative.' };

  if (d.lorryHire !== null && d.lorryHire !== undefined && d.lorryHire < 0)
    return { valid: false, field: 'f-lorryHire', message: 'Lorry Hire cannot be negative.' };

  if (d.advance !== null && d.advance !== undefined && d.advance < 0)
    return { valid: false, field: 'f-advance', message: 'Advance cannot be negative.' };

  // Date sanity check
  const dateObj = new Date(d.cnDate);
  if (isNaN(dateObj.getTime()))
    return { valid: false, field: 'f-cnDate', message: 'CN Date is not a valid date.' };

  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────
//  LEDGER ENTRY VALIDATION
// ─────────────────────────────────────────────────────────────────

/**
 * Validate a manual ledger entry.
 * Returns { valid: true } or { valid: false, message: string }
 *
 * @param {object} p — { companyName, date, amountStr, side, type }
 */
export function validateLedgerEntry({ companyName, date, amountStr, side, type }) {
  if (!companyName?.trim())
    return { valid: false, message: 'Company name is required.' };

  if (!date)
    return { valid: false, message: 'Date is required.' };

  const dateObj = new Date(date);
  if (isNaN(dateObj.getTime()))
    return { valid: false, message: 'Date is not valid.' };

  if (!['debit', 'credit'].includes(side))
    return { valid: false, message: 'Please select Debit or Credit.' };

  if (!['Payment', 'Receipt', 'Journal'].includes(type))
    return { valid: false, message: 'Invalid voucher type.' };

  const amount = parseFloat(String(amountStr || '').replace(/[₹,\s]/g, ''));
  if (isNaN(amount) || amount <= 0)
    return { valid: false, message: 'Amount must be greater than zero.' };

  if (amount > 99_999_999)
    return { valid: false, message: 'Amount exceeds maximum allowed (₹9,99,99,999).' };

  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────
//  SUPABASE CONFIG VALIDATION
// ─────────────────────────────────────────────────────────────────

/**
 * Validate Supabase connection config before attempting to connect.
 * Returns { valid: true } or { valid: false, message: string }
 */
export function validateSupabaseConfig({ url, anonKey }) {
  if (!url?.trim())
    return { valid: false, message: 'Supabase Project URL is required.' };

  if (!url.startsWith('https://') || !url.includes('.supabase.co'))
    return { valid: false, message: 'URL must be a valid Supabase project URL (https://xxx.supabase.co).' };

  if (!anonKey?.trim())
    return { valid: false, message: 'Supabase Anon Key is required.' };

  if (!anonKey.startsWith('eyJ'))
    return { valid: false, message: 'Anon Key must be a valid JWT (starts with eyJ...).' };

  return { valid: true };
}

// ─────────────────────────────────────────────────────────────────
//  COMPANY VALIDATION
// ─────────────────────────────────────────────────────────────────
export function validateCompanyName(name) {
  if (!name?.trim())
    return { valid: false, message: 'Company name is required.' };

  if (name.trim().length > 200)
    return { valid: false, message: 'Company name is too long (max 200 characters).' };

  return { valid: true };
}
