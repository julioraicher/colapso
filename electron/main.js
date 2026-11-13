// Electron shell: loads the offline web build. Flags chosen for weak/integrated GPUs.
const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
app.commandLine.appendSwitch('ignore-gpu-blocklist');          // old Intel HD drivers are often blocklisted → software fallback
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
function create() {
  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1280, height: 720, fullscreen: true, backgroundColor: '#05070b', title: 'COLAPSO',
    webPreferences: { backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'game', 'index.html'));
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11') win.setFullScreen(!win.isFullScreen());
    if (input.type === 'keyDown' && input.key === 'F4' && input.alt) app.quit();
  });
}
app.whenReady().then(create);
app.on('window-all-closed', () => app.quit());
