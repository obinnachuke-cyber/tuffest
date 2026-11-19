/* wesotuf: the page behind an invite link, https://YOUR-SITE/s/TOKEN
   Messages / WhatsApp / Instagram build their link preview from a page's <meta> tags and never run
   JavaScript, so this returns a tiny page whose tags describe THIS vibe: its title, its caption and a
   picture of its photos. People who open the link are sent straight on to the app, which shows the vibe. */

// These two values are public by design (same as config.js). Netlify env vars override them.
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://gdtbicmbuvjijeamyiwu.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdkdGJpY21idXZqaWplYW15aXd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxMDM4NTYsImV4cCI6MjExMDY3OTg1Nn0.U-xgZ0ZzM-B1FAPe18X0GV44y36Tswfw2Q_FkUQyLMQ';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The caption as plain text: "we went sunset then park". */
const plain = caption => (Array.isArray(caption) ? caption : [])
  .map(s => (s.t === 'loc' ? (s.name || '') : (s.v || '')))
  .join('').replace(/\s+/g, ' ').trim();

/** The invite token, wherever Netlify puts it. A redirect to /s/TOKEN can arrive as the original address,
    as /.netlify/functions/share/TOKEN, or (when called directly) as ?t=TOKEN. */
function findToken(event) {
  const inPath = p => { const m = String(p || '').match(/\/(?:s|share)\/([A-Za-z0-9]{6,40})(?:[/?#]|$)/); return m ? m[1] : ''; };
  const q = event.queryStringParameters && event.queryStringParameters.t;
  const fromQuery = /^[A-Za-z0-9]{6,40}$/.test(String(q || '')) ? q : '';
  return inPath(event.rawUrl) || inPath(event.path) || fromQuery;
}

/** Does this address answer? (Used to pick the preview picture.) */
async function exists(url) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch(url, { method: 'HEAD', signal: ctl.signal });
    clearTimeout(t);
    return r.ok;
  } catch (e) { return false; }
}

exports.handler = async event => {
  const token = findToken(event);
  const host = (event.headers && (event.headers['x-forwarded-host'] || event.headers.host)) || '';
  const site = host ? `https://${host}` : '';
  const appUrl = `${site}/app/?v=${token}`;

  let share = null;
  if (token) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_share`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ t: token }),
      });
      const rows = await r.json();
      share = Array.isArray(rows) && rows[0] ? rows[0] : null;
    } catch (e) { /* fall through to the plain page */ }
  }

  // the preview is about the vibe itself: its title, then its caption
  const title = share ? (share.title || (share.invite ? 'Come add vibes with me' : 'A vibe')) : 'wesotuf';
  const desc = share
    ? (plain(share.caption) || (share.invite ? 'Open this and tap Add vibe.' : 'A vibe.')).slice(0, 200)
    : 'A vibe archive.';

  // picture: the 1200x630 collage saved next to the photos when the invite was made, else the first photo
  const first = share && share.photos && share.photos[0];
  let image = null;
  if (first && first.url) {
    const og = first.url.replace(/\/\d+\.jpg(\?.*)?$/, '/og.jpg');
    image = (og !== first.url && await exists(og))
      ? { url: og, w: 1200, h: 630 }
      : { url: first.url, w: first.w || 1200, h: first.h || 1200 };
  }

  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(`${site}/s/${token}`)}">
${image ? `<meta property="og:image" content="${esc(image.url)}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="${esc(image.w)}">
<meta property="og:image:height" content="${esc(image.h)}">` : ''}
<meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
${image ? `<meta name="twitter:image" content="${esc(image.url)}">` : ''}
<link rel="canonical" href="${esc(appUrl)}">
<script>location.replace(${JSON.stringify(appUrl)});</script>
</head><body style="font-family:Georgia,serif;padding:24px"><p><a href="${esc(appUrl)}">Open this vibe</a></p></body></html>`;

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
    body: html,
  };
};
