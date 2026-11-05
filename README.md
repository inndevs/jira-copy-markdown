# Jira Ticket – Copy as Markdown

Click the extension on an HTTPS Jira issue to copy it as Markdown. Choose which details to include, then click **Copy Markdown** to update the clipboard. Options are saved locally; **View Markdown** shows the output.

![Extension popup and Markdown output](store/screenshot-1280x800.png)

Uses your Jira session. If the API is unavailable, it copies visible page content and warns about missing details. Attachments remain links requiring Jira access.

## Install

```sh
git clone https://github.com/inndevs/jira-ticket-copy-as-markdown.git
```

Open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose the cloned folder. No build or dependencies required.

## Develop

```sh
npm test
npm run test:browser
npm run package
node scripts/render-store-assets.mjs
node scripts/render-icons.mjs
```

Requires Node.js, Python 3, and Chrome. Set `CHROME_BIN` for a custom Chrome location. Browser tests and screenshots use isolated profiles and fictional data. Reload the extension after edits. The package is written to `dist/`.

## Privacy and support

Issue data stays in your browser and clipboard. Only preferences are stored. Permissions: `activeTab` and `scripting` read the selected issue; `storage` saves options; `clipboardWrite` copies Markdown. See [Privacy](PRIVACY.md).

[Report issues](https://github.com/inndevs/jira-ticket-copy-as-markdown/issues) without private Jira data. Independent extension by [inndevs](https://github.com/inndevs), unaffiliated with Atlassian. [MIT License](LICENSE).
