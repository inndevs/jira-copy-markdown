// Render an original store screenshot using the packaged popup and fictional data.
// Usage: node scripts/render-store-assets.mjs
// Set CHROME_BIN if Chrome is not installed in a standard location.
// Runs an isolated headless profile; never connects to an existing browser.
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { connect } from './cdp.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const issue = JSON.parse(await readFile(join(root, 'store/demo-issue.json'), 'utf8'));
if (issue.key !== 'DEMO-42' || issue.url !== 'https://jira.example.org/browse/DEMO-42') {
  throw new Error('Store assets may only use the fictional DEMO-42 fixture.');
}
const binaries = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
let executable;
for (const candidate of binaries) {
  try { await access(candidate); executable = candidate; break; } catch { /* Try the next standard path. */ }
}
if (!executable) throw new Error('Chrome not found. Set CHROME_BIN to a Chrome or Chromium executable.');

const contentTypes = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  try {
    const path = resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
    if (!path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    const body = await readFile(path);
    response.writeHead(200, { 'Content-Type': contentTypes[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), 'jira-copy-markdown-store-'));
const chrome = spawn(executable, [
  '--headless=new', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-sync', '--disable-extensions',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let browser;
let page;
let targetId;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out starting isolated Chrome.')), 20000);
    chrome.once('error', error => { clearTimeout(timer); reject(error); });
    chrome.once('exit', code => { clearTimeout(timer); reject(new Error(`Chrome exited before connecting (${code}).`)); });
    chrome.stderr.on('data', data => {
      const match = data.toString().match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  browser = await connect(endpoint);
  ({ targetId } = await browser.call('Target.createTarget', { url: 'about:blank', background: true }));
  const debugOrigin = endpoint.replace(/^ws:/, 'http:').split('/devtools/')[0];
  const targets = await fetch(`${debugOrigin}/json/list`).then(response => response.json());
  const target = targets.find(target => target.id === targetId);
  if (!target) throw new Error('Isolated screenshot target was not found.');
  page = await connect(target.webSocketDebuggerUrl);
  await page.call('Page.enable');
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await page.call('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const fixture = ${JSON.stringify(issue)};
      Object.defineProperty(window, 'chrome', { configurable: true, value: {
        storage: { local: { get: async () => ({ options: {} }), set: async () => {} } },
        scripting: { executeScript: async () => [] },
        tabs: {
          query: async () => [{ id: 42, url: fixture.url }],
          sendMessage: async () => ({ ok: true, issue: structuredClone(fixture) })
        }
      } });
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: async (value) => { window.__copiedMarkdown = value; }
      } });
      // Fail closed if the implementation ever attempts its clipboard fallback.
      const execCommand = document.execCommand.bind(document);
      document.execCommand = (command, ...args) => {
        if (String(command).toLowerCase() === 'copy') throw new Error('Real clipboard access is disabled in store rendering.');
        return execCommand(command, ...args);
      };
    })();`,
  });
  await page.call('Page.navigate', { url: `${origin}/store/screenshot.html` });
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    ready = await page.evaluate('window.prepareScreenshot ? window.prepareScreenshot() : false');
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('The real popup did not reach its successful copy state.');
  const dimensions = await page.evaluate(`(() => {
    const frame = document.getElementById('popup');
    const shell = document.querySelector('.popup-shell').getBoundingClientRect();
    const preview = document.querySelector('.preview');
    const doc = frame.contentDocument;
    return {
      width: innerWidth, height: innerHeight, popupWidth: frame.clientWidth,
      popupHeight: frame.clientHeight, popupBottom: shell.bottom,
      previewOverflow: preview.scrollHeight > preview.clientHeight,
      issueKey: doc.getElementById('issue-key').textContent,
      state: doc.getElementById('notice').dataset.state,
      copyCaptured: Boolean(frame.contentWindow.__copiedMarkdown),
    };
  })()`);
  if (dimensions.popupWidth !== 380 || dimensions.popupBottom > 750 || dimensions.previewOverflow || dimensions.state !== 'success' || !dimensions.copyCaptured) {
    throw new Error(`Screenshot verification failed: ${JSON.stringify(dimensions)}`);
  }
  const { data } = await page.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(join(root, 'store/screenshot-1280x800.png'), Buffer.from(data, 'base64'));
  console.log(`Rendered store/screenshot-1280x800.png: ${JSON.stringify(dimensions)}`);
} finally {
  page?.close();
  if (browser) {
    if (targetId) await browser.call('Target.closeTarget', { targetId }).catch(() => {});
    await browser.call('Browser.close').catch(() => {});
    browser.close();
  }
  if (chrome.exitCode === null) {
    chrome.kill('SIGTERM');
    await new Promise(resolve => { chrome.once('exit', resolve); setTimeout(resolve, 3000); });
  }
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
