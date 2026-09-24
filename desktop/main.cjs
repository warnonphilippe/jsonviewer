/**
 * The JSON viewer as a macOS application.
 *
 * A single window that shows the production build, nothing more. The app has
 * no backend and makes no network request, so there is nothing to bridge: no
 * preload, no IPC, no Node in the page. The file picker, drag and drop,
 * confirm(), the clipboard and localStorage all work exactly as in Chrome,
 * which is the engine the viewer's size limits and memory budgets were
 * measured against.
 *
 * The build is served from a custom `app://` scheme rather than `file://`:
 * - `<base href="/">` resolves to the build's root, so the Angular build needs
 *   no `--base-href`;
 * - the origin is secure and stable, so navigator.clipboard works and the
 *   theme saved in localStorage survives a restart.
 */

const { app, BrowserWindow, net, protocol, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/** The production build, copied here by build.sh. */
const ROOT = path.join(__dirname, 'app');
const ORIGIN = 'app://json-viewer';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

/**
 * Maps a request to a file inside ROOT. Anything else -- a path escaping ROOT,
 * or one that names no file -- gets index.html, like nginx's try_files.
 */
function serve(request) {
  const { pathname } = new URL(request.url);
  const file = path.join(ROOT, decodeURIComponent(pathname));
  const inside = file.startsWith(ROOT + path.sep) && path.extname(file) !== '';
  return net.fetch(pathToFileURL(inside ? file : path.join(ROOT, 'index.html')).toString());
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    title: 'JSON Viewer',
    // Windows: Electron's default menu bar would sit above the toolbar. Alt
    // shows it, and its shortcuts (zoom, reload) work either way. No effect
    // on macOS, where the menu is in the system bar.
    autoHideMenuBar: true,
  });

  // A file dropped outside the drop zone would otherwise replace the app with
  // the raw file. The viewer never navigates, so every navigation is refused.
  win.webContents.on('will-navigate', (event) => event.preventDefault());

  // External links belong in the default browser, not in a bare new window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadURL(`${ORIGIN}/index.html`);
}

// One process per user. A second launch -- the exe double-clicked again on
// Windows -- would find the profile locked and silently lose the saved theme;
// instead it hands over to the running app, which opens another window, handy
// for comparing two files side by side.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => createWindow());
  app.whenReady().then(() => {
    protocol.handle('app', serve);
    createWindow();
  });
}

// Closing the last window ends the app: a viewer has nothing to keep running,
// and a 500 MB document's memory is released at once.
app.on('window-all-closed', () => app.quit());
