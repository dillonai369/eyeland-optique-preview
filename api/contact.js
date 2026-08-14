// Eyeland Optique — form handler (Vercel serverless function)
// Receives both the contact form and the appointment-request form,
// then delivers via Resend to the shop inbox.
//
// Required Vercel env var: RESEND_API_KEY
// Optional:               NOTIFY_TO_EMAIL  (defaults to info@eyelandoptique.com)

const TO = process.env.NOTIFY_TO_EMAIL || 'info@eyelandoptique.com';
const FROM = 'Eyeland Optique Website <website@send.eyelandoptique.com>';

const esc = (v = '') =>
  String(v).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

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
    } = body;

    // Honeypot — bots fill this, humans never see it
    if (botcheck) return res.status(200).json({ ok: true });

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
    const subject = isAppt
      ? `New appointment request — ${name.trim()}`
      : `New website enquiry — ${name.trim()}`;

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
        <h2 style="font-family:Georgia,serif;color:#142322;margin:0 0 4px">${esc(subject)}</h2>
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
