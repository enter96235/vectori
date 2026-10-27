const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const fs = require('node:fs');

let apiPort;
let bridgePort;
let bridgeX86Port;
let apiProcess;
let bridgeProcess;
let bridgeX86Process;

function findFreePort(preferredPort) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => {
      server.listen(0, '127.0.0.1');
    });
    server.listen(preferredPort, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function resourcePath(...parts) {
  const root = app.isPackaged
    ? process.resourcesPath
    : path.resolve(__dirname, '../..');
  return path.join(root, ...parts);
}

function startBridge(architecture, port) {
  const bridgeDirectory = architecture === 'x86' ? 'bridge-x86' : 'bridge-x64';
  const publishDirectory = architecture === 'x86' ? 'publish-x86' : 'publish';
  const bridgeExecutable = app.isPackaged
    ? resourcePath(bridgeDirectory, 'audi-tt-j2534-bridge.exe')
    : resourcePath(
        'native',
        'j2534-bridge',
        publishDirectory,
        'audi-tt-j2534-bridge.exe',
      );

  if (!fs.existsSync(bridgeExecutable)) {
    return;
  }

  const child = spawn(bridgeExecutable, [], {
    windowsHide: true,
    env: {
      ...process.env,
      J2534_BRIDGE_PORT: String(port),
    },
    stdio: 'ignore',
  });
  if (architecture === 'x86') bridgeX86Process = child;
  else bridgeProcess = child;
}

function startApi() {
  const apiEntry = app.isPackaged
    ? resourcePath('api', 'index.mjs')
    : resourcePath('artifacts', 'api-server', 'dist', 'index.mjs');
  const webRoot = app.isPackaged
    ? resourcePath('web')
    : resourcePath('artifacts', 'audi-tt-diagnostic', 'dist', 'public');
  if (!fs.existsSync(apiEntry)) {
    throw new Error(`No se encontró el paquete del servidor API: ${apiEntry}`);
  }

  apiProcess = spawn(process.execPath, [apiEntry], {
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(apiPort),
      NATIVE_BRIDGE_URL: `http://127.0.0.1:${bridgePort}`,
      NATIVE_BRIDGE_X86_URL: `http://127.0.0.1:${bridgeX86Port}`,
      STATIC_ROOT: webRoot,
    },
    stdio: 'ignore',
  });
}

function waitForBridge(port) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      const request = http.get(`http://127.0.0.1:${port}/health`, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) resolve();
        else retry();
      });
      request.on('error', retry);
      request.setTimeout(500, () => {
        request.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - startedAt > 10000) {
        reject(new Error(`El puente nativo del puerto ${port} no inició a tiempo.`));
        return;
      }
      setTimeout(check, 150);
    };
    check();
  });
}

function waitForApi() {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      const request = http.get(
        `http://127.0.0.1:${apiPort}/api/healthz`,
        (response) => {
          response.resume();
          if (response.statusCode && response.statusCode < 500) {
            resolve();
            return;
          }
          retry();
        },
      );
      request.on('error', retry);
      request.setTimeout(500, () => {
        request.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - startedAt > 10000) {
        reject(new Error('El servidor local de diagnóstico no inició a tiempo.'));
        return;
      }
      setTimeout(check, 150);
    };
    check();
  });
}

async function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    backgroundColor: '#0b151e',
    title: 'Vector Diag — Diagnóstico multimarca',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await window.loadURL(`http://127.0.0.1:${apiPort}/`);
}

function stopProcess(child) {
  if (child && !child.killed) {
    child.kill();
  }
}

const hasSingleInstance = app.requestSingleInstanceLock();

if (!hasSingleInstance) {
  app.quit();
} else {
  app.whenReady().then(async () => {
  try {
    apiPort = await findFreePort(4180);
    bridgePort = await findFreePort(27401);
    bridgeX86Port = await findFreePort(27402);
    startBridge('x64', bridgePort);
    startBridge('x86', bridgeX86Port);
    startApi();
    await Promise.all([waitForApi(), waitForBridge(bridgePort), waitForBridge(bridgeX86Port)]);
    await createWindow();
  } catch (error) {
    dialog.showErrorBox(
      'Vector Diag no pudo iniciar',
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  }
  });
}

app.on('window-all-closed', () => {
  stopProcess(bridgeProcess);
  stopProcess(bridgeX86Process);
  stopProcess(apiProcess);
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopProcess(bridgeProcess);
  stopProcess(bridgeX86Process);
  stopProcess(apiProcess);
});