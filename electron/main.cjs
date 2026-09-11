// Amadeus Pet — Electron main process
const { app, BrowserWindow, ipcMain, screen, nativeImage } = require('electron')
const path = require('path')

let win = null
let dragSession = null
/* Authoritative window size, pinned for the whole of a drag.
   On this Windows/DPI setup a transparent frameless window gains exactly 1 px
   of height on EVERY geometry call — setPosition and setBounds alike. Measured:
   15 moves took the window from 854 to 868 px tall. Because the inflation is
   per call, writing a size that is captured once and never re-read corrects it
   on the next move instead of letting it accumulate. Only a real user resize
   may change the pin. */
let pinnedSize = null

const PET_W = 480
const PET_H = 853 // phone ratio 9:16 (Amadeus phone-app proportions)

/* One config store for dev and packaged runs alike. Electron would otherwise
   derive the folder from productName, so the installed build ("AMA-DEUS")
   would start from an empty LLM/TTS configuration while `npm start` kept the
   saved one — same app, two divergent settings files. */
app.setPath('userData', path.join(app.getPath('appData'), 'amadeus-pet'))

function clamp(v, min, max) { return Math.min(Math.max(v, min), max) }

/* Window/taskbar icon. Packaged builds read the copy electron-builder drops in
   resources/, since build/ itself is not shipped inside the asar. */
function windowIcon() {
  const p = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, '..', 'build', 'icon.png')
  const img = nativeImage.createFromPath(p)
  return img.isEmpty() ? undefined : img
}

function createWindow() {
  win = new BrowserWindow({
    width: PET_W,
    height: PET_H,
    x: 80,
    y: 200,
    transparent: true,
    frame: false,
    resizable: true,
    hasShadow: false,
    alwaysOnTop: true,
    // Appear in the taskbar so the OS itself offers close/minimise. Without a
    // tray, skipping the taskbar left the frameless window unclosable.
    skipTaskbar: false,
    icon: windowIcon(),
    fullscreenable: false,
    maximizable: false,
    minimizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      webSecurity: false,
    },
  })

  // Deliberately NO minWidth / minHeight.
  // A height floor on a transparent, frameless, resizable Windows window makes
  // the OS and Chromium trade resize requests: measured 1643 will-resize events
  // in 15 s of complete idling, sweeping the window between the floor and its
  // full height. minWidth alone is harmless, but the floor is not worth the
  // storm — the shell is laid out in relative units and scales on its own.
  //
  // Also NO setAspectRatio here. Electron re-applies the ratio from inside
  // WM_SIZING, which fires another resize, forever. Measured 2466 will-resize
  // events in 45 s while idle. Handset proportions are the renderer's job now
  // (see src/style.css), where they cannot fight the window manager.
  win.setAlwaysOnTop(true, 'floating')

  // Seed the pin from the real window, then let only genuine user resizes move
  // it. Ignored mid-drag: a drag writes the size itself, so accepting those
  // notifications would fold the 1 px inflation back into the pin.
  pinnedSize = { width: win.getBounds().width, height: win.getBounds().height }
  win.on('will-resize', (_event, newBounds) => {
    if (dragSession) return
    pinnedSize = { width: newBounds.width, height: newBounds.height }
  })

  // Aspect ratio is left to setAspectRatio alone. An earlier version also
  // forced the ratio from a will-resize handler, but on a frameless window the
  // OS resize border and that handler fight each other: clicking near the edge
  // starts a system resize gesture, the handler rewrites the height mid-gesture,
  // and the window jumps larger. Never call setBounds from a resize event.
  //
  // Set AMA_TRACE_BOUNDS=1 to log every bounds change while diagnosing.
  if (process.env.AMA_TRACE_BOUNDS) {
    // Startup marker: without it an empty log is ambiguous between "no events"
    // and "tracing never initialised".
    console.error(`[bounds] tracing enabled pid=${process.pid}`)
    let resizes = 0
    let moves = 0
    let willResizes = 0
    // Handlers only count. They must NOT read geometry: calling getBounds() from
    // inside a resize/move notification provokes another one, and an earlier
    // version of this tracer did exactly that — it manufactured the very resize
    // storm it was meant to measure.
    win.on('will-resize', (_event, newBounds) => {
      willResizes++
      console.error(`[bounds] will-resize #${willResizes} ${newBounds.width}x${newBounds.height}`)
    })
    win.on('resize', () => { resizes++ })
    win.on('move', () => { moves++ })
    const timer = setInterval(() => {
      if (!win || win.isDestroyed()) { clearInterval(timer); return }
      const b = win.getBounds()   // safe: read from a timer, never from a handler
      console.error(`[bounds] t=${Math.round(process.uptime())}s size=${b.width}x${b.height} @${b.x},${b.y} resizes=${resizes} moves=${moves} willResizes=${willResizes}`)
    }, 5000)
    win.on('closed', () => clearInterval(timer))
  }

  // Only one shell ships: index.html. The Cubism 5 sample shell that AMA_DEMO
  // used to switch to now lives in legacy/cubism5-demo/.
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

  // Write back the pinned size on every move. Never read the size here: reading
  // it back would capture the 1 px inflation and compound it (measured: a
  // 15-move drag grew the window from 586 to 600 px tall). Pinning means each
  // move re-asserts the same rectangle, so the creep cannot accumulate.
  const size = pinnedSize || win.getBounds()
  win.setBounds({ x: nx, y: ny, width: size.width, height: size.height }, false)
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
  const { width, height } = win.getBounds()
  win.setBounds({
    x: clamp(wx, b.x, b.x + b.width - width),
    y: b.y + b.height - height + 8,
    width,
    height,
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
