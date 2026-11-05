# Privacy policy

Jira Copy Markdown is maintained by inndevs. This policy describes the extension's handling of data. Last updated: November 5, 2026.

## What the extension accesses

When you click the extension's toolbar icon, its popup opens and automatically reads the current Jira issue and copies a Markdown export. The data read can include the issue key, URL, title, description, issue fields, comments, author or assignee names, and attachment names and URLs. Issue text and comments can contain personal information, such as names or email addresses, or other information entered by Jira users. Content options determine what appears in the export; they do not prevent the initial reading of available issue data.

The extension requests issue data over HTTPS from the same Jira site through its REST API using your existing signed-in session. Your browser applies the site's normal authentication to these requests. The extension does not ask for, extract, or store your Jira password, API token, or session cookie. If API access fails, it can read issue content rendered in the current page instead.

The current page URL is used to identify the issue and create links. The extension does not access your browser history or monitor the other websites you visit. It does not read Jira content in the background.

## How data is used and stored

Issue data is processed in browser memory only to create your requested Markdown. It is not saved in the extension's persistent storage. Export preferences are stored on your device using Chrome's local extension storage; the extension does not sync them through a cloud account.

The generated Markdown is written to your operating system clipboard. It can include personal or confidential issue content. Clipboard contents remain subject to your operating system's clipboard retention, history, and synchronization settings, and can be read by applications with clipboard access. Pasting or sharing the export is under your control.

Attachment files are not downloaded. Only attachment names and links are included in the export.

## Data sharing

The extension has no developer-operated server, analytics, advertising, or telemetry. It does not send issue content, preferences, or browsing data to inndevs or to third-party services. Network requests for issue data go to the Jira site you are using, whose operator may record those requests under its own policies. The extension does not sell data or use it for advertising, profiling, or lending decisions.

The use of user data by Jira Copy Markdown complies with the Chrome Web Store User Data Policy, including its Limited Use requirements.

## Your controls

You choose when to run an export and which available content options to include. To remove saved preferences, remove the extension from Chrome. To remove an export from the clipboard, replace or clear it using your operating system's controls; if clipboard history or synchronization is enabled, manage those copies there as well. Removing the extension does not delete copies you have pasted elsewhere or change data stored in Jira.

## Questions and updates

For questions about this policy, open an issue in the [project repository](https://github.com/inndevs/jira-copy-markdown/issues). GitHub issues are public; do not include private Jira content or credentials. This policy will be updated when the extension's data handling changes.
