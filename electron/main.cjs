// Amadeus Pet — Electron main process
const { app, BrowserWindow, ipcMain, screen, nativeImage } = require('electron')
const path = require('path')

let win = null

const PET_W = 480
const PET_H = 853 // phone ratio 9:16 (Amadeus phone-app proportions)

function clamp(v, min, max) { return Math.min(Math.max(v, min), max) }

function createWindow() {
  win = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    x: 80,
    y: 200,
    transparent: true,
    frame: false,
    resizable: false, // fixed phone-ratio window
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    maximizable: false,
    minimizable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      // Local-only app loading assets via file:// fetch.
      webSecurity: false,
    },
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  const page = process.env.AMA_DEMO ? 'demo.html' : 'index.html'
  win.loadFile(
    path.join(__dirname, '..', 'dist', page),
    process.env.AMA_HASH ? { hash: process.env.AMA_HASH } : undefined
  )

  // Debug: capture renderer output to PNG (AMA_CAPTURE=/path/to.png,
  // AMA_CAPTURE_BURST=n → n frames 2.5s apart, suffixed _0.._n-1)
  if (process.env.AMA_CAPTURE) {
    win.webContents.on('did-finish-load', () => {
      const delay = Number(process.env.AMA_CAPTURE_DELAY || 4000)
      const burst = Number(process.env.AMA_CAPTURE_BURST || 1)
      for (let i = 0; i < burst; i++) {
        setTimeout(async () => {
          try {
            const image = await win.webContents.capturePage()
            const out = burst > 1
              ? process.env.AMA_CAPTURE.replace(/\.png$/, `_${i}.png`)
              : process.env.AMA_CAPTURE
            require('fs').writeFileSync(out, image.toPNG())
            console.log('[ama] capture saved:', out)
          } catch (e) {
            console.error('[ama] capture failed:', e)
          }
        }, delay + i * 2500)
      }
    })
  }

  win.on('closed', () => { win = null })
}

/* ---- IPC: dragging the pet ---------------------------------- */
ipcMain.on('pet:drag-move', (_e, dx, dy) => {
  if (!win) return
  const [wx, wy] = win.getPosition()
  const displays = screen.getAllDisplays()
  let ok = false
  for (const d of displays) {
    const b = d.workArea
    if (wx + dx >= b.x - 200 && wy + dy >= b.y - 60 && wx + dx <= b.x + b.width - 60 && wy + dy <= b.y + b.height - 60) ok = true
  }
  if (ok) win.setPosition(wx + Math.round(dx), wy + Math.round(dy))
})

ipcMain.on('pet:set-position', (_e, x, y) => {
  if (win) win.setPosition(Math.round(x), Math.round(y))
})

ipcMain.handle('pet:get-position', () => (win ? win.getPosition() : [0, 0]))
ipcMain.handle('pet:get-workarea', () => screen.getPrimaryDisplay().workArea)

/* ---- IPC: window focus --------------------------------------- */
ipcMain.on('pet:focus', () => {
  if (win) win.focus()
})

/* ---- IPC: window controls ------------------------------------ */
ipcMain.on('pet:quit', () => app.quit())
ipcMain.on('pet:hide', () => { if (win) win.hide() })
ipcMain.on('pet:show', () => { if (win) win.show() })

/* ---- IPC: snap to bottom / park ------------------------------ */
ipcMain.on('pet:snap-bottom', () => {
  if (!win) return
  const b = screen.getPrimaryDisplay().workArea
  const [wx] = win.getPosition()
  win.setPosition(clamp(wx, b.x, b.x + b.width - PET_W), b.y + b.height - PET_H + 8)
})

/* ---- single instance + tray-less minimal lifecycle ----------- */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus() } })

  app.commandLine.appendSwitch('enable-transparent-visuals')
  if (process.platform === 'linux') {
    // Force X11 (XWayland) backend: transparent windows + mouse passthrough
    // only work reliably there; Wayland lacks alpha compositing on GNOME.
    app.commandLine.appendSwitch('ozone-platform', 'x11')
    if (process.env.AMA_HWGL) {
      // Use ANGLE on Mesa (llvmpipe software GL) instead of SwiftShader.
      app.commandLine.appendSwitch('use-gl', 'angle')
      app.commandLine.appendSwitch('use-angle', 'gl')
      app.commandLine.appendSwitch('ignore-gpu-blocklist')
      app.commandLine.appendSwitch('enable-unsafe-swiftshader')
    } else {
      // VM has no 3D acceleration: run everything on the software rasterizer
      // and allow SwiftShader for WebGL (Live2D rendering).
      app.commandLine.appendSwitch('disable-gpu')
      app.commandLine.appendSwitch('enable-unsafe-swiftshader')
      app.commandLine.appendSwitch('in-process-gpu')
    }
  }
  app.whenReady().then(createWindow)
  app.on('window-all-closed', () => app.quit())
}
