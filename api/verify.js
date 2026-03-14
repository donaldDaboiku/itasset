const crypto = require('crypto');

function signToken(payload, secret) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${header}.${body}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('base64url');
  return `${data}.${sig}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  let license_key = '';
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    license_key = String(body.license_key || '').trim();
  } catch (e) {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  if (!license_key) {
    res.status(400).json({ error: 'License key is required' });
    return;
  }

  const product_permalink = process.env.GUMROAD_PRODUCT_PERMALINK;
  if (!product_permalink) {
    res.status(500).json({ error: 'Server not configured: missing product permalink' });
    return;
  }

  const params = new URLSearchParams({
    product_permalink,
    license_key,
    increment_uses_count: 'false'
  });

  if (process.env.GUMROAD_ACCESS_TOKEN) {
    params.set('access_token', process.env.GUMROAD_ACCESS_TOKEN);
  }

  try {
    const resp = await fetch('https://api.gumroad.com/v2/licenses/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data.success) {
      res.status(400).json({ error: 'Invalid license key' });
      return;
    }

    const purchase = data.purchase || {};
    if (purchase.refunded || purchase.chargebacked || purchase.disputed) {
      res.status(400).json({ error: 'License is not valid (refunded or disputed)' });
      return;
    }

    const signingSecret = process.env.LICENSE_SIGNING_SECRET;
    if (!signingSecret) {
      res.status(500).json({ error: 'Server not configured: missing signing secret' });
      return;
    }

    const token = signToken({
      license_key,
      product: product_permalink,
      purchase_id: purchase.id || null,
      email: purchase.email || null,
      ts: Date.now()
    }, signingSecret);

    res.status(200).json({ valid: true, token });
  } catch (e) {
    res.status(500).json({ error: 'Verification failed' });
  }
};
