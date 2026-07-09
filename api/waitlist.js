// KaviNote waitlist API (Vercel serverless function)
// POST /api/waitlist  { email }          -> adds email to the waitlist
// GET  /api/waitlist  (X-Admin-Key hdr)  -> returns all entries (admin only)
//
// Storage: Upstash Redis via REST (works with Vercel KV / Upstash Marketplace
// env vars). Emails are kept in a sorted set keyed by signup timestamp, so
// duplicates are impossible and order is preserved.

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

// Default storage: the owner's private Google Sheet, written via its linked
// Google Form. The sheet is only readable by the owner's Google account;
// this endpoint can only append, never read.
const GFORM_ID = '1FAIpQLSfYwI4tl8M_boP3dtpvzPAekTmez-4XfFXBcjUTU0GdnCSBhQ';
const GFORM_EMAIL_FIELD = 'entry.770341589';

async function appendToSheet(email) {
  const r = await fetch('https://docs.google.com/forms/d/e/' + GFORM_ID + '/formResponse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: GFORM_EMAIL_FIELD + '=' + encodeURIComponent(email)
  });
  if (!r.ok) throw new Error('sheet append failed: ' + r.status);
}

async function redis(command) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + REDIS_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(command)
  });
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data.result;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');

  const hasRedis = Boolean(REDIS_URL && REDIS_TOKEN);

  try {
    if (req.method === 'POST') {
      const email = ((req.body && req.body.email) || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        return res.status(400).json({ success: false, error: 'Invalid email' });
      }
      if (hasRedis) {
        // NX = only add if new, so the original signup date is never overwritten
        await redis(['ZADD', 'waitlist', 'NX', Date.now().toString(), email]);
      } else {
        await appendToSheet(email);
      }
      return res.status(200).json({ success: true });
    }

    if (req.method === 'GET') {
      const key = req.headers['x-admin-key'] || (req.query && req.query.key);
      if (!process.env.ADMIN_KEY || !key || key !== process.env.ADMIN_KEY) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }
      if (!hasRedis) {
        return res.status(503).json({ success: false, error: 'Signups are stored in your Google Sheet — open it in Google Drive to see the list.' });
      }
      const flat = await redis(['ZRANGE', 'waitlist', '0', '-1', 'WITHSCORES']);
      const entries = [];
      for (let i = 0; i < flat.length; i += 2) {
        entries.push({ email: flat[i], joined: Number(flat[i + 1]) });
      }
      return res.status(200).json({ success: true, count: entries.length, entries });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Server error' });
  }
};
