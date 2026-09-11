// Amadeus Pet — Electron main process
const { app, BrowserWindow, ipcMain, screen, nativeImage } = require('electron')
const path = require('path')

let win = null
let dragSession = null

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
    resizable: false,
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
      webSecurity: false,
    },
  })

  // Lock the frameless window to one physical app size. On Windows this
  // protects against DPI/snap-related bounds changes while dragging.
  win.setMinimumSize(PET_W, PET_H)
  win.setMaximumSize(PET_W, PET_H)
  win.setAlwaysOnTop(true, 'screen-saver')

  // Only one shell ships. The Cubism 5 sample shell that AMA_DEMO used to switch
  // to now lives in legacy/cubism5-demo/ and is not part of the build: its
  // `@framework/*` imports resolve through an alias this project no longer
  // defines, so it could not have loaded even while it was still wired up here.
  const page = 'index.html'

  // Register capture hooks before navigation. CI can load the local page fast
  // enough that attaching this listener after loadFile() races did-finish-load.
  if (process.env.AMA_CAPTURE) {
    win.webContents.once('did-finish-load', () => {
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

  win.loadFile(
    path.join(__dirname, '..', 'dist', page),
    process.env.AMA_HASH ? { hash: process.env.AMA_HASH } : undefined
  )

  win.on('closed', () => {
    dragSession = null
    win = null
  })
}

function setPetPosition(x, y) {
  if (!win) return

  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const b = display.workArea
  const nx = clamp(Math.round(x), b.x - 200, b.x + b.width - 60)
  const ny = clamp(Math.round(y), b.y - 60, b.y + b.height - 60)

  // Re-assert size on every move so Windows cannot mutate bounds while
  // crossing DPI domains on a transparent frameless window.
  win.setBounds({ x: nx, y: ny, width: PET_W, height: PET_H }, false)
}

/* ---- IPC: dragging the pet ---------------------------------- */
// Do all position math in Electron main-process DIP coordinates. Mixing DOM
// screenX/screenY with BrowserWindow coordinates is unreliable on Windows when
// display scaling differs.
ipcMain.on('pet:drag-start', () => {
  if (!win) return
  const cursor = screen.getCursorScreenPoint()
  const [wx, wy] = win.getPosition()
  dragSession = {
    offsetX: cursor.x - wx,
    offsetY: cursor.y - wy,
  }
})

ipcMain.on('pet:drag-move', () => {
  if (!win) return
  const cursor = screen.getCursorScreenPoint()

  if (!dragSession) {
    const [wx, wy] = win.getPosition()
    dragSession = {
      offsetX: cursor.x - wx,
      offsetY: cursor.y - wy,
    }
    return
  }

  setPetPosition(
    cursor.x - dragSession.offsetX,
    cursor.y - dragSession.offsetY,
  )
})

ipcMain.on('pet:drag-end', () => {
  dragSession = null
})

ipcMain.on('pet:set-position', (_e, x, y) => {
  setPetPosition(x, y)
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
  win.setBounds({
    x: clamp(wx, b.x, b.x + b.width - PET_W),
    y: b.y + b.height - PET_H + 8,
    width: PET_W,
    height: PET_H,
  }, false)
})

/* ---- single instance + tray-less minimal lifecycle ----------- */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus() } })

  app.commandLine.appendSwitch('enable-transparent-visuals')
  if (process.platform === 'linux') {
    app.commandLine.appendSwitch('ozone-platform', 'x11')
    if (process.env.AMA_HWGL) {
      app.commandLine.appendSwitch('use-gl', 'angle')
      app.commandLine.appendSwitch('use-angle', 'gl')
      app.commandLine.appendSwitch('ignore-gpu-blocklist')
      app.commandLine.appendSwitch('enable-unsafe-swiftshader')
    } else {
      app.commandLine.appendSwitch('disable-gpu')
      app.commandLine.appendSwitch('enable-unsafe-swiftshader')
      app.commandLine.appendSwitch('in-process-gpu')
    }
  }
  app.whenReady().then(createWindow)
  app.on('window-all-closed', () => app.quit())
}
