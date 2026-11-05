import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, until } from './cdp.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '');
const issue = JSON.parse(await readFile(join(root, 'store/demo-issue.json'), 'utf8'));
if (issue.key !== 'DEMO-42' || issue.url !== 'https://jira.example.org/browse/DEMO-42') {
  throw new Error('Store assets require the fictional DEMO-42 fixture.');
}
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
let chrome;
try {
  chrome = await launchChrome(['--disable-extensions']);
  const { page } = chrome;
  await page.call('Page.enable');
  await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await page.call('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const fixture = ${JSON.stringify(issue)};
      Object.defineProperty(window, 'chrome', { configurable: true, value: {
        storage: { local: { get: async () => ({ options: {} }), set: async () => {} } },
        scripting: { executeScript: async () => [{ result: { ok: true, issue: structuredClone(fixture) } }] },
        tabs: { query: async () => [{ id: 42, url: fixture.url }] }
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
  await until(() => page.evaluate('window.prepareScreenshot?.()'), 'popup copy');
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
  await chrome?.close();
  await new Promise(resolve => server.close(resolve));
}
