import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function until(check, description, timeout = 10000) {
  const end = Date.now() + timeout;
  let lastError;
  do {
    try { const value = await check(); if (value) return value; }
    catch (error) { lastError = error; }
    await delay(50);
  } while (Date.now() < end);
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`);
}

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  const listeners = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) {
      for (const listener of listeners.get(message.method) || []) listener(message.params, message.sessionId);
      return;
    }
    const task = pending.get(message.id);
    if (!task) return;
    clearTimeout(task.timer);
    pending.delete(message.id);
    message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
  };
  socket.onclose = () => {
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('Chrome closed')); }
    pending.clear();
  };
  return {
    call(method, params = {}, sessionId) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 10000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
    on(method, listener) {
      if (!listeners.has(method)) listeners.set(method, []);
      listeners.get(method).push(listener);
    },
    async evaluate(sessionId, expression, userGesture = false) {
      const result = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture }, sessionId);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    },
    close() { socket.close(); }
  };
}

// Every run owns a temporary profile; the signed-in browser is never used.
export async function launchChrome(flags = []) {
  const candidates = process.env.CHROME_BIN ? [process.env.CHROME_BIN] : [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ];
  let executable;
  for (const candidate of candidates) {
    try { await access(candidate); executable = candidate; break; } catch {}
  }
  if (!executable) throw new Error('Chrome not found. Set CHROME_BIN.');
  const profile = await mkdtemp(join(tmpdir(), 'jira-markdown-'));
  const chrome = spawn(executable, [
    '--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--disable-sync', `--user-data-dir=${profile}`, ...flags, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  let browser;
  let closed = false;
  const onSignal = () => close().finally(() => process.exit(1));
  async function close() {
    if (closed) return;
    closed = true;
    for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, onSignal);
    if (browser) {
      await browser.call('Browser.close').catch(() => {});
      browser.close();
    }
    if (chrome.exitCode === null) {
      chrome.kill('SIGTERM');
      await Promise.race([new Promise(resolve => chrome.once('exit', resolve)), delay(3000)]);
      if (chrome.exitCode === null) chrome.kill('SIGKILL');
    }
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, onSignal);
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chrome startup timed out')), 20000);
      chrome.once('error', error => { clearTimeout(timer); reject(error); });
      chrome.once('exit', code => { clearTimeout(timer); reject(new Error(`Chrome exited (${code})`)); });
      let output = '';
      chrome.stderr.on('data', data => {
        output = (output + data).slice(-8192);
        const match = output.match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timer); resolve(match[1]); }
      });
    });
    browser = await connect(endpoint);
    const { targetId } = await browser.call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.call('Target.attachToTarget', { targetId, flatten: true });
    const page = {
      call: (method, params) => browser.call(method, params, sessionId),
      evaluate: expression => browser.evaluate(sessionId, expression),
    };
    return { browser, page, targetId, sessionId, close };
  } catch (error) {
    await close();
    throw error;
  }
}
