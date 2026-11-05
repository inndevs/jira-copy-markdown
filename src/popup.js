import { renderIssue } from './markdown.js';
import { copyText } from './clipboard.js';

const find = (id) => document.getElementById(id);
const inputs = [...document.querySelectorAll('input[type="checkbox"]')];
const copy = find('copy');
const preview = find('markdown');
let tab;
let issue;

function preferences() { return Object.fromEntries(inputs.map((input) => [input.name, input.checked])); }
function status(state, title, detail) {
  find('notice').dataset.state = state;
  find('status-icon').textContent = { success: '✓', error: '!', loading: '…', ready: '↗' }[state];
  find('status-title').textContent = title;
  find('status-detail').textContent = detail;
}
function markdown() {
  preview.value = renderIssue(issue, preferences());
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
  markdown();
}
async function readIssue() {
  const [{ result: response }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['src/content.js'] });
  if (!response?.ok) throw new Error(response?.error || 'Could not read this Jira issue.');
  if (!response.issue?.key || !response.issue.title) throw new Error('Open a Jira issue and try again.');
  return response.issue;
}
async function run() {
  copy.disabled = true;
  try {
    if (!issue) {
      status('loading', 'Reading your issue', 'Keep this popup open while the Markdown is prepared.');
      issue = await readIssue();
      showIssue();
    }
    try {
      await copyText(preview.value);
      status('success', 'Copied to clipboard', `${issue.key} is ready to paste with ⌘V or Ctrl+V.`);
      copy.textContent = 'Copy again';
    } catch {
      status('error', 'Copy needs another try', 'Click Copy Markdown, or copy the selected text below.');
      copy.textContent = 'Copy Markdown';
      find('preview').open = true;
      preview.focus();
      preview.select();
    }
  } catch (error) {
    status('error', 'Could not read this issue', error.message || 'Refresh Jira, open an issue and try again.');
    copy.textContent = 'Try again';
  } finally {
    copy.disabled = false;
  }
}
for (const input of inputs) {
  input.addEventListener('change', async () => {
    if (issue) {
      markdown();
      copy.textContent = 'Copy Markdown';
      status('ready', 'Options updated', 'Click Copy Markdown to update the clipboard.');
    }
    try { await chrome.storage.local.set({ options: preferences() }); }
    catch { status('error', 'Options could not be saved', 'You can still copy with the selected options.'); }
  });
}
copy.addEventListener('click', run);

async function start() {
  const [{ options = {} }, tabs] = await Promise.all([
    chrome.storage.local.get('options'),
    chrome.tabs.query({ active: true, currentWindow: true }),
  ]);
  for (const input of inputs) if (typeof options[input.name] === 'boolean') input.checked = options[input.name];
  [tab] = tabs;
  const url = new URL(tab?.url || 'about:blank');
  if (url.protocol !== 'https:') {
    status('ready', 'Open a Jira issue', 'Use an HTTPS Jira page, then click this extension to copy it as Markdown.');
    copy.hidden = true;
    return;
  }
  await run();
}
start().catch((error) => {
  status('error', 'Could not start', error.message || 'Please reopen the extension.');
  copy.hidden = true;
});
