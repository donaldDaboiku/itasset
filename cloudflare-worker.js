/**
 * ITAssetTrack — Gumroad License Verification Worker
 * ===================================================
 * Deploy this on Cloudflare Workers (free plan is plenty).
 *
 * SETUP STEPS:
 *  1. Go to https://workers.cloudflare.com  and sign up (free)
 *  2. Click "Create a Worker"
 *  3. Delete the default code, paste this entire file
 *  4. Change PRODUCT_PERMALINK below to your Gumroad product permalink
 *     (the part after gumroad.com/l/ — yours is 'itassettrack')
 *  5. Click "Deploy"
 *  6. Copy the Worker URL shown (e.g. https://itassettrack-license.you.workers.dev)
 *  7. Paste that URL into WORKER_URL in your ITAssetTrack HTML file
 *
 * That's it. The Worker proxies requests to Gumroad's API,
 * adding the CORS headers the browser needs.
 */

// ── CONFIGURE THIS ──────────────────────────────────────
const PRODUCT_PERMALINK = 'itassettrack'; // Your Gumroad product permalink slug
// ────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

function inferPackageId(productName = '') {
  const text = String(productName || '').toLowerCase();
  if (text.includes('business') || text.includes('unlimited') || text.includes('enterprise') || text.includes('premium')) return 'business';
  if (text.includes('pro') || text.includes('team5') || text.includes('team 5') || text.includes('5 staff') || text.includes('five staff')) return 'pro';
  if (text.includes('starter') || text.includes('one-time') || text.includes('basic')) return 'starter';
  return 'starter';
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: CORS_HEADERS,
  });
}

export default {
  async fetch(request) {

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return json({ valid: false, error: 'Method not allowed' }, 405);
    }

    // Parse incoming request body
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ valid: false, error: 'Invalid JSON body' }, 400);
    }

    const licenseKey = (body.license_key || '').trim();
    if (!licenseKey) {
      return json({ valid: false, error: 'No license key provided' }, 400);
    }

    // Call Gumroad License Verification API
    let gumroadRes;
    try {
      gumroadRes = await fetch('https://api.gumroad.com/v2/licenses/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          product_permalink: PRODUCT_PERMALINK,
          license_key: licenseKey,
          increment_uses_count: 'false', // don't count verification calls as "uses"
        }),
      });
    } catch (err) {
      return json({ valid: false, error: 'Could not reach Gumroad API' }, 502);
    }

    const gumroadData = await gumroadRes.json().catch(() => ({}));

    if (gumroadData.success && gumroadData.purchase) {
      const purchase = gumroadData.purchase;
      return json({
        valid: true,
        purchaser: purchase.email || '',
        productName: purchase.product_name || '',
        packageId: inferPackageId(purchase.product_name || ''),
        uses: gumroadData.uses || 0,
        // Don't expose the full purchase object — keep it minimal
      });
    }

    // Gumroad returned an error or the key is invalid
    const errMsg = gumroadData.message || 'License key not found or invalid.';
    return json({ valid: false, error: errMsg });
  },
};
