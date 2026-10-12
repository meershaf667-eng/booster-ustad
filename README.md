# Booster Ustad

Mobile-first web app to manage multiple Facebook Pages from one dashboard:
phone-number OTP login, Facebook Page connections (official Meta OAuth),
a media **Gallery Room**, an **AI Assistant** for captions (OpenAI),
and publishing to authorized Pages. Blue-and-white theme, big touch buttons,
bottom-tab navigation — built for Android phones.

No build step. The frontend is vanilla HTML/CSS/JS in `public/`; install it to
your home screen via Chrome → **Add to Home screen**.

## Run it

```bash
npm install
npm start
# open http://localhost:3000
```

Out of the box everything runs in **clearly-labeled DEMO mode**:
OTP codes are shown on screen (no SMS), Facebook Pages are mock pages,
AI captions are templates. Nothing is ever presented as real when it is not.

## Go live

Copy `.env.example` to `.env` and fill in the sections you want to enable:

| Section | Env vars | Effect |
|---|---|---|
| SMS/OTP | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | Real SMS codes via Twilio Verify |
| Facebook | `FB_APP_ID`, `FB_APP_SECRET`, `FB_REDIRECT_URI` | Real Meta OAuth + Page publishing |
| AI | `OPENAI_API_KEY` | Real ChatGPT captions |
| Publishing | `MEDIA_PUBLIC_BASE_URL` | Public URL Meta uses to fetch photos |

Full step-by-step: **[docs/SETUP.md](docs/SETUP.md)** — Meta app creation,
required permissions & app review, Twilio setup, OpenAI key, deployment
(Render / Railway / VPS), and security notes.

## Project layout

```
booster-ustad/
  server.js        Express app + JSON API under /api
  db.js            SQLite schema (users, otp_codes, fb_accounts, fb_pages,
                   media, posts, captions, activity_log)
  public/          index.html, styles.css, app.js (mobile-first SPA)
  uploads/         uploaded media (gitignored; served at /uploads)
  docs/SETUP.md    full setup & deployment guide
  .env.example     all settings, no secrets
```

## Notes

- Uses Node's built-in `node:sqlite` (no native build needed).
- Sessions: signed httpOnly cookies, 7-day expiry. Set `SESSION_SECRET` in production.
- Scheduling is intentionally omitted: it requires extra permissions/review and is
  documented in `docs/SETUP.md`.
