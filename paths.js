// Central place for writable data paths (SQLite DB file + uploads folder).
//
// When the app is packaged with Electron, __dirname points inside the
// read-only app.asar archive, so the database and uploaded media must live in
// the user's writable app-data folder instead (e.g.
// %APPDATA%/Booster Ustad on Windows).
//
// When running as plain `node server.js` (Electron not present or not
// packaged), DATA_DIR falls back to the project directory — behavior is
// unchanged from before.
const path = require('path');
const fs = require('fs');

function resolveDataDir() {
  try {
    if (process.versions && process.versions.electron) {
      const { app } = require('electron');
      if (app && app.isPackaged) {
        const dir = app.getPath('userData');
        fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
        return dir;
      }
    }
  } catch (e) { /* not packaged / electron unavailable — fall through */ }
  return __dirname;
}

const DATA_DIR = resolveDataDir();
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

module.exports = { DATA_DIR, UPLOADS_DIR };
