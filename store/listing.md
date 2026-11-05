# Chrome Web Store listing draft

## Name

Jira Ticket – Copy as Markdown

## Summary

Copy the Jira issue you have open as Markdown, with options for issue details, comments, and attachment links.

## Description

Turn the Jira issue you are viewing into Markdown for notes, documents, and pull requests.

Open an issue over HTTPS and click the extension icon. The extension reads the issue and copies Markdown automatically, using your saved preferences. Paste the result into any editor that accepts plain text. To adjust the output, change the options in the popup and click Copy Markdown again. Description, metadata, comments, attachment links, and extra sections are enabled by default. Additional field values can be enabled under Custom fields. A text preview lets you review or manually copy the result.

Attachments are represented by links, so their existing Jira access controls still apply.

The extension requests issue data from your current Jira site using your existing signed-in session. If the API is unavailable, it tries the issue content displayed on the page. Export completeness depends on the Jira version, layout, and content available to your account.

When you open the extension popup, it handles the current issue URL, issue text, fields and comments, and any personal information they contain, such as names or email addresses. Options control the exported text; available issue data is read regardless of those options. Processing happens in your browser. The generated text is written to your operating system clipboard, and export preferences are saved locally. Issue content is not sent to the developer or analytics services. There is no background collection, advertising, or telemetry.

An independent open-source extension by inndevs. Not affiliated with or endorsed by Atlassian.

## Links

- Homepage: https://github.com/inndevs/jira-copy-markdown
- Support: https://github.com/inndevs/jira-copy-markdown/issues
- Privacy policy: https://github.com/inndevs/jira-copy-markdown/blob/main/PRIVACY.md

## Single purpose

Convert the Jira issue currently opened by the user into Markdown and copy it to the clipboard, with user-selected issue content.

## Permission justifications

| Permission | Justification |
| --- | --- |
| `activeTab` | Grants temporary access to the current tab after the user invokes the extension so it can identify and read the requested Jira issue. |
| `scripting` | Injects the packaged issue-reading code into that tab when the user opens the extension popup or retries a failed read. |
| `storage` | Saves export preferences in `chrome.storage.local`. Issue content is not persisted there. |
| `clipboardWrite` | Writes the generated Markdown to the operating system clipboard when the user requests a copy. |

Host permissions: none. No background content scripts are registered.

## Remote code

No. All executable JavaScript is included in the extension package. Jira REST responses are parsed as data, not executed as code. No scripts are loaded from a CDN or other remote source.

## Privacy declarations draft

Local processing is data handling and must be disclosed. The following proposed declarations reflect the data the extension reads, even though it does not send that data to the developer. Confirm the dashboard's current wording when submitting. [Chrome's user data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) explicitly covers local processing and website URLs.

| Data type | Proposed declaration and scope |
| --- | --- |
| Website content | Yes. Issue titles, descriptions, fields, comments, and attachment metadata are read to generate Markdown. |
| Personally identifiable information | Yes. Issue fields or content can contain names, usernames, email addresses, and other personal information. |
| Personal communications | Yes. Jira comments and their authors are read to prepare the export. |
| Web history | Yes, limited to the current issue URL used for identification and links. The extension does not use the history API or record a browsing history. |
| Authentication information | The browser uses the existing Jira session for same-origin requests. Extension code does not read or store passwords, API tokens, or authentication cookies. |
| Health information; financial and payment information; location | Not specifically requested or analyzed as structured data. Free-form Jira content may contain such information and is handled only as part of the user-requested export. |
| User activity | No interaction tracking, keylogging, click tracking, or analytics. Opening the extension runs the requested export. |

The declared purpose for the data above is the extension's single export feature. Issue content is processed in browser memory and the generated Markdown is copied to the operating system clipboard. Only preferences are saved in local extension storage. API requests go to the Jira site being viewed; no user data goes to developer servers or advertisers.

Certifications supported by the implementation: data is not sold or transferred to third parties outside the approved use cases; data is not used or transferred for purposes unrelated to the single purpose; data is not used or transferred to determine creditworthiness or for lending. Review these against the final submitted code and the [Chrome Web Store policies](https://developer.chrome.com/docs/webstore/program-policies/policies/).

## Reviewer instructions

1. Install the submitted extension in Chrome.
2. Open a Jira issue on a test Jira site over HTTPS. Sign in with a test account authorized to view that issue. Use fictional issue content with a description, a comment, and an attachment link.
3. Open the extension popup. Confirm it reads the issue and automatically copies Markdown.
4. Paste into a plain-text editor. Confirm the issue heading and link, description, comment text, and attachment links. Change the content options and click Copy Markdown to verify the updated output. Confirm the options are remembered after reopening the popup.
5. Open a non-Jira page and invoke the extension. Confirm a useful message appears instead of an unrelated export.
6. If the test site permits it, make its issue REST endpoint unavailable while leaving the issue page loaded. Repeat the copy to check the visible-page fallback and any completeness message.

No account with the extension developer, API key, payment, or separate service is required. Jira authorization is required for the chosen test issue. If the review team needs access to a hosted demo, provide a separate account containing only fictional data through the developer dashboard's private reviewer instructions. Never put real credentials or private issue data in this public file.

## Release assets

- Extension ZIP: `dist/jira-copy-markdown-VERSION.zip`, produced by `python3 scripts/package.py`.
- Store icon: `icons/icon128.png`.
- Screenshot: `store/screenshot-1280x800.png`, rendered from the actual popup with fictional issue data. Regenerate with `node scripts/render-store-assets.mjs`.

This file is a submission draft, not a record of publication or approval.
