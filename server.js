// ── Booster Ustad backend ─────────────────────────────────────────────────
// Express + SQLite. Every real integration (Twilio, Meta, OpenAI) is written
// as a genuine code path gated on env vars; when env vars are missing the
// endpoint runs in clearly-labeled DEMO mode. No secrets are ever in code.

require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const db = require('./db');
const { DATA_DIR, UPLOADS_DIR } = require('./paths');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Config flags ──────────────────────────────────────────────────────────
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-change-me';
if (!process.env.SESSION_SECRET) {
  console.warn('[warn] SESSION_SECRET not set — using an insecure dev default. Set it in .env for production.');
}
const HAS_TWILIO = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_VERIFY_SERVICE_SID);
const HAS_FB = !!(process.env.FB_APP_ID && process.env.FB_APP_SECRET && process.env.FB_REDIRECT_URI);
const HAS_OPENAI = !!process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const MEDIA_PUBLIC_BASE_URL = (process.env.MEDIA_PUBLIC_BASE_URL || '').replace(/\/$/, '');
const FB_API = 'https://graph.facebook.com/v18.0';

console.log(`[config] sms=${HAS_TWILIO ? 'REAL(twilio)' : 'DEMO'} fb=${HAS_FB ? 'REAL(meta)' : 'DEMO'} ai=${HAS_OPENAI ? 'REAL(openai)' : 'DEMO'}`);

// ── Middleware ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(cookieSession({
  name: 'bu_session',
  keys: [SESSION_SECRET],
  maxAge: 7 * 24 * 3600 * 1000, // 7 days
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.COOKIE_SECURE === '1',
}));

const now = () => new Date().toISOString();

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Not logged in. Please verify your phone number.' });
  }
  next();
}

function logActivity(userId, action, detail = '') {
  try {
    db.prepare('INSERT INTO activity_log (user_id, action, detail, created_at) VALUES (?,?,?,?)')
      .run(userId, action, String(detail).slice(0, 500), now());
  } catch (e) { console.error('[activity]', e.message); }
}

// Simple in-memory OTP rate limiting: 5 requests / 10 min per phone.
const otpRate = new Map();
function otpRateOk(phone) {
  const t = Date.now();
  const e = otpRate.get(phone);
  if (!e || t > e.resetAt) { otpRate.set(phone, { count: 1, resetAt: t + 10 * 60 * 1000 }); return true; }
  if (e.count >= 5) return false;
  e.count += 1;
  return true;
}

const validPhone = (p) => typeof p === 'string' && /^\+?[0-9]{10,15}$/.test(p.trim());

// ── Twilio Verify (real path, env-gated) ───────────────────────────────────
async function twilioSend(phone) {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN, svc = process.env.TWILIO_VERIFY_SERVICE_SID;
  const r = await fetch(`https://verify.twilio.com/v2/Services/${svc}/Verifications`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: phone, Channel: 'sms' }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message || 'Twilio could not send the SMS.');
}
async function twilioCheck(phone, code) {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN, svc = process.env.TWILIO_VERIFY_SERVICE_SID;
  const r = await fetch(`https://verify.twilio.com/v2/Services/${svc}/VerificationCheck`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${tok}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: phone, Code: code }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.message || 'Twilio could not verify the code.');
  return d.status === 'approved';
}

// ── Auth API ──────────────────────────────────────────────────────────────
app.post('/api/auth/request-otp', (req, res) => {
  const phone = (req.body.phone || '').trim();
  if (!validPhone(phone)) return res.status(400).json({ error: 'Enter a valid mobile number (10-15 digits, may start with +).' });
  if (!otpRateOk(phone)) return res.status(429).json({ error: 'Too many requests. Please wait 10 minutes and try again.' });

  if (HAS_TWILIO) {
    twilioSend(phone)
      .then(() => { logActivity(null, 'otp_requested', 'real sms'); res.json({ ok: true, demo: false }); })
      .catch((e) => res.status(502).json({ error: 'SMS provider error: ' + e.message }));
    return;
  }
  // DEMO mode: generate code locally, show it on screen (clearly labeled).
  const code = String(crypto.randomInt(100000, 1000000));
  db.prepare('DELETE FROM otp_codes WHERE phone=?').run(phone);
  db.prepare('INSERT INTO otp_codes (phone, code, created_at, expires_at) VALUES (?,?,?,?)')
    .run(phone, code, now(), new Date(Date.now() + 5 * 60 * 1000).toISOString());
  logActivity(null, 'otp_requested', 'demo');
  res.json({ ok: true, demo: true, code, note: 'DEMO MODE - no SMS sent. In production this code is delivered by Twilio Verify.' });
});

app.post('/api/auth/verify-otp', (req, res) => {
  const phone = (req.body.phone || '').trim();
  const code = (req.body.code || '').trim();
  if (!validPhone(phone) || !/^\d{4,8}$/.test(code)) {
    return res.status(400).json({ error: 'Enter the 6-digit code we sent.' });
  }
  const finishLogin = () => {
    let user = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
    if (!user) {
      const r = db.prepare('INSERT INTO users (phone, created_at, last_login) VALUES (?,?,?)').run(phone, now(), now());
      user = db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid);
    } else {
      db.prepare('UPDATE users SET last_login=? WHERE id=?').run(now(), user.id);
    }
    req.session.userId = user.id;
    logActivity(user.id, 'login', HAS_TWILIO ? 'otp (twilio)' : 'otp (demo)');
    res.json({ ok: true, phone: user.phone });
  };

  if (HAS_TWILIO) {
    twilioCheck(phone, code)
      .then((ok) => ok ? finishLogin() : res.status(400).json({ error: 'Wrong code. Please try again.' }))
      .catch((e) => res.status(502).json({ error: 'Verification service error: ' + e.message }));
    return;
  }
  const row = db.prepare('SELECT * FROM otp_codes WHERE phone=?').get(phone);
  if (!row) return res.status(400).json({ error: 'No code requested for this number. Request a new one.' });
  if (new Date(row.expires_at) < new Date()) return res.status(400).json({ error: 'Code expired. Request a new one.' });
  if (row.attempts >= 5) return res.status(400).json({ error: 'Too many wrong attempts. Request a new code.' });
  if (row.code !== code) {
    db.prepare('UPDATE otp_codes SET attempts=attempts+1 WHERE id=?').run(row.id);
    return res.status(400).json({ error: 'Wrong code. Please try again.' });
  }
  db.prepare('DELETE FROM otp_codes WHERE phone=?').run(phone);
  finishLogin();
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  logActivity(req.session.userId, 'logout', '');
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session || !req.session.userId) return res.json({ loggedIn: false });
  const u = db.prepare('SELECT id, phone, created_at FROM users WHERE id=?').get(req.session.userId);
  res.json({ loggedIn: true, user: u, demo: { sms: !HAS_TWILIO, fb: !HAS_FB, ai: !HAS_OPENAI } });
});

app.get('/api/config', (req, res) => {
  res.json({ demo: { sms: !HAS_TWILIO, fb: !HAS_FB, ai: !HAS_OPENAI } });
});

// ── Facebook: OAuth connect (real path, env-gated) ─────────────────────────
const FB_SCOPES = 'pages_show_list,pages_read_engagement,pages_manage_posts';

app.get('/api/facebook/auth-url', requireAuth, (req, res) => {
  if (!HAS_FB) return res.json({ demo: true });
  const state = crypto.randomBytes(16).toString('hex');
  req.session.fb_state = state;
  // "Facebook Login for Business" apps reject a plain scope list: the dialog
  // must reference a Login Configuration via config_id instead.
  const params = {
    client_id: process.env.FB_APP_ID,
    redirect_uri: process.env.FB_REDIRECT_URI,
    response_type: 'code',
    state,
  };
  if (process.env.FB_CONFIG_ID) params.config_id = process.env.FB_CONFIG_ID;
  else params.scope = FB_SCOPES;
  const url = 'https://www.facebook.com/v18.0/dialog/oauth?' + new URLSearchParams(params).toString();
  res.json({ url });
});

// Wrap async routes so a thrown error returns 500 instead of crashing the process
// (Express 4 does not catch rejections from async handlers on its own).
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/api/facebook/callback', ah(async (req, res) => {
  const userId = req.session && req.session.userId;
  if (!userId) return res.redirect('/#login');
  const { code, state, error_description } = req.query;
  if (error_description) return res.redirect('/#pages?fb_error=' + encodeURIComponent(error_description));
  if (!code) return res.redirect('/#pages?fb_error=' + encodeURIComponent('No authorization code returned.'));
  if (!state || state !== req.session.fb_state) return res.redirect('/#pages?fb_error=' + encodeURIComponent('Security check failed (state mismatch). Please try again.'));
  req.session.fb_state = null;

  try {
    // 1. Exchange code for a short-lived user token (server-side only).
    const tq = new URLSearchParams({
      client_id: process.env.FB_APP_ID,
      client_secret: process.env.FB_APP_SECRET,
      redirect_uri: process.env.FB_REDIRECT_URI,
      code: String(code),
    });
    let r = await fetch(`${FB_API}/oauth/access_token?${tq}`);
    let tok = await r.json();
    if (!tok.access_token) throw new Error((tok.error && tok.error.message) || 'Token exchange failed.');

    // 2. Upgrade to a long-lived token (~60 days).
    const lq = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: process.env.FB_APP_ID,
      client_secret: process.env.FB_APP_SECRET,
      fb_exchange_token: tok.access_token,
    });
    r = await fetch(`${FB_API}/oauth/access_token?${lq}`);
    const ll = await r.json();
    const userToken = ll.access_token || tok.access_token;
    const expiresIn = ll.expires_in || 3600;

    // 3. Who is this user?
    r = await fetch(`${FB_API}/me?fields=id,name&access_token=${encodeURIComponent(userToken)}`);
    const me = await r.json();
    if (me.error) throw new Error(me.error.message);

    // 4. Which Pages can they manage?
    r = await fetch(`${FB_API}/me/accounts?fields=id,name,access_token,picture{url},tasks&limit=100&access_token=${encodeURIComponent(userToken)}`);
    const accs = await r.json();
    if (accs.error) throw new Error(accs.error.message);

    const expAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    // Clean slate for THIS Facebook account: remove its old Page/account rows so
    // reconnecting never creates duplicate entries. Other Facebook IDs are kept.
    db.prepare(`DELETE FROM fb_pages WHERE user_id=? AND is_demo=0 AND account_id IN
                (SELECT id FROM fb_accounts WHERE user_id=? AND fb_user_id=? AND is_demo=0)`)
      .run(userId, userId, me.id);
    db.prepare('DELETE FROM fb_accounts WHERE user_id=? AND fb_user_id=? AND is_demo=0')
      .run(userId, me.id);
    const a = db.prepare(`INSERT INTO fb_accounts (user_id, fb_user_id, name, access_token, token_expires_at, is_demo, created_at)
                          VALUES (?,?,?,?,?,0,?)`)
      .run(userId, me.id, me.name, userToken, expAt, now());
    const ins = db.prepare(`INSERT INTO fb_pages (user_id, account_id, page_id, name, picture_url, access_token, perms, status, is_demo, created_at)
                            VALUES (?,?,?,?,?,?,?,?,0,?)`);
    let n = 0;
    for (const p of (accs.data || [])) {
      ins.run(userId, a.lastInsertRowid, p.id, p.name, (p.picture && p.picture.data && p.picture.data.url) || null,
        p.access_token, JSON.stringify(p.tasks || []), 'connected', now());
      n++;
    }
    logActivity(userId, 'fb_connect', `${me.name}: ${n} page(s)`);
    res.redirect('/#pages?fb_connected=' + n);
  } catch (e) {
    logActivity(userId, 'fb_connect_failed', e.message);
    res.redirect('/#pages?fb_error=' + encodeURIComponent(e.message));
  }
}));

// DEMO mode: two mock Pages, unmistakably labeled.
app.post('/api/facebook/demo-connect', requireAuth, (req, res) => {
  if (HAS_FB) return res.status(400).json({ error: 'Real Facebook is configured - use "Connect with Facebook" instead.' });
  const userId = req.session.userId;
  db.prepare('DELETE FROM fb_pages WHERE user_id=? AND is_demo=1').run(userId);
  db.prepare('DELETE FROM fb_accounts WHERE user_id=? AND is_demo=1').run(userId);
  const a = db.prepare(`INSERT INTO fb_accounts (user_id, fb_user_id, name, access_token, is_demo, created_at)
                        VALUES (?,?,?,NULL,1,?)`).run(userId, 'demo-user', 'Demo User', now());
  const perms = JSON.stringify(FB_SCOPES.split(','));
  const ins = db.prepare(`INSERT INTO fb_pages (user_id, account_id, page_id, name, picture_url, access_token, perms, status, is_demo, created_at)
                          VALUES (?,?,?,?,NULL,NULL,?,'connected',1,?)`);
  ins.run(userId, a.lastInsertRowid, 'demo-page-1', 'Booster Demo Shop', perms, now());
  ins.run(userId, a.lastInsertRowid, 'demo-page-2', 'Booster Demo Cafe', perms, now());
  logActivity(userId, 'fb_connect', 'demo: 2 mock pages');
  res.json({ ok: true, pages: 2 });
});

function pageStatus(p) {
  if (p.status === 'disconnected') return 'disconnected';
  if (!p.is_demo && p.token_expires_at && new Date(p.token_expires_at) < new Date()) return 'expired';
  return 'connected';
}

app.get('/api/pages', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM fb_pages WHERE user_id=? ORDER BY created_at DESC').all(req.session.userId);
  // Deduplicate: each Facebook Page appears ONCE (latest record wins), so a
  // disconnected Page shows as a single "DISCONNECTED" entry, not repeats.
  const seen = new Set();
  const pages = [];
  for (const p of rows) {
    if (seen.has(p.page_id)) continue;
    seen.add(p.page_id);
    pages.push({
      id: p.id, page_id: p.page_id, name: p.name, picture_url: p.picture_url,
      perms: JSON.parse(p.perms || '[]'), status: pageStatus(p),
      is_demo: !!p.is_demo, connected_at: p.created_at,
    });
  }
  res.json({ demo: !HAS_FB, pages });
});

// Pages Feed: recent posts from the user's connected real Pages (read via Graph API).
// If a Page token is stale (missing a permission the user token has), refresh all
// Page tokens for that account via /me/accounts and retry once.
async function refreshPageTokens(accountId, userToken) {
  const r = await fetch(`${FB_API}/me/accounts?fields=id,access_token&limit=100&access_token=${encodeURIComponent(userToken)}`);
  const d = await r.json();
  if (d.error) throw new Error(d.error.message);
  const upd = db.prepare('UPDATE fb_pages SET access_token=? WHERE account_id=? AND page_id=?');
  let n = 0;
  for (const p of (d.data || [])) {
    if (p.access_token) { upd.run(p.access_token, accountId, p.id); n++; }
  }
  return n;
}
app.get('/api/pages/feed', requireAuth, ah(async (req, res) => {
  const userId = req.session.userId;
  const seenIds = new Set();
  const pages = db.prepare('SELECT * FROM fb_pages WHERE user_id=? AND is_demo=0 ORDER BY created_at DESC').all(userId)
    .filter((p) => { if (seenIds.has(p.page_id)) return false; seenIds.add(p.page_id); return pageStatus(p) === 'connected'; });
  const all = [];
  const errors = [];
  for (const p of pages) {
    // NOTE: read posts with the USER token (it carries pages_read_engagement);
    // Page tokens issued via /me/accounts were not inheriting it.
    const acc = db.prepare('SELECT access_token FROM fb_accounts WHERE id = ?').get(p.account_id);
    const userToken = acc ? acc.access_token : p.access_token;
    const fetchPosts = async (tok) => {
      const q = new URLSearchParams({
        fields: 'id,message,created_time,full_picture,permalink_url,likes.summary(true),comments.summary(true)',
        limit: '8',
        access_token: tok,
      });
      const d = await graphCall(`${FB_API}/${p.page_id}/posts?${q}`);
      for (const post of (d.data || [])) {
        all.push({
          id: post.id,
          page_name: p.name,
          message: post.message || '',
          created_time: post.created_time,
          full_picture: post.full_picture || null,
          permalink_url: post.permalink_url || null,
          likes: post.likes && post.likes.summary ? post.likes.summary.total_count : 0,
          comments: post.comments && post.comments.summary ? post.comments.summary.total_count : 0,
        });
      }
    };
    try {
      await fetchPosts(userToken);
    } catch (e) {
      // If the user token also fails, try refreshing Page tokens and retry with a fresh Page token.
      let retried = false;
      if (String(e.message).includes('(#10)')) {
        try {
          await refreshPageTokens(p.account_id, userToken);
          const fresh = db.prepare('SELECT access_token FROM fb_pages WHERE id = ?').get(p.id);
          await fetchPosts(fresh.access_token);
          retried = true;
        } catch (e3) { e = e3; }
      }
      if (retried) continue;
      // Diagnostic: list which permissions the USER token actually carries.
      // NOTE: /me/permissions must use the user token, not the Page token.
      let granted = '';
      try {
        const acc = db.prepare('SELECT access_token FROM fb_accounts WHERE id = ?').get(p.account_id);
        const perms = await graphCall(`${FB_API}/me/permissions?access_token=${encodeURIComponent(acc.access_token)}`);
        granted = ' [user-token has: ' + ((perms.data || []).filter((x) => x.status === 'granted').map((x) => x.permission).join(', ') || 'nothing') + ']';
      } catch (e2) { granted = ' [perm-check failed: ' + String(e2.message).split(' Refer to')[0] + ']'; }
      errors.push(p.name + ': ' + String(e.message).split(' Refer to')[0] + granted);
    }
  }
  all.sort((a, b) => new Date(b.created_time) - new Date(a.created_time));
  res.json({ posts: all.slice(0, 40), errors });
}));

app.post('/api/pages/:id/disconnect', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM fb_pages WHERE id=? AND user_id=?').get(req.params.id, req.session.userId);
  if (!p) return res.status(404).json({ error: 'Page not found.' });
  // Log only on a real change — no repeated connect/disconnect spam in Activity.
  if (p.status !== 'disconnected') {
    db.prepare("UPDATE fb_pages SET status='disconnected' WHERE id=?").run(p.id);
    logActivity(req.session.userId, 'fb_disconnect', p.name);
  }
  res.json({ ok: true });
});

// ── Gallery Room: media library ────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const d = path.join(UPLOADS_DIR, String(req.session.userId));
    fs.mkdirSync(d, { recursive: true });
    cb(null, d);
  },
  filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()),
});
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('Only image and video files are allowed.'));
  },
});

app.post('/api/media', requireAuth, (req, res) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    let meta = [];
    try { meta = JSON.parse(req.body.meta || '[]'); } catch (e) { /* ignore */ }
    const folder = (req.body.folder || 'All').slice(0, 60);
    const ins = db.prepare(`INSERT INTO media (user_id, filename, original_name, mime, size, duration, folder, status, created_at)
                            VALUES (?,?,?,?,?,?,?,?,?)`);
    const out = (req.files || []).map((f, i) => {
      const m = meta[i] || {};
      const r = ins.run(req.session.userId, f.filename, f.originalname, f.mimetype, f.size,
        m.duration || null, folder, 'ready', now());
      return { id: r.lastInsertRowid, filename: f.filename, original_name: f.originalname, mime: f.mimetype, size: f.size, duration: m.duration || null, folder, status: 'ready', created_at: now() };
    });
    logActivity(req.session.userId, 'media_upload', `${out.length} file(s)`);
    res.json({ files: out });
  });
});

app.get('/api/media', requireAuth, (req, res) => {
  const { search = '', folder = '' } = req.query;
  let sql = 'SELECT * FROM media WHERE user_id=?';
  const args = [req.session.userId];
  if (folder && folder !== 'All') { sql += ' AND folder=?'; args.push(folder); }
  if (search) { sql += ' AND original_name LIKE ?'; args.push(`%${search}%`); }
  sql += ' ORDER BY created_at DESC';
  res.json({ files: db.prepare(sql).all(...args) });
});

app.get('/api/media/folders', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT DISTINCT folder FROM media WHERE user_id=? ORDER BY folder').all(req.session.userId);
  res.json({ folders: ['All', ...rows.map((r) => r.folder).filter((f) => f !== 'All')] });
});

app.put('/api/media/:id', requireAuth, (req, res) => {
  const m = db.prepare('SELECT * FROM media WHERE id=? AND user_id=?').get(req.params.id, req.session.userId);
  if (!m) return res.status(404).json({ error: 'File not found.' });
  const name = (req.body.original_name || m.original_name).slice(0, 200);
  const folder = (req.body.folder || m.folder).slice(0, 60);
  db.prepare('UPDATE media SET original_name=?, folder=? WHERE id=?').run(name, folder, m.id);
  logActivity(req.session.userId, 'media_rename', name);
  res.json({ ok: true });
});

app.delete('/api/media/:id', requireAuth, (req, res) => {
  const m = db.prepare('SELECT * FROM media WHERE id=? AND user_id=?').get(req.params.id, req.session.userId);
  if (!m) return res.status(404).json({ error: 'File not found.' });
  try { fs.unlinkSync(path.join(UPLOADS_DIR, String(req.session.userId), m.filename)); } catch (e) { /* already gone */ }
  db.prepare('DELETE FROM media WHERE id=?').run(m.id);
  logActivity(req.session.userId, 'media_delete', m.original_name);
  res.json({ ok: true });
});

// ── AI Assistant ──────────────────────────────────────────────────────────
function demoCaptions(language, tone, topic) {
  const t = tone.toLowerCase();
  const openers = { friendly: 'Hey friends!', professional: 'We are pleased to share', funny: 'Warning: extremely good stuff ahead', promotional: 'LIMITED OFFER' };
  const closers = { friendly: 'Tag someone who needs this!', professional: 'Message us to learn more.', funny: 'You are welcome.', promotional: 'Order now before it is gone!' };
  const o = openers[t] || openers.friendly, c = closers[t] || closers.friendly;
  const tags = '#BoosterUstad #NewPost #MustSee';
  if (language === 'Urdu') {
    return [
      `${o}\n${topic} - اب دستیاب ہے! معیار اور اعتماد کے ساتھ۔\n${c}\n${tags}`,
      `کیا آپ نے سنا؟ ${topic} اب یہاں ہے!\nآج ہی رابطہ کریں اور فائدہ اٹھائیں۔\n${tags}`,
      `${topic} کے بارے میں سب کچھ - ایک پوسٹ میں!\nپسند کریں، شیئر کریں اور فالو کریں۔\n${tags}`,
    ];
  }
  if (language === 'Roman Urdu') {
    return [
      `${o}\n${topic} - ab dastiyab hai! Quality aur bharosa ke saath.\n${c}\n${tags}`,
      `Suna aap ne? ${topic} ab yahan hai!\nAaj hi rabta karein aur faida uthayein.\n${tags}`,
      `${topic} ke baare mein sab kuch - ek post mein!\nLike karein, share karein aur follow karein.\n${tags}`,
    ];
  }
  return [
    `${o}\n${topic} - now available! Quality you can trust.\n${c}\n${tags}`,
    `Have you heard? ${topic} is here!\nGet in touch today and do not miss out.\n${tags}`,
    `Everything about ${topic} - in one post!\nLike, share and follow for more.\n${tags}`,
  ];
}

app.post('/api/ai/generate', requireAuth, ah(async (req, res) => {
  const language = ['English', 'Urdu', 'Roman Urdu'].includes(req.body.language) ? req.body.language : 'English';
  const tone = ['Friendly', 'Professional', 'Funny', 'Promotional'].includes(req.body.tone) ? req.body.tone : 'Friendly';
  const topic = (req.body.topic || '').trim().slice(0, 500);
  if (!topic) return res.status(400).json({ error: 'Please describe what the post is about.' });

  if (!HAS_OPENAI) {
    logActivity(req.session.userId, 'ai_generate', `demo (${language}/${tone})`);
    return res.json({
      demo: true,
      captions: demoCaptions(language, tone, topic),
      setup: 'DEMO MODE - connect a real AI: add OPENAI_API_KEY to your .env (see docs/SETUP.md).',
    });
  }
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.8,
        max_tokens: 500,
        messages: [
          { role: 'system', content: 'You write short, engaging Facebook captions. Return 3 numbered captions, each 1-3 lines with a few relevant hashtags. No extra commentary.' },
          { role: 'user', content: `Write 3 ${tone.toLowerCase()} Facebook captions in ${language} about: ${topic}` },
        ],
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((d.error && d.error.message) || `OpenAI API error (${r.status}).`);
    const text = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
    const captions = text.split(/\n\s*\n|\n/).map((s) => s.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean).slice(0, 5);
    if (!captions.length) throw new Error('The AI returned an empty response.');
    logActivity(req.session.userId, 'ai_generate', `openai (${language}/${tone})`);
    res.json({ captions });
  } catch (e) {
    logActivity(req.session.userId, 'ai_generate_failed', e.message);
    res.status(502).json({ error: 'AI request failed: ' + e.message });
  }
}));

app.get('/api/captions', requireAuth, (req, res) => {
  res.json({ captions: db.prepare('SELECT * FROM captions WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(req.session.userId) });
});
app.post('/api/captions', requireAuth, (req, res) => {
  const text = (req.body.text || '').trim().slice(0, 2000);
  if (!text) return res.status(400).json({ error: 'Caption is empty.' });
  const r = db.prepare('INSERT INTO captions (user_id, text, language, tone, created_at) VALUES (?,?,?,?,?)')
    .run(req.session.userId, text, req.body.language || '', req.body.tone || '', now());
  logActivity(req.session.userId, 'caption_save', text.slice(0, 60));
  res.json({ ok: true, id: r.lastInsertRowid });
});
app.delete('/api/captions/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM captions WHERE id=? AND user_id=?').run(req.params.id, req.session.userId);
  res.json({ ok: true });
});

// ── Publishing ────────────────────────────────────────────────────────────
async function graphCall(url, opts = {}) {
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error) {
    const err = new Error((d.error && d.error.message) || `Facebook API error (${r.status}).`);
    err.code = d.error && d.error.code;
    throw err;
  }
  return d;
}

// Real publish path. Throws on any failure — success is only reported when
// the Graph API confirms it with an ID.
async function publishToFacebook(page, caption, mediaRows, userId) {
  const token = page.access_token;
  const images = mediaRows.filter((m) => m.mime.startsWith('image/'));
  const videos = mediaRows.filter((m) => m.mime.startsWith('video/'));
  if (!images.length && !videos.length) throw new Error('No supported media selected.');
  if (videos.length > 1) throw new Error('The Graph API publishes one video per post. Select a single video.');
  if (images.length && videos.length) throw new Error('Please publish photos and videos as separate posts.');

  if (videos.length) {
    const v = videos[0];
    const buf = fs.readFileSync(path.join(UPLOADS_DIR, String(userId), v.filename));
    const form = new FormData();
    form.append('access_token', token);
    form.append('description', caption);
    form.append('file_upload', new Blob([buf], { type: v.mime }), v.original_name);
    const d = await graphCall(`https://graph-video.facebook.com/v18.0/${page.page_id}/videos`, { method: 'POST', body: form });
    return d.id;
  }

  // Upload each photo's bytes directly (multipart, unpublished), then publish one feed post
  // with attached_media. Direct byte upload works from localhost — no public URL needed.
  // (MEDIA_PUBLIC_BASE_URL is still supported for hosted deployments; see docs/SETUP.md.)
  const ids = [];
  for (const img of images) {
    const buf = fs.readFileSync(path.join(UPLOADS_DIR, String(userId), img.filename));
    const form = new FormData();
    form.append('access_token', token);
    form.append('published', 'false');
    form.append('source', new Blob([buf], { type: img.mime }), img.original_name);
    const d = await graphCall(`${FB_API}/${page.page_id}/photos`, { method: 'POST', body: form });
    ids.push(d.id);
  }
  const d = await graphCall(`${FB_API}/${page.page_id}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: caption,
      attached_media: ids.map((id) => ({ media_fbid: id })),
      access_token: token,
    }),
  });
  return d.id;
}

app.post('/api/publish', requireAuth, ah(async (req, res) => {
  const userId = req.session.userId;
  const { page_id, caption = '', media_ids = [] } = req.body;
  if (!page_id) return res.status(400).json({ error: 'Please select a Facebook Page first.' });
  const page = db.prepare('SELECT * FROM fb_pages WHERE id=? AND user_id=?').get(page_id, userId);
  if (!page) return res.status(404).json({ error: 'Page not found.' });
  const st = pageStatus(page);
  if (st !== 'connected') {
    return res.status(400).json({ error: st === 'expired'
      ? 'This Page\u2019s Facebook permission has expired. Please reconnect it.'
      : 'This Page is disconnected. Please reconnect it before publishing.' });
  }
  if (!Array.isArray(media_ids) || !media_ids.length) return res.status(400).json({ error: 'Select at least one photo or video from the Gallery.' });

  const placeholders = media_ids.map(() => '?').join(',');
  const mediaRows = db.prepare(`SELECT * FROM media WHERE id IN (${placeholders}) AND user_id=?`).all(...media_ids, userId);
  if (!mediaRows.length) return res.status(400).json({ error: 'Selected media was not found.' });

  const postRow = db.prepare(`INSERT INTO posts (user_id, page_id, page_name, caption, media_ids, status, created_at)
                              VALUES (?,?,?,?,?,'publishing',?)`)
    .run(userId, page.id, page.name, caption.slice(0, 2000), JSON.stringify(mediaRows.map((m) => m.id)), now());
  const postId = postRow.lastInsertRowid;

  // DEMO path: clearly labeled, never claims a real publish.
  if (page.is_demo) {
    await new Promise((r) => setTimeout(r, 1200));
    db.prepare("UPDATE posts SET status='published_demo' WHERE id=?").run(postId);
    logActivity(userId, 'publish', `demo -> ${page.name} (${mediaRows.length} file(s))`);
    return res.json({ ok: true, demo: true, post_id: postId, message: 'DEMO - saved to history only. Not actually published to Facebook.' });
  }

  // REAL path: success only when the Graph API confirms it.
  try {
    const fbPostId = await publishToFacebook(page, caption.slice(0, 2000), mediaRows, userId);
    db.prepare("UPDATE posts SET status='published', fb_post_id=? WHERE id=?").run(fbPostId, postId);
    logActivity(userId, 'publish', `real -> ${page.name} (fb:${fbPostId})`);
    res.json({ ok: true, post_id: postId, fb_post_id: fbPostId, message: 'Published to Facebook successfully.' });
  } catch (e) {
    if (e.code === 190) db.prepare("UPDATE fb_pages SET status='expired' WHERE id=?").run(page.id);
    db.prepare('UPDATE posts SET status=?, error=? WHERE id=?').run('failed', e.message.slice(0, 500), postId);
    logActivity(userId, 'publish_failed', e.message.slice(0, 200));
    res.status(502).json({ ok: false, post_id: postId, error: 'Publishing failed: ' + e.message });
  }
}));

app.post('/api/publish/:id/retry', requireAuth, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id=? AND user_id=?').get(req.params.id, req.session.userId);
  if (!p) return res.status(404).json({ error: 'Post not found.' });
  if (p.status !== 'failed') return res.status(400).json({ error: 'Only failed posts can be retried.' });
  res.json({ ok: true, retry: { page_id: p.page_id, caption: p.caption, media_ids: JSON.parse(p.media_ids || '[]') } });
});

// ── Dashboard & history ───────────────────────────────────────────────────
app.get('/api/dashboard', requireAuth, (req, res) => {
  const u = req.session.userId;
  const accounts = db.prepare('SELECT COUNT(*) c FROM fb_accounts WHERE user_id=?').get(u).c;
  const pages = db.prepare("SELECT COUNT(*) c FROM fb_pages WHERE user_id=? AND status='connected'").get(u).c;
  const mediaCount = db.prepare('SELECT COUNT(*) c FROM media WHERE user_id=?').get(u).c;
  const recentPosts = db.prepare('SELECT * FROM posts WHERE user_id=? ORDER BY created_at DESC LIMIT 5').all(u);
  const lastPost = db.prepare('SELECT status, created_at FROM posts WHERE user_id=? ORDER BY created_at DESC LIMIT 1').get(u);
  const activity = db.prepare('SELECT action, detail, created_at FROM activity_log WHERE user_id=? ORDER BY created_at DESC LIMIT 8').all(u);
  res.json({ accounts, pages, mediaCount, recentPosts, lastPublish: lastPost || null, activity, demo: { sms: !HAS_TWILIO, fb: !HAS_FB, ai: !HAS_OPENAI } });
});

app.get('/api/history', requireAuth, (req, res) => {
  const u = req.session.userId;
  const { status = '', page_id = '', date = '' } = req.query;
  let sql = 'SELECT * FROM posts WHERE user_id=?';
  const args = [u];
  if (status) { sql += ' AND status=?'; args.push(status); }
  if (page_id) { sql += ' AND page_id=?'; args.push(page_id); }
  if (date) { sql += ' AND date(created_at)=date(?)'; args.push(date); }
  sql += ' ORDER BY created_at DESC LIMIT 200';
  res.json({ posts: db.prepare(sql).all(...args) });
});

app.get('/api/activity', requireAuth, (req, res) => {
  res.json({ activity: db.prepare('SELECT action, detail, created_at FROM activity_log WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(req.session.userId) });
});

// ── Static files ──────────────────────────────────────────────────────────
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
  console.error('[error]', err.message);
  res.status(500).json({ error: 'Server error: ' + err.message });
});

app.listen(PORT, () => console.log(`[booster-ustad] listening on http://localhost:${PORT}`));
