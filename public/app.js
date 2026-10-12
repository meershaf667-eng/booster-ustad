/* -- Booster Ustad frontend -- vanilla JS, no build step -- */
'use strict';

const S = {
  user: null,
  demo: { sms: true, fb: true, ai: true },
  pages: [],
  media: [],
  folders: ['All'],
  selected: new Set(),
  captions: [],
  tab: 'dashboard',
  galleryFolder: 'All',
  gallerySearch: '',
  pubPageId: null,
  pubCaption: '',
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const demoBadge = () => '<span class="badge badge-demo">DEMO</span>';

function toast(msg, type) {
  type = type || '';
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('toast-root').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

async function api(path, opts) {
  opts = opts || {};
  const r = await fetch(path, {
    method: opts.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) { showLogin(); throw new Error('Session expired. Please log in again.'); }
  if (!r.ok) throw new Error(d.error || ('Request failed (' + r.status + ').'));
  return d;
}

function openModal(html) {
  $('modal-root').innerHTML = '<div class="modal-back" id="mback"><div class="modal">' + html + '</div></div>';
  $('mback').addEventListener('click', (e) => { if (e.target.id === 'mback') closeModal(); });
}
function closeModal() { $('modal-root').innerHTML = ''; }

function confirmDialog(title, body, okLabel) {
  okLabel = okLabel || 'Confirm';
  return new Promise((resolve) => {
    openModal('<h3>' + esc(title) + '</h3><p class="muted">' + body + '</p>' +
      '<button class="btn btn-primary" id="cf-ok">' + esc(okLabel) + '</button>' +
      '<button class="btn btn-ghost" id="cf-no" style="width:100%">Cancel</button>');
    $('cf-ok').onclick = () => { closeModal(); resolve(true); };
    $('cf-no').onclick = () => { closeModal(); resolve(false); };
  });
}

const fmtSize = (b) => b == null ? '' : b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
const fmtDur = (s) => s == null ? '' : Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString(); } catch (e) { return iso || ''; } };
const initials = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

function openFacebook() {
  // Official Facebook site via Android Chrome intent, with https fallback.
  const intent = 'intent://www.facebook.com#Intent;scheme=https;package=com.android.chrome;end';
  if (/Android/i.test(navigator.userAgent)) {
    window.location.href = intent;
    setTimeout(() => { if (!document.hidden) window.location.href = 'https://www.facebook.com'; }, 1800);
  } else {
    window.open('https://www.facebook.com', '_blank', 'noopener');
  }
}

function demoBanners() {
  const parts = [];
  if (S.demo.sms) parts.push('OTP');
  if (S.demo.fb) parts.push('Facebook');
  if (S.demo.ai) parts.push('AI');
  const el = $('demo-banner-app');
  if (parts.length) {
    el.classList.remove('hidden');
    el.textContent = 'DEMO MODE - ' + parts.join(' / ') + ' running on mock data. See AI tab / docs/SETUP.md to go live.';
  } else el.classList.add('hidden');
  $('demo-banner-login').classList.toggle('hidden', !S.demo.sms);
}

/* -- Views & routing -- */
function showLogin() {
  $('view-app').classList.add('hidden');
  $('view-login').classList.remove('hidden');
  $('login-step-phone').classList.remove('hidden');
  $('login-step-code').classList.add('hidden');
  if (location.hash !== '#login') history.replaceState(null, '', '#login');
}
function showApp() {
  $('view-login').classList.add('hidden');
  $('view-app').classList.remove('hidden');
  $('user-line').textContent = S.user ? 'Logged in as ' + S.user.phone : '';
  demoBanners();
  route();
}
function route() {
  const h = location.hash || '#dashboard';
  const parts = h.replace('#', '').split('?');
  const tabQ = parts[0], query = parts[1] || '';
  const tabs = ['dashboard', 'pages', 'gallery', 'ai', 'publish', 'history', 'feed'];
  const tab = tabs.includes(tabQ) ? tabQ : 'dashboard';
  // ← Back history: remember where we came from (skip when this move IS a back press)
  if (!S.backNav && S.tab && S.tab !== tab) {
    S.backStack = S.backStack || [];
    S.backStack.push(S.tab);
    if (S.backStack.length > 25) S.backStack.shift();
  }
  S.backNav = false;
  S.tab = tab;
  document.querySelectorAll('.navbtn').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab').forEach((t) => t.classList.add('hidden'));
  $('tab-' + tab).classList.remove('hidden');
  ({ dashboard: loadDashboard, pages: loadPages, gallery: loadGallery, ai: loadAI, publish: loadPublish, history: loadHistory, feed: loadFeed })[tab](query);
  updateBackBtn();
}
function updateBackBtn() {
  const b = $('btn-back');
  if (b) b.classList.toggle('hidden', !((S.backStack || []).length));
}
function goBack() {
  const prev = (S.backStack || []).pop();
  updateBackBtn();
  if (prev) { S.backNav = true; location.hash = '#' + prev; }
}
window.addEventListener('hashchange', () => { if (S.user) route(); });

/* -- Auth -- */
let pendingPhone = '';
async function requestOtp() {
  const phone = $('phone').value.trim();
  $('login-error').classList.add('hidden');
  if (!phone) { $('login-error').textContent = 'Please enter your mobile number.'; $('login-error').classList.remove('hidden'); return; }
  const btn = $('btn-request-otp');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Sending...';
  try {
    const d = await api('/api/auth/request-otp', { method: 'POST', body: { phone } });
    pendingPhone = phone;
    $('code-phone').textContent = phone;
    $('login-step-phone').classList.add('hidden');
    $('login-step-code').classList.remove('hidden');
    if (d.demo && d.code) {
      $('demo-otp-box').classList.remove('hidden');
      $('demo-otp-code').textContent = d.code;
    } else {
      $('demo-otp-box').classList.add('hidden');
      toast('Code sent by SMS.', 'ok');
    }
  } catch (e) { $('login-error').textContent = e.message; $('login-error').classList.remove('hidden'); }
  btn.disabled = false; btn.textContent = 'Send code';
}
async function verifyOtp() {
  const code = $('otp').value.trim();
  $('login-error').classList.add('hidden');
  const btn = $('btn-verify-otp');
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Verifying...';
  try {
    const d = await api('/api/auth/verify-otp', { method: 'POST', body: { phone: pendingPhone, code } });
    S.user = { phone: d.phone };
    const me = await api('/api/auth/me');
    S.demo = me.demo;
    $('otp').value = '';
    toast('Welcome to Booster Ustad!', 'ok');
    showApp();
  } catch (e) { $('login-error').textContent = e.message; $('login-error').classList.remove('hidden'); }
  btn.disabled = false; btn.textContent = 'Verify & log in';
}
async function logout() {
  if (!await confirmDialog('Log out?', 'You will need your phone number and a new code to log back in.', 'Log out')) return;
  try { await api('/api/auth/logout', { method: 'POST' }); } catch (e) { /* ignore */ }
  S.user = null; S.pages = []; S.media = []; S.selected.clear();
  showLogin();
}

/* -- Dashboard -- */
async function loadDashboard() {
  const el = $('tab-dashboard');
  el.innerHTML = '<div class="empty">Loading...</div>';
  try {
    const d = await api('/api/dashboard');
    const lp = d.lastPublish;
    const lpTxt = !lp ? 'No posts yet' : lp.status.replace('_', ' ') + ' - ' + fmtDate(lp.created_at);
    el.innerHTML =
      '<div class="card"><h2>Dashboard</h2>' +
      '<p class="muted tiny">Your control center. ' + (d.demo.fb ? demoBadge() + ' Facebook data below is mock data.' : 'Live Facebook data.') + '</p></div>' +
      '<div class="stat-grid">' +
      '<div class="stat"><div class="num">' + d.pages + '</div><div class="lbl">Connected Pages</div></div>' +
      '<div class="stat"><div class="num">' + d.mediaCount + '</div><div class="lbl">Gallery files</div></div>' +
      '<div class="stat"><div class="num">' + d.recentPosts.length + '</div><div class="lbl">Recent posts</div></div>' +
      '<div class="stat"><div class="num">' + d.accounts + '</div><div class="lbl">FB accounts</div></div></div>' +
      '<div class="menu-grid">' +
      '<button class="menu-btn" data-go="pages"><span class="navico">📘</span>Pages</button>' +
      '<button class="menu-btn" data-go="gallery"><span class="navico">🖼️</span>Gallery</button>' +
      '<button class="menu-btn" data-go="ai"><span class="navico">✨</span>AI</button>' +
      '<button class="menu-btn" data-go="publish"><span class="navico">🚀</span>Publish</button>' +
      '<button class="menu-btn" data-go="history"><span class="navico">🕘</span>History</button>' +
      '<button class="menu-btn" data-go="feed"><span class="navico">📋</span>Feed</button>' +
      '</div>' +
      '<div class="card"><h3>Publishing status</h3>' +
      '<div class="kv"><span>Last publish</span><b>' + esc(lpTxt) + '</b></div>' +
      '<button class="btn btn-primary" id="dash-publish">+ New post</button>' +
      '<button class="btn btn-outline" id="dash-chrome">Open Facebook in Chrome</button></div>' +
      '<div class="card"><h3>Recent posts</h3>' +
      (d.recentPosts.length ? d.recentPosts.map(postRow).join('') : '<p class="muted">Nothing published yet. Head to Publish to create your first post.</p>') + '</div>' +
      '<div class="card"><h3>Activity log</h3>' +
      (d.activity.length ? d.activity.map((a) =>
        '<div class="kv"><span>' + esc(actionLabel(a.action)) + '<br><span class="tiny muted">' + esc(a.detail) + '</span></span><span class="tiny muted">' + fmtDate(a.created_at) + '</span></div>'
      ).join('') : '<p class="muted">No activity yet.</p>') + '</div>';
    $('dash-publish').onclick = () => location.hash = '#publish';
    $('dash-chrome').onclick = openFacebook;
    el.querySelectorAll('[data-go]').forEach((b) => b.onclick = () => location.hash = '#' + b.dataset.go);
  } catch (e) { el.innerHTML = '<div class="alert alert-error">' + esc(e.message) + '</div>'; }
}
function actionLabel(a) {
  return { login: 'Logged in', logout: 'Logged out', otp_requested: 'OTP requested', fb_connect: 'Facebook connected', fb_disconnect: 'Page disconnected', fb_connect_failed: 'Facebook connect failed', media_upload: 'Media uploaded', media_delete: 'Media deleted', media_rename: 'Media renamed', ai_generate: 'AI captions generated', ai_generate_failed: 'AI generation failed', caption_save: 'Caption saved', publish: 'Post published', publish_failed: 'Publish failed' }[a] || a;
}
function statusBadge(st) {
  if (st === 'published') return '<span class="badge badge-ok">PUBLISHED</span>';
  if (st === 'published_demo') return '<span class="badge badge-demo">DEMO</span>';
  if (st === 'failed') return '<span class="badge badge-bad">FAILED</span>';
  return '<span class="badge badge-info">' + esc(st.toUpperCase()) + '</span>';
}
function postRow(p) {
  return '<div class="hrow"><div class="row"><b class="grow">' + esc(p.page_name || '-') + '</b>' + statusBadge(p.status) + '</div>' +
    '<div class="cap">' + esc(p.caption || '(no caption)') + '</div>' +
    '<div class="tiny muted">' + fmtDate(p.created_at) + (p.fb_post_id ? ' - FB id ' + esc(p.fb_post_id) : '') + (p.error ? ' - ' + esc(p.error) : '') + '</div></div>';
}

/* -- Pages -- */
async function loadPages(query) {
  const el = $('tab-pages');
  el.innerHTML = '<div class="empty">Loading...</div>';
  const params = new URLSearchParams(query || '');
  try {
    const d = await api('/api/pages');
    S.pages = d.pages;
    let notice = '';
    if (params.get('fb_connected')) notice = '<div class="alert alert-ok">Connected ' + esc(params.get('fb_connected')) + ' Facebook Page(s).</div>';
    if (params.get('fb_error')) notice = '<div class="alert alert-error">Facebook error: ' + esc(params.get('fb_error')) + '</div>';
    const connectBtn = d.demo
      ? '<button class="btn btn-primary" id="btn-demo-connect">Connect demo Pages ' + demoBadge() + '</button>' +
        '<p class="tiny muted">Demo mode: adds 2 mock Pages so you can try publishing. To connect real Pages, set FB_APP_ID in .env (see docs/SETUP.md).</p>'
      : '<button class="btn btn-primary" id="btn-fb-connect">Connect with Facebook</button>' +
        '<p class="tiny muted">Official Meta login. We never see or store your Facebook password.</p>';
    el.innerHTML = notice +
      '<div class="card"><h2>Facebook Pages</h2>' + connectBtn +
      '<button class="btn btn-outline" id="btn-chrome">Open Facebook in Chrome</button></div>' +
      '<div class="card"><h3>Connected Pages (' + d.pages.length + ')</h3><div id="page-list"></div></div>' +
      '<div class="card"><h3>Personal profiles</h3>' +
      '<p class="muted">Booster Ustad publishes to <b>Pages you manage</b> through Meta\'s official API. Personal profiles cannot be auto-posted by any app - Meta does not allow it.</p>' +
      '<p class="muted">To use your personal profile, open Facebook in Chrome and manage it manually:</p>' +
      '<button class="btn btn-outline" id="btn-chrome2">Open Facebook in Chrome</button>' +
      '<p class="tiny muted">We never ask for your Facebook password, and we never bypass Facebook\'s login, CAPTCHA or two-factor checks.</p></div>';
    renderPageList();
    const dc = $('btn-demo-connect'); if (dc) dc.onclick = demoConnect;
    const fc = $('btn-fb-connect'); if (fc) fc.onclick = fbConnect;
    $('btn-chrome').onclick = openFacebook; $('btn-chrome2').onclick = openFacebook;
    history.replaceState(null, '', '#pages');
  } catch (e) { el.innerHTML = '<div class="alert alert-error">' + esc(e.message) + '</div>'; }
}
function renderPageList() {
  const el = $('page-list');
  if (!el) return;
  if (!S.pages.length) { el.innerHTML = '<p class="muted">No Pages connected yet.</p>'; return; }
  el.innerHTML = S.pages.map((p) => {
    const st = p.status === 'connected' ? '<span class="badge badge-ok">CONNECTED</span>'
      : p.status === 'expired' ? '<span class="badge badge-bad">EXPIRED - reconnect</span>'
      : '<span class="badge badge-bad">DISCONNECTED</span>';
    return '<div class="list-item page-card">' +
      '<div class="avatar">' + (p.picture_url ? '<img src="' + esc(p.picture_url) + '" alt="">' : initials(p.name)) + '</div>' +
      '<div class="grow"><b>' + esc(p.name) + '</b> ' + (p.is_demo ? demoBadge() : '') + '<br>' + st +
      '<div>' + (p.perms || []).map((x) => '<span class="perm-chip">' + esc(x) + '</span>').join('') + '</div></div>' +
      (p.status === 'connected'
        ? '<button class="btn btn-primary btn-sm" data-post="' + p.id + '">🖼️ Gallery</button>' +
          '<button class="btn btn-ghost btn-sm" data-disc="' + p.id + '">Disconnect</button>'
        : '') +
      '</div>';
  }).join('');
  el.querySelectorAll('[data-disc]').forEach((b) => b.onclick = () => disconnectPage(b.dataset.disc));
  el.querySelectorAll('[data-post]').forEach((b) => b.onclick = () => postFromPage(b.dataset.post));
}
// "🖼️ Gallery" next to a Page: remember the Page, open Gallery to pick files,
// then the Publish tab already has this Page selected.
function postFromPage(id) {
  S.pubPageId = +id;
  location.hash = '#gallery';
  toast('Select files, then open the Publish tab - your Page is already chosen.');
}
async function fbConnect() {
  try {
    const d = await api('/api/facebook/auth-url');
    if (d.demo) { toast('Facebook is in demo mode - use "Connect demo Pages".'); return; }
    window.location.href = d.url; // official Meta OAuth dialog
  } catch (e) { toast(e.message, 'err'); }
}
async function demoConnect() {
  if (!await confirmDialog('Connect demo Pages?', 'This adds 2 <b>mock</b> Pages labeled DEMO so you can explore publishing. No real Facebook connection is made.', 'Connect demo')) return;
  try { await api('/api/facebook/demo-connect', { method: 'POST' }); toast('Demo Pages connected.', 'ok'); loadPages(''); }
  catch (e) { toast(e.message, 'err'); }
}
async function disconnectPage(id) {
  if (!await confirmDialog('Disconnect this Page?', 'You will not be able to publish to it until you reconnect.', 'Disconnect')) return;
  try { await api('/api/pages/' + id + '/disconnect', { method: 'POST' }); toast('Page disconnected.', 'ok'); loadPages(''); }
  catch (e) { toast(e.message, 'err'); }
}

/* -- Gallery Room -- */
async function loadGallery() {
  const el = $('tab-gallery');
  el.innerHTML = '<div class="empty">Loading...</div>';
  try {
    const f = await api('/api/media/folders');
    S.folders = f.folders;
    el.innerHTML =
      '<div class="card"><h2>Gallery Room ' + (S.demo.fb ? '' : '') + '</h2>' +
      '<p class="muted tiny">Your media library. Files are stored securely on the server. Tap a file to preview; tap the circle to select it for publishing.</p>' +
      '<button class="btn btn-primary" id="btn-upload">+ Add photos / videos</button>' +
      '<div class="progress hidden" id="gal-prog"><i></i></div></div>' +
      '<div class="toolbar"><input type="text" id="gal-search" placeholder="Search files..." value="' + esc(S.gallerySearch) + '">' +
      '<select id="gal-folder">' + S.folders.map((x) => '<option ' + (x === S.galleryFolder ? 'selected' : '') + ' value="' + esc(x) + '">' + esc(x) + '</option>').join('') + '</select></div>' +
      '<div class="toolbar"><button class="btn btn-outline btn-sm grow" id="btn-newfolder">+ New folder</button>' +
      '<button class="btn btn-outline btn-sm grow" id="btn-clear-sel">Clear selection (<span id="sel-count">' + S.selected.size + '</span>)</button>' +
      '<button class="btn btn-primary btn-sm grow" id="btn-goto-publish">→ Publish</button></div>' +
      '<div class="mgrid" id="mgrid"></div>' +
      '<div class="empty hidden" id="gal-empty">No files yet. Tap "+ Add photos / videos" to upload from your phone.</div>';
    $('btn-upload').onclick = () => $('file-picker').click();
    $('btn-newfolder').onclick = newFolder;
    $('btn-clear-sel').onclick = () => { S.selected.clear(); renderGalleryGrid(); };
    $('btn-goto-publish').onclick = () => location.hash = '#publish';
    $('gal-search').oninput = (e) => { S.gallerySearch = e.target.value; renderGalleryGrid(); };
    $('gal-folder').onchange = (e) => { S.galleryFolder = e.target.value; renderGalleryGrid(); };
    await renderGalleryGrid();
  } catch (e) { el.innerHTML = '<div class="alert alert-error">' + esc(e.message) + '</div>'; }
}

async function renderGalleryGrid() {
  const grid = $('mgrid');
  if (!grid) return;
  const q = new URLSearchParams({ search: S.gallerySearch, folder: S.galleryFolder });
  const d = await api('/api/media?' + q.toString());
  S.media = d.files;
  // drop selections that no longer exist
  const ids = new Set(d.files.map((m) => m.id));
  [...S.selected].forEach((id) => { if (!ids.has(id)) S.selected.delete(id); });
  const sc = $('sel-count'); if (sc) sc.textContent = S.selected.size;
  $('gal-empty').classList.toggle('hidden', d.files.length > 0);
  grid.innerHTML = d.files.map((m) => {
    const isV = m.mime.indexOf('video/') === 0;
    const src = '/uploads/' + S.userIdForUploads + '/' + m.filename;
    const sel = S.selected.has(m.id) ? ' sel' : '';
    return '<div class="mitem' + sel + '" data-id="' + m.id + '">' +
      '<div class="checkbadge">' + (S.selected.has(m.id) ? '&#10003;' : '') + '</div>' +
      (isV ? '<span class="durbadge">' + fmtDur(m.duration) + '</span><span class="vidmark">&#9654;</span>' : '') +
      (isV ? '<video src="' + src + '" preload="metadata" muted></video>'
           : '<img src="' + src + '" alt="" loading="lazy">') +
      '<div class="meta"><div class="nm">' + esc(m.original_name) + '</div><div class="sz">' + fmtSize(m.size) + ' · ' + esc(m.folder) + '</div></div></div>';
  }).join('');
  grid.querySelectorAll('.mitem').forEach((it) => {
    it.addEventListener('click', (e) => {
      const id = +it.dataset.id;
      // shift-free simple rule: tapping the badge area toggles selection, else preview
      if (e.target.closest('.checkbadge')) { toggleSelect(id); return; }
      previewMedia(id);
    });
  });
}
function toggleSelect(id) {
  if (S.selected.has(id)) S.selected.delete(id); else S.selected.add(id);
  renderGalleryGrid();
}
async function newFolder() {
  const name = await promptModal('New folder', 'Folder name');
  if (!name) return;
  S.galleryFolder = name.slice(0, 60);
  if (!S.folders.includes(S.galleryFolder)) S.folders.push(S.galleryFolder);
  loadGallery();
  toast('Folder "' + S.galleryFolder + '" ready. New uploads will go there.', 'ok');
}
function promptModal(title, label) {
  return new Promise((resolve) => {
    openModal('<h3>' + esc(title) + '</h3><label class="field"><span>' + esc(label) + '</span><input type="text" id="pm-in"></label>' +
      '<button class="btn btn-primary" id="pm-ok">Save</button><button class="btn btn-ghost" id="pm-no" style="width:100%">Cancel</button>');
    $('pm-ok').onclick = () => { const v = $('pm-in').value.trim(); closeModal(); resolve(v); };
    $('pm-no').onclick = () => { closeModal(); resolve(''); };
    $('pm-in').focus();
  });
}
function videoDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(v.duration || null); };
    v.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    v.src = url;
  });
}
async function handleFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const meta = [];
  for (const f of files) meta.push({ duration: f.type.indexOf('video/') === 0 ? await videoDuration(f) : null });
  const fd = new FormData();
  files.forEach((f) => fd.append('files', f));
  fd.append('meta', JSON.stringify(meta));
  fd.append('folder', S.galleryFolder === 'All' ? 'All' : S.galleryFolder);
  openModal('<h3>Uploading ' + files.length + ' file(s)...</h3><div class="progress"><i id="up-bar"></i></div><p class="muted tiny" id="up-txt">0%</p>');
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/media');
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) { const p = Math.round(e.loaded / e.total * 100); const b = $('up-bar'); if (b) b.style.width = p + '%'; const t = $('up-txt'); if (t) t.textContent = p + '%'; }
  };
  xhr.onload = () => {
    closeModal();
    if (xhr.status === 200) { const d = JSON.parse(xhr.responseText); toast(d.files.length + ' file(s) uploaded.', 'ok'); loadGallery(); }
    else { let m = 'Upload failed.'; try { m = JSON.parse(xhr.responseText).error || m; } catch (e) {} toast(m, 'err'); }
  };
  xhr.onerror = () => { closeModal(); toast('Network error during upload. Check your connection and retry.', 'err'); };
  xhr.send(fd);
}
function previewMedia(id) {
  const m = S.media.find((x) => x.id === id);
  if (!m) return;
  const isV = m.mime.indexOf('video/') === 0;
  const src = '/uploads/' + S.userIdForUploads + '/' + m.filename;
  const folderOpts = S.folders.map((x) => '<option ' + (x === m.folder ? 'selected' : '') + ' value="' + esc(x) + '">' + esc(x) + '</option>').join('');
  openModal('<h3>Preview</h3>' +
    (isV ? '<video class="preview-full" src="' + src + '" controls playsinline></video>' : '<img class="preview-full" src="' + src + '" alt="">') +
    '<div class="kv"><span>File</span><b>' + esc(m.original_name) + '</b></div>' +
    '<div class="kv"><span>Size</span><b>' + fmtSize(m.size) + '</b></div>' +
    (isV ? '<div class="kv"><span>Duration</span><b>' + fmtDur(m.duration) + '</b></div>' : '') +
    '<label class="field"><span>Rename</span><input type="text" id="pv-name" value="' + esc(m.original_name) + '"></label>' +
    '<label class="field"><span>Folder</span><select id="pv-folder">' + folderOpts + '</select></label>' +
    '<button class="btn btn-primary" id="pv-save">Save changes</button>' +
    '<button class="btn btn-outline" id="pv-select">' + (S.selected.has(m.id) ? 'Remove from publish selection' : 'Select for publishing') + '</button>' +
    '<button class="btn btn-danger" id="pv-del">Delete file</button>' +
    '<button class="btn btn-ghost" id="pv-close" style="width:100%">Close</button>');
  $('pv-close').onclick = closeModal;
  $('pv-save').onclick = async () => {
    try {
      await api('/api/media/' + m.id, { method: 'PUT', body: { original_name: $('pv-name').value.trim(), folder: $('pv-folder').value } });
      toast('Saved.', 'ok'); closeModal(); loadGallery();
    } catch (e) { toast(e.message, 'err'); }
  };
  $('pv-select').onclick = () => { toggleSelect(m.id); closeModal(); };
  $('pv-del').onclick = async () => {
    if (!await confirmDialog('Delete this file?', '"' + esc(m.original_name) + '" will be permanently removed.', 'Delete')) return;
    try { await api('/api/media/' + m.id, { method: 'DELETE' }); S.selected.delete(m.id); toast('Deleted.', 'ok'); closeModal(); loadGallery(); }
    catch (e) { toast(e.message, 'err'); }
  };
}

/* -- AI Assistant -- */
async function loadAI() {
  const el = $('tab-ai');
  el.innerHTML =
    '<div class="card"><h2>AI Assistant ' + (S.demo.ai ? demoBadge() : '<span class="badge badge-ok">OPENAI</span>') + '</h2>' +
    (S.demo.ai
      ? '<div class="alert alert-info" style="margin:0 0 10px">Demo mode: captions are smart templates, not real AI. To enable ChatGPT, add <b>OPENAI_API_KEY</b> to your <b>.env</b> — full steps in <b>docs/SETUP.md</b>. Your key stays on the server and is never shown in the app.</div>'
      : '<p class="muted tiny">Powered by OpenAI. Your key stays on the server.</p>') +
    '<div class="row"><label class="field grow"><span>Language</span><select id="ai-lang"><option>English</option><option>Urdu</option><option>Roman Urdu</option></select></label>' +
    '<label class="field grow"><span>Tone</span><select id="ai-tone"><option>Friendly</option><option>Professional</option><option>Funny</option><option>Promotional</option></select></label></div>' +
    '<label class="field"><span>What is the post about?</span><textarea id="ai-topic" placeholder="e.g. New winter lawn collection, 20% off this week"></textarea></label>' +
    '<button class="btn btn-primary" id="btn-gen">Generate captions</button></div>' +
    '<div id="ai-results"></div>' +
    '<div class="card"><h3>Saved captions</h3><div id="saved-caps"><p class="muted">None saved yet.</p></div></div>';
  $('btn-gen').onclick = generateCaptions;
  loadSavedCaptions();
}
async function generateCaptions() {
  const btn = $('btn-gen');
  const language = $('ai-lang').value, tone = $('ai-tone').value, topic = $('ai-topic').value.trim();
  if (!topic) { toast('Describe what the post is about first.', 'err'); return; }
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Generating...';
  try {
    const d = await api('/api/ai/generate', { method: 'POST', body: { language, tone, topic } });
    $('ai-results').innerHTML = '<div class="card"><h3>Results ' + (d.demo ? demoBadge() : '') + '</h3>' +
      (d.setup ? '<p class="tiny muted">' + esc(d.setup) + '</p>' : '') +
      d.captions.map((c, i) =>
        '<label class="field"><span>Caption ' + (i + 1) + '</span><textarea id="cap-' + i + '">' + esc(c) + '</textarea></label>' +
        '<div class="row"><button class="btn btn-outline btn-sm grow" data-copy="' + i + '">Copy</button>' +
        '<button class="btn btn-outline btn-sm grow" data-save="' + i + '">Save</button>' +
        '<button class="btn btn-outline btn-sm grow" data-use="' + i + '">Use in Publish</button></div>'
      ).join('') + '</div>';
    $('ai-results').querySelectorAll('[data-copy]').forEach((b) => b.onclick = () => {
      const t = $('cap-' + b.dataset.copy); t.select();
      (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject()).then(
        () => toast('Copied.', 'ok'), () => { document.execCommand('copy'); toast('Copied.', 'ok'); });
    });
    $('ai-results').querySelectorAll('[data-save]').forEach((b) => b.onclick = async () => {
      try { await api('/api/captions', { method: 'POST', body: { text: $('cap-' + b.dataset.save).value, language, tone } }); toast('Caption saved.', 'ok'); loadSavedCaptions(); }
      catch (e) { toast(e.message, 'err'); }
    });
    $('ai-results').querySelectorAll('[data-use]').forEach((b) => b.onclick = () => {
      S.pubCaption = $('cap-' + b.dataset.use).value; location.hash = '#publish'; toast('Caption loaded into Publish.', 'ok');
    });
  } catch (e) { toast(e.message, 'err'); }
  btn.disabled = false; btn.textContent = 'Generate captions';
}
async function loadSavedCaptions() {
  const el = $('saved-caps');
  if (!el) return;
  try {
    const d = await api('/api/captions');
    S.captions = d.captions;
    el.innerHTML = d.captions.length ? d.captions.map((c) =>
      '<div class="list-item"><div class="tiny muted">' + esc([c.language, c.tone].filter(Boolean).join(' · ')) + ' · ' + fmtDate(c.created_at) + '</div>' +
      '<div style="white-space:pre-wrap;margin:6px 0">' + esc(c.text) + '</div>' +
      '<div class="row"><button class="btn btn-outline btn-sm grow" data-use-saved="' + c.id + '">Use in Publish</button>' +
      '<button class="btn btn-ghost btn-sm" data-del-saved="' + c.id + '">Delete</button></div></div>'
    ).join('') : '<p class="muted">None saved yet.</p>';
    el.querySelectorAll('[data-use-saved]').forEach((b) => b.onclick = () => {
      const c = S.captions.find((x) => x.id === +b.dataset.useSaved);
      if (c) { S.pubCaption = c.text; location.hash = '#publish'; }
    });
    el.querySelectorAll('[data-del-saved]').forEach((b) => b.onclick = async () => {
      await api('/api/captions/' + b.dataset.delSaved, { method: 'DELETE' }); loadSavedCaptions();
    });
  } catch (e) { el.innerHTML = '<p class="muted">Could not load saved captions.</p>'; }
}

/* -- Publish -- */
async function loadPublish() {
  const el = $('tab-publish');
  el.innerHTML = '<div class="empty">Loading...</div>';
  try {
    const d = await api('/api/pages');
    S.pages = d.pages;
    const connected = d.pages.filter((p) => p.status === 'connected');
    if (!S.pubPageId || !connected.find((p) => p.id === +S.pubPageId)) S.pubPageId = connected.length ? connected[0].id : null;
    const caps = await api('/api/captions');
    S.captions = caps.captions;
    el.innerHTML =
      '<div class="card"><h2>Publish ' + (S.demo.fb ? demoBadge() : '') + '</h2>' +
      (S.demo.fb ? '<p class="tiny muted">Demo mode: posts are saved to history only and labeled DEMO — never claimed as published to Facebook.</p>' :
        '<p class="tiny muted">Posts go live on the selected Page via Meta\'s official API. We only report success when Facebook confirms it.</p>') +
      (connected.length ? '' : '<div class="alert alert-error" style="margin:0 0 10px">No connected Pages. <a href="#pages">Connect one first</a>.</div>') +
      '<label class="field"><span>Facebook Page</span><select id="pub-page">' +
      connected.map((p) => '<option value="' + p.id + '"' + (p.id === +S.pubPageId ? ' selected' : '') + '>' + esc(p.name) + (p.is_demo ? ' (DEMO)' : '') + '</option>').join('') +
      '</select></label>' +
      '<label class="field"><span>Media (<b id="pub-mcount">' + S.selected.size + '</b> selected)</span></label>' +
      '<div class="mgrid" id="pub-grid" style="margin:0 0 8px"></div>' +
      '<button class="btn btn-outline" id="pub-pick">Choose in Gallery Room</button>' +
      '<label class="field"><span>Caption</span><textarea id="pub-caption" placeholder="Write your caption...">' + esc(S.pubCaption) + '</textarea></label>' +
      '<label class="field"><span>Insert a saved caption</span><select id="pub-saved"><option value="">-- choose --</option>' +
      S.captions.map((c) => '<option value="' + c.id + '">' + esc(c.text.slice(0, 60)) + '...</option>').join('') + '</select></label>' +
      '<button class="btn btn-outline" id="pub-ai">Generate with AI Assistant</button>' +
      '<h3>Preview</h3><div id="pub-preview"></div>' +
      '<button class="btn btn-primary" id="btn-publish" ' + (connected.length ? '' : 'disabled') + '>Review &amp; Publish</button></div>' +
      '<div id="pub-result"></div>';
    renderPubGrid();
    $('pub-page').onchange = (e) => { S.pubPageId = +e.target.value; renderPubPreview(); };
    $('pub-caption').oninput = (e) => { S.pubCaption = e.target.value; renderPubPreview(); };
    $('pub-saved').onchange = (e) => {
      const c = S.captions.find((x) => x.id === +e.target.value);
      if (c) { S.pubCaption = c.text; $('pub-caption').value = c.text; renderPubPreview(); }
    };
    $('pub-pick').onclick = () => location.hash = '#gallery';
    $('pub-ai').onclick = () => location.hash = '#ai';
    $('btn-publish').onclick = confirmAndPublish;
    renderPubPreview();
  } catch (e) { el.innerHTML = '<div class="alert alert-error">' + esc(e.message) + '</div>'; }
}
function renderPubGrid() {
  const g = $('pub-grid');
  if (!g) return;
  const ids = [...S.selected];
  $('pub-mcount').textContent = ids.length;
  if (!ids.length) { g.innerHTML = '<p class="muted tiny">No media selected yet.</p>'; return; }
  // fetch details for selected ids from gallery cache or API
  api('/api/media').then((d) => {
    const map = {}; d.files.forEach((m) => map[m.id] = m);
    g.innerHTML = ids.filter((id) => map[id]).map((id) => {
      const m = map[id]; const isV = m.mime.indexOf('video/') === 0;
      const src = '/uploads/' + S.userIdForUploads + '/' + m.filename;
      return '<div class="mitem sel"><div class="checkbadge" data-un="' + id + '" style="opacity:1;background:var(--red);border-color:var(--red);color:#fff;cursor:pointer">&#10005;</div>' +
        (isV ? '<video src="' + src + '" preload="metadata" muted></video>' : '<img src="' + src + '" alt="">') +
        '<div class="meta"><div class="nm">' + esc(m.original_name) + '</div></div></div>';
    }).join('');
    g.querySelectorAll('[data-un]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); S.selected.delete(+b.dataset.un); renderPubGrid(); renderPubPreview(); });
    S._pubMedia = ids.map((id) => map[id]).filter(Boolean);
    renderPubPreview();
  }).catch(() => {});
}
function renderPubPreview() {
  const pv = $('pub-preview');
  if (!pv) return;
  const page = S.pages.find((p) => p.id === +S.pubPageId);
  const media = (S._pubMedia || []).slice(0, 4);
  pv.innerHTML = '<div class="fbpost"><div class="ph"><div class="avatar">' + initials(page ? page.name : '?') + '</div>' +
    '<div><b>' + esc(page ? page.name : 'Select a Page') + '</b><br><span class="tiny muted">Just now · ' + (S.demo.fb ? 'DEMO preview' : 'Facebook') + '</span></div></div>' +
    (S.pubCaption ? '<div class="pbody">' + esc(S.pubCaption) + '</div>' : '<div class="pbody muted">No caption yet.</div>') +
    (media.length ? '<div class="pmedia">' + media.map((m) =>
      m.mime.indexOf('video/') === 0 ? '<video src="/uploads/' + S.userIdForUploads + '/' + m.filename + '" muted></video>'
        : '<img src="/uploads/' + S.userIdForUploads + '/' + m.filename + '" alt="">').join('') + '</div>' : '') +
    '<div class="pfoot">Preview — ' + media.length + ' file(s)</div></div>';
}
async function confirmAndPublish() {
  const page = S.pages.find((p) => p.id === +S.pubPageId);
  if (!page) { toast('Select a Page first.', 'err'); return; }
  if (!S.selected.size) { toast('Select at least one photo or video.', 'err'); return; }
  const ok = await confirmDialog('Publish this post?',
    'Page: <b>' + esc(page.name) + '</b><br>' + S.selected.size + ' file(s)<br>' +
    (S.demo.fb ? '<b>DEMO</b> — this will only be saved to history, not to Facebook.' : 'This will go <b>live</b> on Facebook via the official API.'),
    S.demo.fb ? 'Save demo post' : 'Publish now');
  if (ok) doPublish({ page_id: page.id, caption: S.pubCaption, media_ids: [...S.selected] });
}
async function doPublish(payload) {
  const res = $('pub-result');
  res.innerHTML = '<div class="card"><h3>Publishing...</h3><div class="progress"><i id="pub-bar"></i></div><p class="tiny muted">Talking to ' + (S.demo.fb ? 'demo backend' : 'Facebook') + ' — please wait.</p></div>';
  const bar = $('pub-bar');
  let p = 0;
  const tick = setInterval(() => { p = Math.min(92, p + 7); if (bar) bar.style.width = p + '%'; }, 220);
  try {
    const d = await api('/api/publish', { method: 'POST', body: payload });
    clearInterval(tick); if (bar) bar.style.width = '100%';
    res.innerHTML = '<div class="alert alert-ok">' + esc(d.message) + (d.demo ? ' ' + demoBadge() : '') + (d.fb_post_id ? '<br>Facebook post id: ' + esc(d.fb_post_id) : '') + '</div>';
    S.selected.clear(); S.pubCaption = ''; S._pubMedia = [];
    toast('Done.', 'ok');
    setTimeout(() => location.hash = '#history', 1400);
  } catch (e) {
    clearInterval(tick);
    res.innerHTML = '<div class="alert alert-error">' + esc(e.message) + '</div>' +
      '<div class="card"><button class="btn btn-primary" id="btn-retry">Retry</button>' +
      '<p class="tiny muted">Nothing was published. Fix the issue and try again — we never claim success unless Facebook confirms it.</p></div>';
    $('btn-retry').onclick = () => doPublish(payload);
  }
}

/* -- History -- */
/* -- Pages Feed: recent posts from connected real Pages, inside the app -- */
async function loadFeed() {
  const el = $('tab-feed');
  el.innerHTML = '<div class="empty">Loading feed...</div>';
  try {
    // Connected pages (for the official Facebook Page Plugin embeds - work with zero permissions)
    let pages = [];
    try { const pd = await api('/api/pages'); pages = (pd.pages || []).filter((p) => p.status === 'connected' && !p.is_demo); } catch (e) { /* ignore */ }
    const pluginCards = pages.map((p) => {
      const href = encodeURIComponent('https://www.facebook.com/' + p.page_id);
      const src = 'https://www.facebook.com/plugins/page.php?href=' + href +
        '&tabs=timeline&width=340&height=500&small_header=false&adapt_container_width=true&hide_cover=false&show_facepile=true';
      return '<div class="card"><h3>' + esc(p.name) + ' <span class="tiny muted">· live from Facebook</span></h3>' +
        '<iframe src="' + src + '" width="340" height="500" style="border:none;overflow:hidden;max-width:100%" ' +
        'scrolling="no" frameborder="0" allowfullscreen="true" ' +
        'allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share" loading="lazy"></iframe></div>';
    }).join('');
    // API posts (needs pages_read_engagement; may show an error until the permission is fixed)
    const d = await api('/api/pages/feed');
    let apiHtml = '';
    if (!d.posts.length) {
      apiHtml = (d.errors && d.errors.length)
        ? '<div class="alert alert-err">Could not load posts:<br>' + d.errors.map(esc).join('<br>') + '</div>'
        : '<div class="empty">No posts yet. Publish something from the Publish tab first!</div>';
    } else {
      apiHtml = d.posts.map((p) =>
        '<div class="card">' +
        '<div class="tiny muted">' + esc(p.page_name) + ' · ' + esc(fmtDate(p.created_time)) + '</div>' +
        (p.full_picture ? '<img src="' + esc(p.full_picture) + '" style="width:100%;border-radius:12px;margin:8px 0" loading="lazy">' : '') +
        (p.message ? '<p>' + esc(p.message) + '</p>' : '<p class="muted tiny">(no text)</p>') +
        '<div class="tiny muted">❤️ ' + p.likes + ' &nbsp; 💬 ' + p.comments +
        (p.permalink_url ? ' &nbsp; <a href="' + esc(p.permalink_url) + '" target="_blank" rel="noopener">View on Facebook</a>' : '') + '</div>' +
        '</div>'
      ).join('');
    }
    el.innerHTML = '<div class="card"><h2>Pages Feed</h2><p class="muted tiny">Your Facebook Pages, live inside the app, via Facebook\'s official Page Plugin.</p></div>' +
      (pluginCards || '<div class="empty">No connected Pages. <a href="#pages">Connect one first</a>.</div>') +
      (apiHtml ? '<div class="card"><h3>Recent posts (via API)</h3><p class="muted tiny">Detailed post data, likes and comments.</p></div>' + apiHtml : '');
  } catch (e) {
    el.innerHTML = '<div class="card"><h2>Pages Feed</h2></div><div class="alert alert-err">' + esc(e.message) + '</div>';
  }
}
async function loadHistory() {
  const el = $('tab-history');
  el.innerHTML = '<div class="empty">Loading...</div>';
  try {
    const d = await api('/api/pages');
    S.pages = d.pages;
    el.innerHTML =
      '<div class="card"><h2>Publishing history</h2><p class="muted tiny">Every attempt is recorded. ' + demoBadge() + ' = demo entry, never posted to Facebook.</p></div>' +
      '<div class="filters"><select id="h-page"><option value="">All Pages</option>' +
      S.pages.map((p) => '<option value="' + p.id + '">' + esc(p.name) + '</option>').join('') + '</select>' +
      '<select id="h-status"><option value="">All statuses</option><option value="published">Published</option><option value="published_demo">Demo</option><option value="failed">Failed</option></select>' +
      '<input type="date" id="h-date"></div>' +
      '<div class="card" id="h-list" style="background:transparent;border:none;box-shadow:none;padding:0"></div>';
    const reload = async () => {
      const q = new URLSearchParams({ page_id: $('h-page').value, status: $('h-status').value, date: $('h-date').value });
      const h = await api('/api/history?' + q.toString());
      const list = $('h-list');
      list.innerHTML = h.posts.length ? h.posts.map((p) =>
        postRow(p) + (p.status === 'failed'
          ? '<button class="btn btn-outline btn-sm" data-retry="' + p.id + '">Retry this post</button>' : '')
      ).join('') : '<div class="empty">No posts match these filters.</div>';
      list.querySelectorAll('[data-retry]').forEach((b) => b.onclick = () => retryPost(+b.dataset.retry));
    };
    $('h-page').onchange = reload; $('h-status').onchange = reload; $('h-date').onchange = reload;
    await reload();
  } catch (e) { el.innerHTML = '<div class="alert alert-error">' + esc(e.message) + '</div>'; }
}
async function retryPost(id) {
  try {
    const d = await api('/api/publish/' + id + '/retry', { method: 'POST' });
    S.pubPageId = d.retry.page_id; S.pubCaption = d.retry.caption || '';
    S.selected = new Set(d.retry.media_ids);
    location.hash = '#publish';
    toast('Post loaded — review and publish again.', 'ok');
  } catch (e) { toast(e.message, 'err'); }
}

/* -- Boot -- */
document.addEventListener('DOMContentLoaded', init);
async function init() {
  $('btn-request-otp').onclick = requestOtp;
  $('btn-verify-otp').onclick = verifyOtp;
  $('btn-back-phone').onclick = () => { $('login-step-code').classList.add('hidden'); $('login-step-phone').classList.remove('hidden'); };
  $('btn-resend').onclick = requestOtp;
  $('btn-logout').onclick = logout;
  $('btn-back').onclick = goBack;
  $('phone').addEventListener('keydown', (e) => { if (e.key === 'Enter') requestOtp(); });
  $('otp').addEventListener('keydown', (e) => { if (e.key === 'Enter') verifyOtp(); });
  document.querySelectorAll('.navbtn').forEach((b) => b.onclick = () => location.hash = '#' + b.dataset.tab);
  $('file-picker').addEventListener('change', (e) => { if (e.target.files.length) handleFiles(e.target.files); e.target.value = ''; });
  try { const c = await fetch('/api/config').then((r) => r.json()); S.demo = c.demo; } catch (e) { /* offline */ }
  demoBanners();
  try {
    const me = await api('/api/auth/me');
    if (me.loggedIn) {
      S.user = { phone: me.user.phone };
      S.userIdForUploads = me.user.id;
      S.demo = me.demo;
      showApp();
    } else showLogin();
  } catch (e) { showLogin(); }
}
