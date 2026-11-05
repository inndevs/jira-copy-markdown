#!/usr/bin/env node
// Dependency-free integration check. Uses only synthetic Jira data, a fresh
// browser profile, and the extension's genuine action/activeTab permission.
// Run: node scripts/browser-smoke.mjs (or set CHROME_BIN to Chrome/Chromium).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureOrigin = 'https://demo.atlassian.net';
const fixtureUrl = `${fixtureOrigin}/browse/DEMO-42`;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function until(check, description, timeout = 10000) {
  const end = Date.now() + timeout;
  let lastError;
  do {
    try { const value = await check(); if (value) return value; }
    catch (error) { lastError = error; }
    await delay(50);
  } while (Date.now() < end);
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`);
}

async function browserBinary() {
  const candidates = process.env.CHROME_BIN ? [process.env.CHROME_BIN] : [
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
  ];
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* Try the next known path. */ }
  }
  throw new Error('Chrome/Chromium was not found. Set CHROME_BIN to a recent browser executable.');
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let sequence = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const task = pending.get(message.id);
      if (!task) return;
      clearTimeout(task.timer);
      pending.delete(message.id);
      if (message.error) task.reject(new Error(`${task.method}: ${message.error.message}`));
      else task.resolve(message.result);
    } else {
      for (const callback of listeners.get(message.method) || []) callback(message.params, message.sessionId);
    }
  });
  socket.addEventListener('close', () => {
    for (const task of pending.values()) {
      clearTimeout(task.timer);
      task.reject(new Error(`Browser closed during ${task.method}`));
    }
    pending.clear();
  });
  return {
    call(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 10000);
        pending.set(id, { method, resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
    on(method, callback) {
      const entries = listeners.get(method) || [];
      entries.push(callback);
      listeners.set(method, entries);
    },
    async evaluate(sessionId, expression, userGesture = false) {
      const result = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture }, sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    },
    close() { socket.close(); },
  };
}

const paragraph = value => ({ type: 'paragraph', content: [{ type: 'text', text: value }] });
const adf = (...content) => ({ type: 'doc', version: 1, content });
const apiComments = [1, 2].map(id => ({
  id: String(id), author: { displayName: `Fixture author ${id}` },
  created: `2026-11-0${id}T10:00:00.000Z`, body: adf(paragraph(`Synthetic reply ${id}`)),
}));
const apiIssue = {
  key: 'DEMO-42', names: { customfield_10001: 'Story points' },
  fields: {
    summary: 'Synthetic API issue', issuetype: { name: 'Task' }, status: { name: 'In progress' },
    description: adf(paragraph('Synthetic API description'), {
      type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'fixture-media', alt: 'diagram.png' } }],
    }),
    customfield_10001: 8,
    attachment: [{ id: '7', filename: 'diagram.png', mimeType: 'image/png', size: 321,
      content: `${fixtureOrigin}/secure/attachment/7/diagram.png?token=a%2Bb&download=1` }],
    comment: { total: 2, comments: [apiComments[0]] },
  },
};

const fixtureHtml = `<!doctype html><html><head><title>Synthetic Jira fixture</title></head><body>
  <main role="dialog">
    <a id="key-val" href="/browse/DEMO-42">DEMO-42</a>
    <h1 id="summary-val">Synthetic visible issue</h1>
    <div id="type-val">Task</div><div id="status-val">Open</div>
    <div id="description-val">
      <p>Visible <strong>description</strong> with <a href="/help?first=1&amp;second=2">query link</a>.</p>
      <ol start="4"><li><p>Outer item</p><ul><li>Nested item</li></ul></li></ol>
      <table><tr><th>Column</th><th>Meaning</th></tr><tr><td>literal|pipe</td><td>first<br>second</td></tr></table>
      <pre><code class="language-js">const sample = 1;
\`\`\`</code></pre>
      <button>Do not export this control</button>
    </div>
    <div class="issue-comment" id="comment-90"><span class="user-hover">Visible author</span>
      <time datetime="2026-11-04T12:00:00Z">Yesterday</time><div class="action-body"><p>Visible <em>reply</em></p></div></div>
    <div class="issue-comment" id="comment-91" hidden><div class="action-body">Hidden reply</div></div>
    <label for="customfield_10001">Story points:</label><div id="customfield_10001-val">13</div>
    <a href="/secure/attachment/8/spec.pdf?download=1&amp;token=c%2Bd">spec.pdf</a>
    <a href="/secure/attachment/8/spec.pdf?download=1&amp;token=c%2Bd">duplicate attachment anchor</a>
  </main>
</body></html>`;

const profile = await mkdtemp(join(tmpdir(), 'jira-markdown-smoke-'));
let processHandle;
let browser;
let cleaned = false;
let browserErrors = '';

async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (browser) {
    try { await browser.call('Browser.close'); } catch { /* Browser may already have exited. */ }
    browser.close();
  }
  if (processHandle?.exitCode === null) {
    processHandle.kill('SIGTERM');
    await Promise.race([new Promise(resolve => processHandle.once('exit', resolve)), delay(3000)]);
    if (processHandle.exitCode === null) processHandle.kill('SIGKILL');
  }
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  cleanup().finally(() => process.exit(signal === 'SIGINT' ? 130 : 143));
});

try {
  processHandle = spawn(await browserBinary(), [
    '--headless=new', '--remote-debugging-port=0', '--enable-unsafe-extension-debugging',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--disable-gpu', '--noerrdialogs',
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
    `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  processHandle.stderr.on('data', chunk => { browserErrors = (browserErrors + chunk).slice(-5000); });
  let spawnError;
  processHandle.once('error', error => { spawnError = error; });
  const activePort = await until(async () => {
    if (spawnError) throw spawnError;
    if (processHandle.exitCode !== null) throw new Error(`Chrome exited: ${browserErrors}`);
    return (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n');
  }, 'isolated Chrome debugging endpoint');
  browser = await connect(`ws://127.0.0.1:${activePort[0]}${activePort[1]}`);
  const { id: extensionId } = await browser.call('Extensions.loadUnpacked', { path: root });
  const { targetId: jiraTarget } = await browser.call('Target.createTarget', { url: 'about:blank' });
  const { sessionId: jiraSession } = await browser.call('Target.attachToTarget', { targetId: jiraTarget, flatten: true });

  let scenario = 'api';
  const requests = [];
  const interceptionErrors = [];
  browser.on('Fetch.requestPaused', (event, sessionId) => {
    if (sessionId !== jiraSession) return;
    (async () => {
      const url = new URL(event.request.url);
      requests.push({ url: url.href, method: event.request.method, scenario });
      assert.equal(url.origin, fixtureOrigin, 'Only synthetic fixture requests are allowed');
      assert.equal(event.request.method, 'GET', 'Export must remain read-only');
      let status = 200;
      let contentType = 'application/json';
      let body;
      if (url.pathname === '/browse/DEMO-42') {
        body = fixtureHtml;
        contentType = 'text/html';
      } else if (url.pathname === '/rest/api/3/issue/DEMO-42') {
        status = scenario === 'api' ? 200 : 403;
        body = JSON.stringify(scenario === 'api' ? apiIssue : { errorMessages: ['Synthetic denied response'] });
      } else if (url.pathname === '/rest/api/3/issue/DEMO-42/comment') {
        const start = Number(url.searchParams.get('startAt'));
        body = JSON.stringify({ startAt: start, maxResults: 1, total: 2, comments: apiComments.slice(start, start + 1) });
      } else {
        status = 404;
        body = '{}';
      }
      await browser.call('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: status,
        responseHeaders: [{ name: 'Content-Type', value: `${contentType}; charset=utf-8` }],
        body: Buffer.from(body).toString('base64'),
      }, sessionId);
    })().catch(error => {
      interceptionErrors.push(error);
      browser.call('Fetch.failRequest', { requestId: event.requestId, errorReason: 'BlockedByClient' }, sessionId).catch(() => {});
    });
  });
  await browser.call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, jiraSession);
  await browser.call('Page.enable', {}, jiraSession);
  await browser.call('Page.navigate', { url: fixtureUrl }, jiraSession);
  await until(() => browser.evaluate(jiraSession, 'document.querySelector("#summary-val")?.textContent'), 'synthetic Jira page');

  async function popup() {
    await browser.call('Target.activateTarget', { targetId: jiraTarget });
    const { targetInfos: tabs } = await browser.call('Target.getTargets', { filter: [{ type: 'tab' }] });
    const jiraTab = tabs.find(target => target.url === fixtureUrl);
    assert.ok(jiraTab, 'Chrome must expose a tab target for the synthetic Jira page');
    await browser.call('Extensions.triggerAction', { id: extensionId, targetId: jiraTab.targetId });
    const target = await until(async () => {
      const { targetInfos } = await browser.call('Target.getTargets');
      return targetInfos.find(target => target.url === `chrome-extension://${extensionId}/popup.html`);
    }, 'extension action popup');
    const { sessionId } = await browser.call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const state = await until(async () => {
      const state = await browser.evaluate(sessionId, `({state: document.querySelector('#notice')?.dataset.state,
        title: document.querySelector('#status-title')?.textContent, detail: document.querySelector('#status-detail')?.textContent,
        markdown: document.querySelector('#markdown')?.value, disabled: document.querySelector('#copy')?.disabled})`);
      return state && !state.disabled && ['success', 'error'].includes(state.state) ? state : null;
    }, 'automatic copy result');
    assert.equal(state.state, 'success', `${state.title}: ${state.detail}`);
    return { ...target, sessionId, markdown: state.markdown };
  }
  async function closePopup(opened) {
    await browser.call('Target.closeTarget', { targetId: opened.targetId });
  }
  async function checkbox(opened, name) {
    await browser.evaluate(opened.sessionId, `document.querySelector('#options').open = true;
      document.querySelector('input[name="${name}"]').click();`, true);
    await until(() => browser.evaluate(opened.sessionId, 'document.querySelector("#notice").dataset.state === "ready"'), 'updated preferences');
  }
  async function copyAgain(opened) {
    await browser.evaluate(opened.sessionId, 'document.querySelector("#copy").click()', true);
    await until(() => browser.evaluate(opened.sessionId, 'document.querySelector("#notice").dataset.state === "success" && !document.querySelector("#copy").disabled'), 'explicit re-copy');
    return browser.evaluate(opened.sessionId, 'document.querySelector("#markdown").value');
  }
  async function clipboard(opened) {
    return browser.evaluate(opened.sessionId, 'navigator.clipboard.readText()', true);
  }

  let opened = await popup();
  assert.match(opened.markdown, /^# DEMO-42 — Synthetic API issue/m);
  assert.match(opened.markdown, /Synthetic API description/);
  assert.match(opened.markdown, /Synthetic reply 1/);
  assert.match(opened.markdown, /Synthetic reply 2/);
  assert.equal(opened.markdown.match(/Synthetic reply 1/g)?.length, 1, 'Embedded and fetched comments must be deduplicated');
  assert.match(opened.markdown, /!\[diagram\.png\]\(https:\/\/demo\.atlassian\.net\/secure\/attachment\/7\/diagram\.png\?token=a%2Bb&download=1\)/);
  assert.ok(!opened.markdown.includes('Additional fields'));
  assert.deepEqual(requests.filter(request => request.url.includes('/comment?')).map(request => new URL(request.url).searchParams.get('startAt')), ['0', '1']);
  // Only the harness receives read permission, after the initial write has
  // succeeded with the extension's original clipboardWrite permission.
  await browser.call('Browser.setPermission', { permission: { name: 'clipboard-read', allowWithoutGesture: true },
    setting: 'granted', origin: `chrome-extension://${extensionId}` });
  assert.equal(await clipboard(opened), opened.markdown, 'Initial popup action must write its generated Markdown');
  console.log('PASS action grants activeTab, extracts API data, paginates comments, and automatically copies');

  const originalClipboard = opened.markdown;
  await checkbox(opened, 'comments');
  await checkbox(opened, 'fields');
  assert.equal(await clipboard(opened), originalClipboard, 'Changing options alone must not overwrite the clipboard');
  const revised = await copyAgain(opened);
  assert.ok(!revised.includes('## Comments'));
  assert.match(revised, /\| Story points \| 8 \|/);
  assert.equal(await clipboard(opened), revised);
  await until(async () => {
    const data = await browser.evaluate(opened.sessionId, 'chrome.storage.local.get("options")');
    return data.options?.comments === false && data.options?.fields === true;
  }, 'saved options');
  await closePopup(opened);
  opened = await popup();
  assert.equal(await browser.evaluate(opened.sessionId, 'document.querySelector("input[name=comments]").checked'), false);
  assert.equal(await browser.evaluate(opened.sessionId, 'document.querySelector("input[name=fields]").checked'), true);
  assert.equal(opened.markdown, revised, 'Reopened popup must use saved preferences');
  assert.equal(await clipboard(opened), revised);
  console.log('PASS option changes require re-copy and persist across popup reopen');

  await checkbox(opened, 'comments');
  await copyAgain(opened);
  await closePopup(opened);
  scenario = 'dom';
  await browser.call('Page.reload', {}, jiraSession);
  await until(() => browser.evaluate(jiraSession, 'document.readyState === "complete" && Boolean(document.querySelector("#summary-val"))'), 'visible page fixture reload');
  opened = await popup();
  const visible = opened.markdown;
  assert.match(visible, /^# DEMO-42 — Synthetic visible issue/m);
  assert.match(visible, /Visible \*\*description\*\*/);
  assert.match(visible, /\[query link\]\(https:\/\/demo\.atlassian\.net\/help\?first=1&second=2\)/);
  assert.match(visible, /4\. Outer item\n   - Nested item/);
  assert.match(visible, /\| literal\\\|pipe \| first  <br>second \|/);
  assert.match(visible, /````js\nconst sample = 1;\n```\n````/);
  assert.match(visible, /Visible \*reply\*/);
  assert.match(visible, /Visible author — 2026-11-04T12:00:00Z/);
  assert.match(visible, /\| Story points \| 13 \|/);
  assert.ok(!visible.includes('Hidden reply'));
  assert.ok(!visible.includes('Do not export this control'));
  assert.equal(visible.match(/spec\.pdf\]\(/g)?.length, 1, 'Duplicate attachment anchors must collapse');
  assert.match(visible, /spec\.pdf\?download=1&token=c%2Bd/);
  assert.match(await browser.evaluate(opened.sessionId, 'document.querySelector("#warnings").textContent'), /HTTP 403.*visible page content.*unloaded content/);
  assert.equal(await browser.evaluate(opened.sessionId, 'document.querySelector("#warnings").hidden'), false);
  assert.equal(await clipboard(opened), visible);
  assert.deepEqual(interceptionErrors, []);
  assert.equal(requests.filter(request => request.scenario === 'dom' && request.url.includes('/rest/')).length, 1, '403 fallback must not retry another API version');
  console.log('PASS API failure exports visible HTML, nested formatting, metadata, comments, attachment queries, and warning');

  const rendererRequests = [];
  await browser.call('Network.enable', {}, opened.sessionId);
  browser.on('Network.requestWillBeSent', (event, sessionId) => {
    if (sessionId === opened.sessionId && event.request.url.startsWith('https://renderer-check.invalid/')) rendererRequests.push(event.request.url);
  });
  // DNS remains blocked; intercept as well so this check cannot contact any
  // remote resource even if a future parsing change makes elements active.
  browser.on('Fetch.requestPaused', (event, sessionId) => {
    if (sessionId !== opened.sessionId || !event.request.url.startsWith('https://renderer-check.invalid/')) return;
    rendererRequests.push(event.request.url);
    browser.call('Fetch.fulfillRequest', { requestId: event.requestId, responseCode: 204, body: '' }, sessionId).catch(() => {});
  });
  await browser.call('Fetch.enable', { patterns: [{ urlPattern: 'https://renderer-check.invalid/*', requestStage: 'Request' }] }, opened.sessionId);
  const inertResult = await browser.evaluate(opened.sessionId, `(async () => {
    const { htmlToMarkdown } = await import(chrome.runtime.getURL('src/markdown.js'));
    return htmlToMarkdown('<p>Passive image <img src="https://renderer-check.invalid/image.png" alt="fixture"></p>' +
      '<iframe src="https://renderer-check.invalid/frame"></iframe>' +
      '<link rel="stylesheet" href="https://renderer-check.invalid/style.css">' +
      '<video poster="https://renderer-check.invalid/poster.png"><source src="https://renderer-check.invalid/video.mp4"></video>' +
      '<style>body { background-image: url("https://renderer-check.invalid/background.png"); }</style>',
      { baseUrl: '${fixtureUrl}' });
  })()`);
  await delay(1000);
  assert.match(inertResult, /!\[fixture\]\(https:\/\/renderer-check\.invalid\/image\.png\)/);
  assert.deepEqual(rendererRequests, [], 'Converting HTML must not load referenced remote resources');
  console.log('PASS HTML conversion makes no image, iframe, stylesheet, video, or background resource requests');
  console.log('Browser smoke checks passed; isolated browser and profile cleaned up.');
} finally {
  await cleanup();
}
