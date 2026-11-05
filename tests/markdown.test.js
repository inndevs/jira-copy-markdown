import test from "node:test";
import assert from "node:assert/strict";
import { adfToMarkdown, htmlToMarkdown, renderIssue } from "../src/markdown.js";

const text = (value, marks) => ({ type: "text", text: value, ...(marks ? { marks } : {}) });
const paragraph = (...content) => ({ type: "paragraph", content });
const doc = (...content) => ({ type: "doc", version: 1, content });
const item = (...content) => ({ type: "listItem", content });
const baseUrl = "https://example.atlassian.net/browse/DEMO-12?view=detail";

test("renders ADF headings, marks, readable inline nodes and a hard break", () => {
  const result = adfToMarkdown(doc(
    { type: "heading", attrs: { level: 2 }, content: [text("A [heading]")] },
    paragraph(text("Bold", [{ type: "strong" }]), text(" and "), text("emphasis", [{ type: "em" }]), { type: "hardBreak" },
      { type: "mention", attrs: { text: "@Person" } }, text(" "), { type: "emoji", attrs: { text: "😀" } }, text(" "),
      { type: "status", attrs: { text: "In progress" } }),
    { type: "rule" },
  ));
  assert.equal(result, "## A \\[heading\\]\n\n**Bold** and *emphasis*  \n@Person 😀 **In progress**\n\n---");
});

test("escapes literal syntax, HTML and accidental list markers", () => {
  const result = adfToMarkdown(doc(paragraph(text("# title\n- item\n1. item\n[x] *raw* <script> &copy;"))));
  assert.equal(result, "\\# title\n\\- item\n1\\. item\n\\[x\\] \\*raw\\* \\<script\\> &amp;copy;");
});

test("literal underline-like lines do not become headings or horizontal rules", () => {
  const result = adfToMarkdown(doc(paragraph(text("Title\n===\n---\n+"))));
  assert.equal(result, "Title\n\\===\n\\---\n\\+");
});

test("formats edge whitespace outside emphasis and combines a link with inline code", () => {
  const result = adfToMarkdown(doc(paragraph(
    text(" bold ", [{ type: "strong" }]),
    text("`cmd`", [{ type: "code" }, { type: "link", attrs: { href: "../help?q=one&next=two#details" } }]),
  )), { baseUrl });
  assert.equal(result, "**bold** [`` `cmd` ``](https://example.atlassian.net/help?q=one&next=two#details)");
});

test("relative URLs resolve against the source and queries survive Markdown delimiters", () => {
  const result = adfToMarkdown(doc(paragraph(text("download", [{ type: "link", attrs: {
    href: "/secure/attachment/42/figure (final).png?download=1&token=a%2Bb#preview",
  } }]))), { baseUrl });
  assert.equal(result, "[download](https://example.atlassian.net/secure/attachment/42/figure%20%28final%29.png?download=1&token=a%2Bb#preview)");
});

test("unsafe URL schemes retain their label without active links", () => {
  const result = adfToMarkdown(doc(paragraph(text("click", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]))), { baseUrl });
  assert.equal(result, "click");
});

test("nested lists preserve ordered starts and align continuation paragraphs", () => {
  const result = adfToMarkdown(doc({ type: "orderedList", attrs: { order: 9 }, content: [
    item(paragraph(text("First")), { type: "bulletList", content: [
      item(paragraph(text("Nested")), { type: "orderedList", attrs: { order: 3 }, content: [item(paragraph(text("Deep")))] }),
    ] }),
    item(paragraph(text("Second")), paragraph(text("Continuation"))),
  ] }));
  assert.equal(result, "9. First\n   - Nested\n     3. Deep\n10. Second\n\n    Continuation");
});

test("code fences exceed embedded backticks and preserve source indentation", () => {
  const source = "  const sample = `x`;\n```\n\n  end";
  const result = adfToMarkdown(doc({ type: "codeBlock", attrs: { language: "javascript" }, content: [text(source)] }));
  assert.equal(result, `\`\`\`\`javascript\n${source}\n\`\`\`\``);
});

test("tables escape pipes, retain multiline cells, and keep a real header", () => {
  const cell = (type, ...content) => ({ type, content });
  const result = adfToMarkdown(doc({ type: "table", content: [
    { type: "tableRow", content: [cell("tableHeader", paragraph(text("Name"))), cell("tableHeader", paragraph(text("Notes")))] },
    { type: "tableRow", content: [cell("tableCell", paragraph(text("A|B"))), cell("tableCell", paragraph(text("first")), paragraph(text("second")))] },
  ] }));
  assert.equal(result, "| Name | Notes |\n| --- | --- |\n| A\\|B | first<br>second |");
});

test("headerless tables keep the first row as data and pad merged cells", () => {
  const result = adfToMarkdown(doc({ type: "table", content: [
    { type: "tableRow", content: [{ type: "tableCell", attrs: { colspan: 2 }, content: [paragraph(text("Wide"))] }] },
    { type: "tableRow", content: ["Left", "Right"].map((value) => ({ type: "tableCell", content: [paragraph(text(value))] })) },
  ] }));
  assert.equal(result, "|  |  |\n| --- | --- |\n| Wide |  |\n| Left | Right |");
});

test("blockquotes and unknown containers preserve readable descendant content", () => {
  const result = adfToMarkdown(doc({ type: "blockquote", content: [paragraph(text("First")), paragraph(text("Second"))] },
    { type: "futureContainer", content: [paragraph(text("Retained"))] }));
  assert.equal(result, "> First\n>\n> Second\n\nRetained");
});

test("matching ADF media embeds an image and retains signed attachment query strings", () => {
  const result = adfToMarkdown(doc({ type: "mediaSingle", content: [{ type: "media", attrs: { id: "media-42" } }] }), {
    baseUrl, attachments: [{ id: "42", mediaId: "media-42", name: "screen.png", mimeType: "image/png", url: "/attachment/42?token=secret&expires=123" }],
  });
  assert.equal(result, "![screen.png](https://example.atlassian.net/attachment/42?token=secret&expires=123)");
});

test("missing and ambiguous media produce source links rather than broken images", () => {
  const mediaDoc = doc({ type: "mediaSingle", content: [{ type: "media", attrs: { id: "unmapped", alt: "screen.png" } }] });
  const result = adfToMarkdown(mediaDoc, { baseUrl, attachments: [
    { id: "1", name: "screen.png", url: "/first" }, { id: "2", name: "screen.png", url: "/second" },
  ] });
  assert.equal(result, `[screen.png — view in Jira](${baseUrl})`);
  assert.ok(!result.includes("!["));
  assert.equal(adfToMarkdown(mediaDoc), "screen.png (media unavailable)");
});

test("HTML fallback keeps readable text and removes executable or styling text", () => {
  assert.equal(typeof DOMParser, "undefined");
  const result = htmlToMarkdown('<p>Hello <strong>world</strong> &amp; &#x1F600;</p><script>alert(1)</script><style>body { color: red; }</style><p>&lt;literal&gt;<br>next</p>');
  assert.equal(result, "Hello world & 😀\n\n\\<literal\\>\nnext");
});

const issue = {
  key: "DEMO-12", title: "Markdown export", url: baseUrl,
  fields: [{ name: "Status", value: "In progress" }],
  description: { adf: doc(paragraph(text("ADF description"))), html: "<p>HTML fallback</p>", text: "Text fallback" },
  customFields: [{ name: "Team", value: ["One", "Two"] }],
  sections: [{ name: "Related issues", body: { text: "DEMO-11" } }],
  comments: [{ id: "1", author: "Test Person", created: "2026-11-05T10:00:00Z", body: { text: "A comment" } }],
  attachments: [{ id: "1", name: "spec.pdf", url: "/attachment/1?download=true", size: 1024 }],
};

test("issue defaults include all ordinary sections and omit opt-in custom fields", () => {
  const result = renderIssue(issue);
  for (const expected of ["# DEMO-12 — Markdown export", `Source: [${baseUrl}](${baseUrl})`, "## Details", "| Status | In progress |", "## Description", "ADF description", "## Related issues", "## Attachments", "## Comments", "A comment"]) {
    assert.ok(result.includes(expected), `Missing: ${expected}`);
  }
  assert.ok(!result.includes("Additional fields"));
  assert.ok(!result.includes("HTML fallback"));
  assert.ok(!result.includes("Text fallback"));
  assert.ok(result.endsWith("\n"));
});

test("options independently disable sections while keeping title and source", () => {
  const result = renderIssue(issue, { description: false, comments: false, metadata: false, attachments: false, sections: false, fields: true });
  assert.ok(result.startsWith("# DEMO-12 — Markdown export\n\nSource:"));
  assert.ok(result.includes("## Additional fields\n\n| Field | Value |\n| --- | --- |\n| Team | One, Two |"));
  for (const omitted of ["## Details", "## Description", "## Comments", "## Attachments", "## Related issues"]) assert.ok(!result.includes(omitted));
});

test("empty rich text falls back to text and absent normalized arrays are safe", () => {
  const result = renderIssue({ key: "DEMO-1", url: baseUrl, description: { adf: doc(), text: "Fallback" } });
  assert.ok(result.includes("## Description\n\nFallback"));
  assert.ok(!result.includes("undefined"));
  assert.equal(adfToMarkdown(null), "");
  assert.equal(adfToMarkdown({}), "");
});
