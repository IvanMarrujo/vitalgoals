import { guard, corsOrigin } from './lib/security.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', corsOrigin(req));
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Gainz-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const ok = await guard(req, res, { rateLimitKey: 'sync', limit: 60, windowSeconds: 60, decoy: 'analyze' });
  if (!ok) return;

  const { action, userId, date, data } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return res.status(200).json({ ok: false, reason: 'Upstash no configurado' });
  }

  try {
    if (action === 'push') {
      if (!date) return res.status(400).json({ error: 'date required' });
      const key = `gainz:user:${userId}:log:${date}`;
      await fetch(`${url}/set/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify(data || [])
      });
      return res.status(200).json({ ok: true });
    }

    if (action === 'pull') {
      const days = [];
      const now = new Date();
      for (let i = 0; i < 30; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        days.push(d.toISOString().split('T')[0]);
      }
      const results = {};
      for (const day of days) {
        const key = `gainz:user:${userId}:log:${day}`;
        const r = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const j = await r.json();
        if (j && j.result) {
          try { results[day] = JSON.parse(j.result); } catch { results[day] = []; }
        }
      }
      return res.status(200).json({ ok: true, days: results });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (err) {
    console.error('[sync] exception', { message: err.message });
    return res.status(500).json({ error: err.message });
  }
}
