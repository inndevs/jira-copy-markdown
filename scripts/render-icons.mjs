// Render original SVG artwork without touching an existing browser session.
// Usage: node scripts/render-icons.mjs
// CHROME_BIN can override the Chrome/Chromium executable.
// Small icons fill the canvas; the store icon retains its 16px outer margin.
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { connect } from './cdp.mjs';

const svg = await readFile(new URL('../icons/icon.svg', import.meta.url), 'utf8');
const candidates = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
let executable;
for (const candidate of candidates) {
  try { await access(candidate); executable = candidate; break; } catch { /* Try the next standard location. */ }
}
if (!executable) throw new Error('Chrome not found. Set CHROME_BIN to a Chrome or Chromium executable.');

const profile = await mkdtemp(join(tmpdir(), 'jira-copy-markdown-icons-'));
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
    let output = '';
    chrome.stderr.on('data', data => {
      output = (output + data.toString()).slice(-8192);
      const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
  });
  browser = await connect(endpoint);
  ({ targetId } = await browser.call('Target.createTarget', { url: 'about:blank', background: true }));
  const debugOrigin = endpoint.replace(/^ws:/, 'http:').split('/devtools/')[0];
  const targets = await fetch(`${debugOrigin}/json/list`).then(response => response.json());
  const target = targets.find(target => target.id === targetId);
  if (!target) throw new Error('Isolated icon target was not found.');
  page = await connect(target.webSocketDebuggerUrl);

  const rendered = [];
  for (const size of [16, 32, 48, 128]) {
    const result = await page.evaluate(`(async () => {
      const size = ${size};
      const source = new DOMParser().parseFromString(${JSON.stringify(svg)}, 'image/svg+xml');
      const root = source.documentElement;
      if (source.querySelector('parsererror')) throw new Error('Invalid icon SVG.');
      root.setAttribute('width', size);
      root.setAttribute('height', size);
      // Crop the store margin away at toolbar and extension-management sizes.
      if (size < 128) root.setAttribute('viewBox', '16 16 96 96');
      const image = new Image();
      image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(source));
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      context.drawImage(image, 0, 0, size, size);
      (window.__iconCanvases ||= {})[size] = canvas;
      const pixels = context.getImageData(0, 0, size, size).data;
      let left = size, top = size, right = -1, bottom = -1;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (!pixels[(y * size + x) * 4 + 3]) continue;
          left = Math.min(left, x); top = Math.min(top, y);
          right = Math.max(right, x); bottom = Math.max(bottom, y);
        }
      }
      return { size, bounds: { left, top, right, bottom }, png: canvas.toDataURL('image/png').split(',')[1] };
    })()`);
    const margin = size === 128 ? 16 : 0;
    if (result.bounds.left !== margin || result.bounds.top !== margin ||
      result.bounds.right !== size - margin - 1 || result.bounds.bottom !== size - margin - 1) {
      throw new Error(`Unexpected icon padding: ${JSON.stringify({ size, bounds: result.bounds })}`);
    }
    await writeFile(new URL(`../icons/icon${size}.png`, import.meta.url), Buffer.from(result.png, 'base64'));
    rendered.push(result);
    console.log(`icon${size}.png: alpha bounds ${JSON.stringify(result.bounds)}`);
  }

  // Optional inspection artifact outside the packaged extension.
  // Each icon is shown at native resolution and enlarged without smoothing.
  if (process.env.ICON_PREVIEW_PATH) {
    await page.call('Emulation.setDeviceMetricsOverride', { width: 920, height: 410, deviceScaleFactor: 1, mobile: false });
    await page.evaluate(`(() => {
      document.body.style.cssText = 'margin:0;background:#f5f3ea;color:#173e35;font:14px -apple-system,BlinkMacSystemFont,sans-serif;padding:28px;';
      const heading = document.createElement('h1');
      heading.style.cssText = 'font-size:22px;margin:0 0 28px;';
      heading.textContent = 'Jira Ticket – Copy as Markdown — native size and pixel inspection';
      document.body.append(heading);
      const grid = document.createElement('div');
      grid.style.cssText = 'display:flex;gap:28px;';
      for (const icon of ${JSON.stringify(rendered)}) {
        const column = document.createElement('section');
        column.style.cssText = 'width:188px;';
        const title = document.createElement('p');
        title.style.cssText = 'margin:0 0 12px;font-weight:650;';
        title.textContent = icon.size + ' × ' + icon.size;
        column.append(title);
        const native = document.createElement('div');
        native.style.cssText = 'height:136px;display:flex;align-items:flex-start;gap:12px;';
        const image = window.__iconCanvases[icon.size];
        native.append(image);
        column.append(native);
        if (icon.size < 128) {
          const enlarged = document.createElement('canvas');
          enlarged.width = enlarged.height = 128;
          const context = enlarged.getContext('2d');
          context.imageSmoothingEnabled = false;
          context.drawImage(image, 0, 0, 128, 128);
          column.append(enlarged);
        }
        grid.append(column);
      }
      document.body.append(grid);
    })()`);
    const { data } = await page.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await writeFile(process.env.ICON_PREVIEW_PATH, Buffer.from(data, 'base64'));
  }
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
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
