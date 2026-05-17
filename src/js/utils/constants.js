// ── LocalStorage keys ────────────────────────────────────────────
export const SB_URL_KEY  = 'aifc_sb_url';
export const SB_AKEY_KEY = 'aifc_sb_akey';

// ── Time constants ────────────────────────────────────────────────
export const PIN_TIMEOUT = 8 * 60 * 1000; // 8 minutes

// ── Month labels ──────────────────────────────────────────────────
export const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
export const MONTHS_SHORT = [
  'Jan','Feb','Mar','Apr','May','Jun',
  'Jul','Aug','Sep','Oct','Nov','Dec',
];

// ── Page routing map ──────────────────────────────────────────────
export const PAGES = {
  dashboard : 'pg-dashboard',
  receipts  : 'pg-receipts',
  create    : 'pg-create',
  reports   : 'pg-reports',
  ledger    : 'pg-ledger',
  settings  : 'pg-settings',
};

export const PAGE_TITLES = {
  dashboard : 'Dashboard',
  receipts  : 'Lorry Receipts',
  create    : 'Create LR',
  reports   : 'Reports & P&L',
  ledger    : 'Smart Ledger',
  settings  : 'Settings',
};

// ── Form fields (camelCase) ───────────────────────────────────────
export const FIELDS = [
  'cnNo','cnDate','weight','noOfPackages',
  'consignor','consignee','destination','truckNo',
  'toPay','tbb','challanNo','challanDate',
  'lorryHire','advance','balance','billNoDate','mrNo',
  'paymentSide',   // NEW: 'consignor' | 'consignee' — who pays freight
];

// ── Excel import column mapping ───────────────────────────────────
export const FM = {
  'cnno':'cnNo','cn#':'cnNo','consignmentnote':'cnNo','lotno':'cnNo',
  'cndate':'cnDate','consignmentdate':'cnDate','date':'cnDate',
  'weight':'weight','weightkg':'weight','wt':'weight',
  'noofpackages':'noOfPackages','packages':'noOfPackages','pkgs':'noOfPackages','bags':'noOfPackages',
  'consignor':'consignor','consignorsname':'consignor','sender':'consignor',
  'consignee':'consignee','consigneesname':'consignee','receiver':'consignee',
  'destination':'destination','dest':'destination',
  'truckno':'truckNo','vehicleno':'truckNo','lorryno':'truckNo',
  'topay':'toPay','freight':'toPay','freightcharge':'toPay',
  'tbb':'tbb','tobebilled':'tbb',
  'challanno':'challanNo','challan':'challanNo','chno':'challanNo',
  'challandate':'challanDate','chdate':'challanDate',
  'lorryhire':'lorryHire','hire':'lorryHire','lorrycharge':'lorryHire',
  'advance':'advance','advancepaid':'advance','adv':'advance',
  'balance':'balance','bal':'balance',
  'billnodate':'billNoDate','billno':'billNoDate','invoice':'billNoDate',
  'mrno':'mrNo','moneyreceiptno':'mrNo','mr':'mrNo',
  'paymentside':'paymentSide','payside':'paymentSide','payer':'paymentSide',
};
