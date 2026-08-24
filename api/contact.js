// Eyeland Optique — form handler (Vercel serverless function)
// Receives both the contact form and the appointment-request form,
// then delivers via Resend to the shop inbox.
//
// Required Vercel env var: RESEND_API_KEY
// Optional:               NOTIFY_TO_EMAIL  (defaults to info@eyelandoptique.com)

const TO = process.env.NOTIFY_TO_EMAIL || 'info@eyelandoptique.com';
const FROM = 'Eyeland Optique Website <website@eyelandoptique.com>';

const esc = (v = '') =>
  String(v).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// ---------------------------------------------------------------------------
// Spam controls
//
// Design note: anything that could plausibly be a real patient is still
// delivered — it just gets flagged in the subject line so it can be filtered.
// Only signals with a near-zero false-positive rate cause a hard drop.
// ---------------------------------------------------------------------------

// Minimum time a human needs to complete the form. Bots post in milliseconds.
const MIN_FILL_MS = 3000;

// Links in free-text fields. A patient booking an eye exam does not paste URLs.
const LINK_RE = /(https?:\/\/|www\.|\[url|<a\s|\b[a-z0-9-]+\.(?:com|net|org|ru|cn|xyz|top|info|biz|io|co)\b[/?])/i;

// Phrases that suggest solicitation. These only FLAG, never drop.
const SPAM_PHRASES = [
  // "donate" alone is a genuine enquiry here (people offer old frames), so
  // only the solicitation phrasings are listed.
  'donate now', 'donate today', 'your donation', 'donation to support',
  'contribution', 'political', 'candidate', 'election', 'ballot',
  'campaign fund', 'fundrais', 'pac ', 'crypto', 'bitcoin', 'forex',
  'investment opportunity', 'seo', 'backlink', 'link building', 'guest post',
  'rank higher', 'first page of google', 'web design', 'website redesign',
  'increase your traffic', 'digital marketing', 'lead generation',
  'dear sir', 'dear madam', 'business proposal', 'work from home',
];

// Simple per-IP throttle. Serverless instances recycle, so this is a speed
// bump against bulk blasts rather than a guarantee.
const RATE_LIMIT_MAX = 4;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const hits = new Map();

function rateLimited(ip) {
  if (!ip) return false;
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // crude memory guard
  return recent.length > RATE_LIMIT_MAX;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
    const {
      form_type = 'Contact',
      name = '',
      email = '',
      phone = '',
      topic = '',
      appointment_type = '',
      preferred_time = '',
      message = '',
      consent = '',
      botcheck = '',
      elapsed_ms = null,
    } = body;

    // --- Silent drops -------------------------------------------------------
    // All of these return a normal success response so the sender learns
    // nothing and doesn't adapt. Nothing is emailed.

    // 1. Honeypot — bots fill this, humans never see it
    if (botcheck) return res.status(200).json({ ok: true });

    // 2. Time trap — missing timer means the form JS never ran (scripted post)
    const elapsed = Number(elapsed_ms);
    if (!Number.isFinite(elapsed) || elapsed < MIN_FILL_MS) {
      console.warn('Blocked: time trap', { elapsed_ms, email });
      return res.status(200).json({ ok: true });
    }

    // 3. Links in free-text fields
    const freeText = [name, message, preferred_time, topic].join(' \n ');
    if (LINK_RE.test(freeText)) {
      console.warn('Blocked: link in free text', { email });
      return res.status(200).json({ ok: true });
    }

    // 4. Per-IP throttle
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (rateLimited(ip)) {
      console.warn('Blocked: rate limit', { ip });
      return res.status(200).json({ ok: true });
    }

    // --- Soft flag ----------------------------------------------------------
    // Delivered, but marked so it can be filtered. Never dropped, because a
    // real patient could conceivably trip one of these words.
    const haystack = freeText.toLowerCase();
    const matched = SPAM_PHRASES.filter((p) => haystack.includes(p));
    const suspect = matched.length > 0;

    if (!name.trim() || !email.trim()) {
      return res.status(400).json({ ok: false, error: 'Name and email are required.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return res.status(400).json({ ok: false, error: 'Please enter a valid email address.' });
    }
    if (!consent) {
      return res.status(400).json({ ok: false, error: 'Please accept the privacy notice to continue.' });
    }

    const isAppt = /appointment/i.test(form_type);
    const baseSubject = isAppt
      ? `New appointment request — ${name.trim()}`
      : `New website enquiry — ${name.trim()}`;
    const subject = suspect ? `[POSSIBLE SPAM] ${baseSubject}` : baseSubject;

    const rows = [
      ['Name', name],
      ['Email', email],
      ['Phone', phone],
      isAppt ? ['Appointment type', appointment_type] : ['Topic', topic],
      isAppt ? ['Preferred day / time', preferred_time] : null,
      ['Message', message],
    ].filter(Boolean).filter(([, v]) => String(v || '').trim());

    const html = `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:600px">
        ${suspect ? `<p style="margin:0 0 16px;padding:10px 14px;background:#fdf0e8;border-left:3px solid #a05a3f;color:#8a3a2d;font-size:13px">
          Flagged as a possible solicitation (matched: ${esc(matched.join(', '))}). Delivered anyway in case it's genuine.
        </p>` : ''}
        <h2 style="font-family:Georgia,serif;color:#142322;margin:0 0 4px">${esc(baseSubject)}</h2>
        <p style="color:#7a8584;margin:0 0 20px;font-size:13px">
          Sent from eyelandoptique.com · ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET
        </p>
        <table style="border-collapse:collapse;width:100%">
          ${rows.map(([k, v]) => `
            <tr>
              <td style="padding:10px 14px;background:#f6f1e8;border:1px solid #d9ceba;font-weight:600;width:170px;vertical-align:top">${esc(k)}</td>
              <td style="padding:10px 14px;border:1px solid #d9ceba">${esc(v).replace(/\n/g, '<br>')}</td>
            </tr>`).join('')}
        </table>
        <p style="color:#7a8584;font-size:12px;margin-top:20px">
          Reply directly to this email to respond to ${esc(name)}.
        </p>
      </div>`;

    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: [TO],
        reply_to: email.trim(),
        subject,
        html,
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      console.error('Resend error:', r.status, detail);
      return res.status(502).json({ ok: false, error: 'Could not send right now. Please call the shop at 843 681 2020.' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ ok: false, error: 'Something went wrong. Please call the shop at 843 681 2020.' });
  }
}
