const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { app, BrowserWindow, clipboard, ipcMain } = require("electron");

const libUrl = pathToFileURL(path.join(__dirname, "..", "scripts", "recharge-code-lib.mjs")).href;
let mainWindow;

async function loadLib() {
  return import(libUrl);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 860,
    height: 720,
    minWidth: 760,
    minHeight: 620,
    title: "\u90c5\u7ed8AI\u79ef\u5206\u7801\u751f\u6210\u5668",
    backgroundColor: "#10141b",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });
  mainWindow.removeMenu();
  mainWindow.loadFile(path.join(__dirname, "recharge-code-generator-ui.html"));
}

ipcMain.handle("recharge.generate", async (_event, input) => {
  const { createRechargeCode, permanentExpiresAt } = await loadLib();
  const result = createRechargeCode(input);
  clipboard.writeText(result.code);
  return { ...result, permanentExpiresAt, copied: true };
});

ipcMain.handle("recharge.copy", async (_event, text) => {
  clipboard.writeText(String(text || ""));
  return true;
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});
