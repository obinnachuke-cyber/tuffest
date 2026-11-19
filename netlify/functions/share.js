/* Tuffest: the page behind a shared-vibe link, https://YOUR-SITE/s/TOKEN
   Link previews in Messages / WhatsApp / Instagram read a page's <meta> tags without running any
   JavaScript, so this builds a tiny page whose tags describe THIS vibe (its title, caption and first
   photo). Real visitors are sent straight on to the app, which shows the vibe. */

// These two values are public by design (same as config.js). Netlify env vars override them.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gdtbicmbuvjijeamyiwu.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkdGJpY21idXZqaWplYW15aXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxMDM4NTYsImV4cCI6MjExMDY3OTg1Nn0.U-xgZ0ZzM-B1FAPe18X0GV44y36Tswfw2Q_FkUQyLMQ';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The caption as plain text: "we went sunset then park". */
const plain = caption => (Array.isArray(caption) ? caption : [])
  .map(s => (s.t === 'loc' ? (s.name || '') : (s.v || '')))
  .join('').replace(/\s+/g, ' ').trim();

exports.handler = async event => {
  // /s/abc123  ->  ?t=abc123 (see netlify.toml)
  const token = String((event.queryStringParameters && event.queryStringParameters.t) || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 40);
  const host = (event.headers && (event.headers['x-forwarded-host'] || event.headers.host)) || '';
  const site = host ? `https://${host}` : '';
  const appUrl = `${site}/app/?v=${token}`;

  let share = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_share`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: token }),
    });
    const rows = await r.json();
    share = Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (e) { /* fall through to the generic page */ }

  const invite = share && share.invite;
  const title = invite ? 'Come add vibes with me · Tuffest' : share ? `${share.title || 'A vibe'} · Tuffest` : 'Tuffest';
  const desc = invite ? (plain(share.caption) || 'Open this, tap Add vibe, and we’ll keep one archive together.').slice(0, 200) : share ? (plain(share.caption) || 'A vibe on Tuffest.').slice(0, 200) : 'A vibe archive.';
  const photo = share && share.photos && share.photos[0];

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Tuffest">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(`${site}/s/${token}`)}">
${photo ? `<meta property="og:image" content="${esc(photo.url)}">
<meta property="og:image:width" content="${esc(photo.w || 1200)}">
<meta property="og:image:height" content="${esc(photo.h || 1200)}">` : ''}
<meta name="twitter:card" content="${photo ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
${photo ? `<meta name="twitter:image" content="${esc(photo.url)}">` : ''}
<link rel="canonical" href="${esc(appUrl)}">
<script>location.replace(${JSON.stringify(appUrl)});</script>
</head><body style="font-family:Georgia,serif;padding:24px"><p><a href="${esc(appUrl)}">Open this vibe on Tuffest</a></p></body></html>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
    body: html,
  };
};
