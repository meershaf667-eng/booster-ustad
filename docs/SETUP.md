# Booster Ustad — Setup Guide

This guide takes the app from **DEMO mode** (works immediately, no accounts
needed) to **production** (real SMS login, real Facebook Pages, real AI).

Every integration is already coded in `server.js` and gated on environment
variables — there is no fake success in production paths: a post is only
reported as published when the Meta Graph API confirms it with an ID.

---

## 1. Environment variables

Copy `.env.example` to `.env` and fill in what you need. Anything left blank
stays in clearly-labeled DEMO mode.

| Variable | Required for | Notes |
|---|---|---|
| `PORT` | — | Default `3000`. |
| `SESSION_SECRET` | **Production** | Long random string. Signs login cookies. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `COOKIE_SECURE` | HTTPS deploys | Set to `1` when serving over HTTPS. |
| `TWILIO_ACCOUNT_SID` | Real SMS OTP | From Twilio console. |
| `TWILIO_AUTH_TOKEN` | Real SMS OTP | From Twilio console. Keep secret. |
| `TWILIO_VERIFY_SERVICE_SID` | Real SMS OTP | Create a Verify Service (see §2). Starts with `VA...`. |
| `FB_APP_ID` | Real Facebook | From Meta developer dashboard. |
| `FB_APP_SECRET` | Real Facebook | Keep secret — only used server-side in `server.js`. |
| `FB_REDIRECT_URI` | Real Facebook | Must exactly match the OAuth redirect you register, e.g. `https://your-domain.com/api/facebook/callback`. |
| `MEDIA_PUBLIC_BASE_URL` | Real photo posts | Public base URL of this server, e.g. `https://your-domain.com`. Meta's servers fetch photo bytes from here. Not needed for video posts (videos upload directly). |
| `OPENAI_API_KEY` | Real AI captions | From platform.openai.com. Server-side only. |
| `OPENAI_MODEL` | Real AI captions | Default `gpt-4o-mini`. |

**Never** put these in git, in the frontend, or in screenshots. `.env` is gitignored.

---

## 2. Twilio Verify (real SMS OTP)

1. Sign up at twilio.com/try-twilio and verify your own number.
2. In the console, go to **Verify → Services → Create service**; name it
   "Booster Ustad". Copy the Service SID (`VA...`).
3. Copy **Account SID** and **Auth Token** from the console dashboard.
4. Put the three values in `.env` and restart. The login screen stops showing
   the code on screen and sends a real SMS instead.
5. Notes:
   - Trial accounts can only SMS verified numbers — upgrade or verify
     recipients while testing.
   - Codes expire after 10 minutes (Twilio default); the app rate-limits
     requests to 5 per number per 10 minutes.

---

## 3. Meta / Facebook (real Page connections & publishing)

### 3.1 Create the Meta app

1. Go to developers.facebook.com → **My Apps → Create App**. Choose the
   **Business** type.
2. Add the **Facebook Login** product.
3. Under **Facebook Login → Settings**, add your OAuth redirect URI:
   `https://your-domain.com/api/facebook/callback` (must match `FB_REDIRECT_URI`
   exactly, including `https`).
4. Copy **App ID** and **App Secret** into `.env`.

### 3.2 Permissions the app requests

`server.js` requests these scopes in `/api/facebook/auth-url`:

| Permission | Why |
|---|---|
| `pages_show_list` | List Pages the user can manage. |
| `pages_read_engagement` | Read Page metadata shown in the dashboard. |
| `pages_manage_posts` | Publish photos/videos to the Page. |

These map to the `tasks` the app stores per Page and displays as
"publishing permissions" chips in the UI.

### 3.3 App review & Business verification

- In **Development mode** the app only works for users with a Role
  (Admin/Developer/Tester) on the Meta app — perfect for your own testing.
- To let the public log in, submit each permission for **App Review**
  (App Review → Permissions and Features) with a screencast showing the
  login → connect → publish flow, plus a privacy policy URL.
- `pages_manage_posts` typically requires **Business verification**.
  Expect review to take a few days; plan for it.

### 3.4 Publishing mechanics (already implemented)

- **Photos:** uploaded unpublished to `/{page-id}/photos` (Meta fetches the
  file from `MEDIA_PUBLIC_BASE_URL/uploads/...`), then published as one feed
  post with `attached_media`. Your server must be publicly reachable over
  HTTPS for this to work.
- **Videos:** uploaded directly to `graph-video.facebook.com/{page-id}/videos`
  as multipart — no public URL needed.
- One video per post; photos and videos can't be mixed in one post
  (Graph API limitation — the app enforces this).
- **Token expiry:** user tokens are exchanged for long-lived (~60 days) tokens
  and the expiry is stored. When a token expires (or the API returns OAuth
  error 190), the Page shows **EXPIRED — reconnect** and publishing is blocked
  until you reconnect. Tokens are never shown to the browser.

### 3.5 What the app deliberately does NOT do

- Never asks for or stores Facebook passwords (OAuth only).
- Never automates personal-profile actions (posting, liking, friending) —
  Meta forbids it and the app doesn't try. Personal profiles get an
  "Open Facebook in Chrome" button for manual use.
- Never bypasses Facebook login, CAPTCHA, or 2FA.

---

## 4. OpenAI (real AI captions)

1. Create an account at platform.openai.com, add billing, and create an API key.
2. Put it in `.env` as `OPENAI_API_KEY` and restart.
3. The AI Assistant screen will call the official Chat Completions API
   (default model `gpt-4o-mini`) **from the server** — the key never reaches
   the browser or the repo.
4. Without the key, the app serves labeled template captions and shows this
   setup hint in the UI.

---

## 5. Scheduling — why it's omitted

The task spec asked for scheduling only if the authorized API permits it.
Facebook supports `scheduled_publish_time` on Page posts, but it requires the
post to be created unpublished plus the same `pages_manage_posts` permission
under stricter review, and scheduled posts can't be edited the same way.
To keep the prototype honest and shippable, scheduling is **not implemented**;
everything publishes immediately after your confirmation. It can be added
later as: create unpublished post → set `scheduled_publish_time` (Unix time,
10 min–75 days out) → `published=false`.

---

## 6. Deployment

### Option A — Render (easiest)

1. Push this folder to a GitHub repo (`.env` stays out — it's gitignored).
2. Render → **New → Web Service** → connect repo. Build: `npm install`,
   Start: `npm start`. Choose Node 22+.
3. Add all `.env` values under **Environment**.
4. Set `FB_REDIRECT_URI` and `MEDIA_PUBLIC_BASE_URL` to your
   `https://<service>.onrender.com` URL, and register the redirect URI in the
   Meta app settings.
5. **Persistence warning:** Render's free disk is ephemeral — `booster.db` and
   `uploads/` reset on redeploy. For production, attach a Render Disk mounted
   at the app root (or move to Postgres/S3 later).

### Option B — Railway

Same as Render; add a **Volume** mounted at `/app` (or the workdir) so
`booster.db` and `uploads/` survive restarts.

### Option C — VPS (Ubuntu)

```bash
# Node 22+
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx
git clone <your-repo> booster-ustad && cd booster-ustad
npm install
cp .env.example .env   # fill in real values
# run under pm2 or systemd
npm i -g pm2 && pm2 start server.js --name booster-ustad && pm2 save && pm2 startup
# reverse-proxy + HTTPS
sudo certbot --nginx -d your-domain.com
```

Nginx proxy example:

```nginx
server {
  server_name your-domain.com;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
  client_max_body_size 220M;
}
```

Set `COOKIE_SECURE=1` once HTTPS works.

---

## 7. Security notes

- Secrets live only in `.env` (server process env). The frontend never sees
  tokens, API keys, or secrets.
- Login sessions are signed, `httpOnly` cookies (`SameSite=lax`), 7-day expiry,
  destroyed on logout.
- OTP: 6 digits, 5-minute expiry, 5 attempts max, rate-limited per number.
- Uploads: images/videos only, 200 MB per file, stored under random UUID
  filenames per user; original names are metadata only.
- Uploaded files are served from `/uploads` via unguessable UUID paths. For
  stricter privacy, serve them through an authenticated route or signed URLs.
- Facebook access tokens stay in SQLite on the server; the browser only sees
  Page names, pictures, and permission lists.
- Demo data is always labeled **DEMO** in the UI and stored with
  `is_demo=1` / `published_demo` status — it can never be mistaken for real
  Facebook activity.

---

## 8. Testing checklist

- [ ] `npm install && npm start`, open on phone via `http://<laptop-ip>:3000`
- [ ] Login with any 10+ digit number, use the on-screen demo code
- [ ] Pages → Connect demo Pages → see 2 DEMO pages with permissions
- [ ] Gallery → upload photo + video → thumbnails, sizes, duration badge,
      search, folders, rename, delete, multi-select
- [ ] AI → generate in English / Urdu / Roman Urdu → edit, copy, save
- [ ] Publish → pick page + media + caption → preview → confirm →
      progress → DEMO-labeled history entry
- [ ] History → filter by page / status / date; retry a failed post
- [ ] Dashboard → counts, last publish status, activity log
- [ ] "Open Facebook in Chrome" opens facebook.com (intent on Android)
- [ ] Add to Home screen from Chrome for the app-like experience
