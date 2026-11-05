# Chrome Web Store

## Name

Jira Ticket – Copy as Markdown

## Description

Copy a Jira ticket as Markdown with one click. Choose descriptions, metadata, comments, attachment links, extra sections, or custom fields. Preview the Markdown and save your preferences for next time.

Uses your existing Jira session. If the API is unavailable, it exports visible page content and warns about missing details. Attachment links retain Jira's access controls.

Issue data is processed in your browser and copied to the clipboard. Only preferences are stored locally. No analytics, advertising, or developer servers.

Independent open-source extension by inndevs. Not affiliated with Atlassian.

## Links

- Homepage: https://github.com/inndevs/jira-ticket-copy-as-markdown
- Support: https://github.com/inndevs/jira-ticket-copy-as-markdown/issues
- Privacy: https://github.com/inndevs/jira-ticket-copy-as-markdown/blob/main/PRIVACY.md

## Purpose and permissions

Copy the current Jira issue as Markdown.

| Permission | Purpose |
| --- | --- |
| `activeTab` | Access the current tab when invoked. |
| `scripting` | Read the selected Jira issue. |
| `storage` | Save export preferences locally. |
| `clipboardWrite` | Copy Markdown to the clipboard. |

No host permissions, background scripts, or remote executable code.

## Data disclosures

- Website content: issue text, fields, comments, attachment metadata.
- Personally identifiable information: names and personal information in issue content.
- Personal communications: comments and authors.
- Web history: current issue URL only; no browsing-history access.

Data is used only for the requested export. No sales, unrelated use, or creditworthiness decisions.

## Reviewer instructions

Open an HTTPS Jira issue using a test account. Click the extension, paste the Markdown, change content options, and copy again. Reopen to verify saved preferences. If the REST API fails, visible-page export shows a warning. No separate account, API key, or payment is required.

## Assets

- ZIP: `dist/jira-ticket-copy-as-markdown-VERSION.zip`
- Icon: `icons/icon128.png`
- Screenshot: `store/screenshot-1280x800.png`
