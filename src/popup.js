import { renderIssue } from './markdown.js';
import { copyText } from './clipboard.js';

const defaults = { description: true, metadata: true, comments: true, attachments: true, sections: true, fields: false };
const find = (id) => document.getElementById(id);
const inputs = [...document.querySelectorAll('input[type="checkbox"]')];
let tab;
let issue;
let working = false;

function preferences() { return Object.fromEntries(inputs.map((input) => [input.name, input.checked])); }
function status(state, title, detail) {
  find('notice').dataset.state = state;
  find('status-icon').textContent = { success: '✓', error: '!', loading: '…', ready: '↗' }[state];
  find('status-title').textContent = title;
  find('status-detail').textContent = detail;
}
function markdown() {
  const result = renderIssue(issue, preferences());
  find('markdown').value = result;
  return result;
}
function showIssue() {
  find('issue').hidden = false;
  find('options').hidden = false;
  find('preview').hidden = false;
  find('issue-key').textContent = issue.key;
  find('issue-title').textContent = issue.title;
  find('issue-type').textContent = issue.fields.find((field) => field.name === 'Type')?.value || '';
  find('issue-counts').textContent = `${issue.comments.length} comments · ${issue.attachments.length} attachments`;
  find('warnings').textContent = (issue.warnings || []).join(' ');
  find('warnings').hidden = !issue.warnings?.length;
}
async function readIssue() {
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content.js'] });
  const response = await chrome.tabs.sendMessage(tab.id, { action: 'readIssue' });
  if (!response?.ok) throw new Error(response?.error || 'Could not read this Jira issue.');
  if (!response.issue?.key || !response.issue.title) throw new Error('Open a Jira issue and try again.');
  return response.issue;
}
async function run() {
  if (working || !tab) return;
  working = true;
  find('copy').disabled = true;
  try {
    if (!issue) {
      status('loading', 'Reading your issue', 'Keep this popup open while the Markdown is prepared.');
      issue = await readIssue();
      showIssue();
    }
    try {
      await copyText(markdown());
      status('success', 'Copied to clipboard', `${issue.key} is ready to paste with ⌘V or Ctrl+V.`);
      find('copy').textContent = 'Copy again';
    } catch {
      status('error', 'Copy needs another try', 'Click Copy Markdown, or copy the selected text below.');
      find('copy').textContent = 'Copy Markdown';
      find('preview').open = true;
      find('markdown').focus();
      find('markdown').select();
    }
  } catch (error) {
    status('error', 'Could not read this issue', error.message || 'Refresh Jira, open an issue and try again.');
    find('copy').textContent = 'Try again';
  } finally {
    working = false;
    find('copy').disabled = false;
  }
}
for (const input of inputs) {
  input.addEventListener('change', async () => {
    if (issue) {
      markdown();
      find('copy').textContent = 'Copy Markdown';
      status('ready', 'Options updated', 'Click Copy Markdown to update the clipboard.');
    }
    try { await chrome.storage.local.set({ options: preferences() }); }
    catch { status('error', 'Options could not be saved', 'You can still copy with the selected options.'); }
  });
}
find('copy').addEventListener('click', run);

async function start() {
  const { options = {} } = await chrome.storage.local.get('options');
  for (const input of inputs) input.checked = typeof options[input.name] === 'boolean' ? options[input.name] : defaults[input.name];
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = new URL(tab?.url || 'about:blank');
  if (url.protocol !== 'https:') {
    status('ready', 'Open a Jira issue', 'Use an HTTPS Jira page, then click this extension to copy it as Markdown.');
    find('copy').hidden = true;
    return;
  }
  await run();
}
start().catch((error) => {
  status('error', 'Could not start', error.message || 'Please reopen the extension.');
  find('copy').hidden = true;
});
