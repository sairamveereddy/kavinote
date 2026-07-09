// KaviNote waitlist API (Vercel serverless function)
// POST /api/waitlist  { email }          -> adds email to the waitlist
// GET  /api/waitlist  (X-Admin-Key hdr)  -> returns all entries (admin only)
//
// Storage: Upstash Redis via REST (works with Vercel KV / Upstash Marketplace
// env vars). Emails are kept in a sorted set keyed by signup timestamp, so
// duplicates are impossible and order is preserved.

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

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

  if (!REDIS_URL || !REDIS_TOKEN) {
    return res.status(503).json({ success: false, error: 'Storage not configured yet' });
  }

  try {
    if (req.method === 'POST') {
      const email = ((req.body && req.body.email) || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        return res.status(400).json({ success: false, error: 'Invalid email' });
      }
      // NX = only add if new, so the original signup date is never overwritten
      await redis(['ZADD', 'waitlist', 'NX', Date.now().toString(), email]);
      return res.status(200).json({ success: true });
    }

    if (req.method === 'GET') {
      const key = req.headers['x-admin-key'] || (req.query && req.query.key);
      if (!process.env.ADMIN_KEY || !key || key !== process.env.ADMIN_KEY) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
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
