// Settings (same meaning as config.php). Edit here, then deploy again.
// Secrets (Telegram token) go in `wrangler secret put TELEGRAM_BOT_TOKEN`, not here.
export const CFG = {
  // Address people use, e.g. 'https://files.yourdomain.com'. Leave '' to use whatever address the page was opened with.
  public_url: '',
  max_mb_cap: 2000,            // largest total size (MB) for one upload
  max_files_per_batch: 20,
  site_name: 'Luna Transfer',
  logo_url: '',
  guest_uploads_per_hour: 60,
  free_mb: 100,
  free_resets: 2,
  price_per_gb: 50,
  max_paid_gb: 200,
  currency: 'PHP',
  tiers: {
    company: { name: 'Company',          gb: 100,  price: 2500,  subs: 2 },
    pro:     { name: 'Company Pro',      gb: 300,  price: 5000,  subs: 4 },
    plus:    { name: 'Company Pro Plus', gb: 1000, price: 10000, subs: 9 },   // KUMPIRMAHIN ANG GB
  },
  // Payment details shown to customers (empty = that method is hidden)
  gcash_number: '', gcash_name: '',
  bank_name: '', bank_account_name: '', bank_account_no: '',
  contact_email: '',
  // Strict account checking
  max_per_device: 1,
  max_per_ip_day: 3,
  blocked_domains: ['mailinator.com', '10minutemail.com', 'guerrillamail.com', 'tempmail.com', 'yopmail.com', 'sharklasers.com', 'trashmail.com'],
  // Month boundaries for quota resets use this offset from UTC (Philippines = +8)
  tz_offset_hours: 8,
  // R2 folder for the encrypted files
  r2_prefix: 'files/',
};
