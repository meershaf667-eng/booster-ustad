// Booster Ustad — Electron desktop shell (Windows).
// Starts the Express backend in-process, then opens it in a desktop window.
// No terminal, no Node.js install needed on the user's machine.
const { app, BrowserWindow, Menu } = require('electron');
const http = require('http');
const path = require('path');

const PORT = process.env.PORT || 3000;
const URL = `http://localhost:${PORT}`;

// Start the backend. server.js binds the port synchronously at require time.
require(path.join(__dirname, '..', 'server.js'));

function waitForServer(timeoutMs = 20000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(URL, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error('Backend did not start in time.'));
        } else {
          setTimeout(attempt, 400);
        }
      });
      req.setTimeout(2000, () => req.destroy());
    };
    attempt();
  });
}

async function createWindow() {
  await waitForServer();
  const win = new BrowserWindow({
    width: 1200,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    autoHideMenuBar: true,
    title: 'Booster Ustad',
    webPreferences: {
      // The UI is served locally; no Node integration needed in the page.
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.loadURL(URL);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow().catch((e) => {
    console.error('[electron] failed to open window:', e.message);
    app.quit();
  });
});

app.on('window-all-closed', () => {
  // Quit outright on Windows/Linux (no macOS dock behavior needed).
  app.quit();
});
