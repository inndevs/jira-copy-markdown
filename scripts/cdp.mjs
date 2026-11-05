// Development helper for rendering local assets with an existing Chrome session.
export async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (!message.id) return;
    const task = pending.get(message.id);
    if (!task) return;
    clearTimeout(task.timer);
    pending.delete(message.id);
    message.error ? task.reject(new Error(message.error.message)) : task.resolve(message.result);
  };
  socket.onclose = () => {
    for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('Chrome target closed')); }
    pending.clear();
  };
  return {
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 30000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    async evaluate(expression) {
      const result = await this.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    },
    close() { socket.close(); }
  };
}

export async function temporaryPage(callback) {
  const endpoint = `http://127.0.0.1:${process.env.CHROME_DEBUG_PORT || '9223'}`;
  const { webSocketDebuggerUrl } = await fetch(`${endpoint}/json/version`).then(r => r.json());
  const browser = await connect(webSocketDebuggerUrl);
  const url = `data:text/html,<title>jira-copy-markdown-assets-${Date.now()}</title>`;
  const { targetId } = await browser.call('Target.createTarget', { url, background: true });
  let page;
  try {
    let target;
    for (let attempt = 0; attempt < 30; attempt++) {
      target = (await fetch(`${endpoint}/json/list`).then(r => r.json())).find(t => t.url === url);
      if (target) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!target) throw new Error('Chrome did not create the asset page.');
    page = await connect(target.webSocketDebuggerUrl);
    return await callback(page);
  } finally {
    page?.close();
    await browser.call('Target.closeTarget', { targetId });
    browser.close();
  }
}
