import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../src/content.js", import.meta.url), "utf8");
const adf = value => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: value }] }] });
const comment = (id, value = "Reply") => ({ id: String(id), author: { displayName: "Alex" }, created: `2026-10-01T12:00:00.000Z`, body: adf(value) });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const emptyDocument = { querySelector: () => null, querySelectorAll: () => [] };

function browser({ href = "https://example.atlassian.net/browse/TEAM-42", fetch: respond, document = emptyDocument } = {}) {
  const requests = [];
  const listeners = [];
  const context = vm.createContext({ URL, AbortController, setTimeout, clearTimeout, location: { href }, document,
    chrome: { runtime: { onMessage: { addListener: listener => listeners.push(listener) } } },
    fetch: async (url, options) => { requests.push({ url, options }); return respond(url, options); }
  });
  const install = () => vm.runInContext(source, context);
  install();
  return { requests, listeners, install, read: () => new Promise(resolve => {
    assert.equal(listeners[0]({ action: "readIssue" }, {}, resolve), true);
  }) };
}

function node(value, attrs = {}, matches = {}) {
  const result = {
    textContent: value, innerText: value, innerHTML: attrs.html || value, id: attrs.id || "",
    getAttribute: name => attrs[name] ?? null, closest: () => null,
    querySelector: selector => matches[selector]?.[0] || null,
    querySelectorAll: selector => matches[selector] || [],
    cloneNode: () => result
  };
  return result;
}

test("injection is idle and idempotent, and unrelated messages are ignored", () => {
  const page = browser();
  page.install();
  assert.equal(page.listeners.length, 1);
  assert.equal(page.requests.length, 0);
  assert.equal(page.listeners[0]({ action: "somethingElse" }, {}, () => assert.fail()), false);
});

test("HTTP pages are rejected before any authenticated request", async () => {
  const page = browser({ href: "http://jira.example.test/browse/TEAM-1" });
  const result = await page.read();
  assert.equal(result.ok, false);
  assert.match(result.error, /HTTPS/);
  assert.equal(page.requests.length, 0);
});

test("reads the current issue over same-origin GET and preserves rich content and useful metadata", async () => {
  const page = browser({ fetch: url => url.includes("/comment?") ? response({ comments: [], total: 0, startAt: 0 }) : response({ key: "TEAM-42", names: { customfield_100: "Story points", customfield_101: "Acceptance criteria", customfield_102: "Choice" },
    fields: { summary: "Export the issue", description: adf("A rich description"), issuetype: { name: "Task" }, status: { name: "In progress" }, assignee: null, reporter: { displayName: "Hannes" }, labels: ["export", "docs"], customfield_100: 5, customfield_101: adf("Done when tested"), customfield_102: { value: "Parent", child: { value: "Child" } }, environment: "Chrome", parent: { key: "TEAM-2", fields: { summary: "Project" } }, attachment: [{ id: "88", filename: "image.png", content: "https://example.atlassian.net/attachment/88", mimeType: "image/png", size: 300 }], issuelinks: [{ type: { outward: "blocks" }, outwardIssue: { key: "TEAM-3", fields: { summary: "Release" } } }] }, renderedFields: { description: "<p>A rich description</p>" }
  }) });
  const result = await page.read();
  assert.equal(result.ok, true);
  assert.equal(result.issue.title, "Export the issue");
  assert.equal(result.issue.description.adf.content[0].content[0].text, "A rich description");
  assert.equal(result.issue.description.html, "<p>A rich description</p>");
  assert.equal(result.issue.fields.find(item => item.name === "Assignee").value, "Unassigned");
  assert.equal(result.issue.fields.find(item => item.name === "Parent").value, "TEAM-2 — Project");
  assert.equal(result.issue.customFields.find(item => item.name === "Story points").value, "5");
  assert.equal(result.issue.customFields.find(item => item.name === "Choice").value, "Parent / Child");
  assert.ok(result.issue.sections.find(item => item.name === "Acceptance criteria").body.adf);
  assert.equal(result.issue.sections.find(item => item.name === "Linked issues").body.text, "blocks: TEAM-3 — Release");
  assert.equal(result.issue.attachments[0].id, "88");
  assert.equal(result.issue.warnings, undefined);
  const api = new URL(page.requests[0].url);
  assert.equal(api.pathname, "/rest/api/3/issue/TEAM-42");
  assert.equal(api.searchParams.get("fields"), "*all");
  assert.equal(api.searchParams.get("expand"), "names,renderedFields");
  for (const { url, options } of page.requests) {
    assert.equal(new URL(url).origin, "https://example.atlassian.net");
    assert.equal(options.credentials, "include");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
  }
});

test("selectedIssue takes precedence and digit/underscore project keys retain Jira context paths", async () => {
  const page = browser({ href: "https://jira.example.test/jira/browse/OLD-1?selectedIssue=OPS_2-17", fetch: url => url.includes("/comment?") ? response({ comments: [], total: 0 }) : response({ fields: { summary: "Selected issue" } }) });
  const result = await page.read();
  assert.equal(result.issue.key, "OPS_2-17");
  assert.equal(result.issue.url, "https://jira.example.test/jira/browse/OPS_2-17");
  assert.equal(new URL(page.requests[0].url).pathname, "/jira/rest/api/3/issue/OPS_2-17");
});

test("issueKey works on legacy boards and API v2 is tried when v3 is unsupported", async () => {
  const page = browser({ href: "https://jira.example.test/company/secure/RapidBoard.jspa?issueKey=A_2-19", fetch: url => {
    if (url.includes("/api/3/")) return response({}, 404);
    return url.includes("/comment?") ? response({ comments: [{ ...comment(20), body: "A server comment", renderedBody: "<p>A server comment</p>" }], total: 1 }) : response({ fields: { summary: "Server issue", description: "wiki-style text" }, renderedFields: { description: "<p>Rendered description</p>" } });
  } });
  const result = await page.read();
  assert.equal(result.ok, true);
  assert.equal(page.requests.length, 3);
  assert.equal(new URL(page.requests[1].url).pathname, "/company/rest/api/2/issue/A_2-19");
  assert.equal(result.issue.description.html, "<p>Rendered description</p>");
  assert.equal(result.issue.comments[0].id, "20");
  assert.equal(result.issue.comments[0].body.html, "<p>A server comment</p>");
});

test("comment pagination uses the actual page length, preserves identical comments by ID, and deduplicates embedded comments", async () => {
  const page = browser({ fetch: url => {
    if (!url.includes("/comment?")) return response({ fields: { summary: "Paged", comment: { total: 3, comments: [comment(1)] } } });
    const offset = Number(new URL(url).searchParams.get("startAt"));
    return response({ startAt: offset, maxResults: 1, total: 3, comments: [comment(offset + 1, "Same content")] });
  } });
  const result = await page.read();
  assert.deepEqual(Array.from(result.issue.comments, item => item.id), ["1", "2", "3"]);
  assert.deepEqual(page.requests.slice(1).map(item => new URL(item.url).searchParams.get("startAt")), ["0", "1", "2"]);
  assert.equal(result.issue.warnings, undefined);
});

test("comment limits are explicit and keep the first 1000 comments", async () => {
  const page = browser({ fetch: url => {
    if (!url.includes("/comment?")) return response({ fields: { summary: "Large issue" } });
    const offset = Number(new URL(url).searchParams.get("startAt"));
    return response({ startAt: offset, total: 1001, comments: Array.from({ length: 100 }, (_, index) => comment(offset + index + 1)) });
  } });
  const result = await page.read();
  assert.equal(result.issue.comments.length, 1000);
  assert.match(result.issue.warnings.join(" "), /1000 of 1001/);
  assert.equal(page.requests.length, 11);
});

test("comment retrieval failure preserves embedded comments with a warning", async () => {
  const page = browser({ fetch: url => url.includes("/comment?") ? response({}, 403) : response({ fields: { summary: "Restricted comments", comment: { comments: [comment(99)], total: 2 } } }) });
  const result = await page.read();
  assert.equal(result.issue.comments[0].id, "99");
  assert.match(result.issue.warnings.join(" "), /Could not retrieve all comments.*HTTP 403/);
});

test("ordinary board-card links cannot select an arbitrary issue", async () => {
  const card = node("WRONG-1", { href: "/browse/WRONG-1" });
  const page = browser({ href: "https://example.atlassian.net/jira/software/projects/TEAM/boards/1", document: { querySelector: () => null, querySelectorAll: selector => selector === "a[href]" ? [card] : [] } });
  const result = await page.read();
  assert.equal(result.ok, false);
  assert.match(result.error, /No current Jira issue/);
  assert.equal(page.requests.length, 0);
});

test("DOM fallback exports visible description and comment metadata without clicking or scrolling", async () => {
  const summary = node("Visible issue title");
  const description = node("Description content", { html: "<p>Description content</p>" });
  const author = node("Sam");
  const date = node("Yesterday", { datetime: "2026-10-04T12:30:00Z" });
  const body = node("Visible reply", { html: "<p>Visible reply</p>" });
  const entry = node("", { id: "comment-100" });
  entry.querySelector = selector => selector.includes(".action-body") ? body : selector.includes(".user-hover") ? author : selector.includes("time,") ? date : null;
  const document = {
    querySelectorAll: selector => selector.startsWith("#summary-val") ? [summary] : selector.startsWith(".issue-comment") ? [entry] : [],
    querySelector: selector => selector.startsWith("#description-val") ? description : null
  };
  const page = browser({ document, fetch: () => response({}, 403) });
  const result = await page.read();
  assert.equal(result.ok, true);
  assert.equal(result.issue.title, "Visible issue title");
  assert.equal(result.issue.description.html, "<p>Description content</p>");
  assert.equal(result.issue.comments[0].author, "Sam");
  assert.equal(result.issue.comments[0].created, "2026-10-04T12:30:00Z");
  assert.equal(result.issue.comments[0].id, "100");
  assert.match(result.issue.warnings[0], /visible page content.*unloaded content/);
  assert.equal(page.requests.length, 1);
});

test("a current-issue breadcrumb can identify an open modal on a board", async () => {
  const summary = node("Modal issue");
  const breadcrumb = node("TEAM_2-8", { href: "/browse/TEAM_2-8" });
  const document = { querySelector: () => null, querySelectorAll: selector => selector.startsWith("#summary-val") ? [summary] : selector.startsWith("#key-val") ? [breadcrumb] : [] };
  const page = browser({ href: "https://example.atlassian.net/jira/software/projects/TEAM/boards/1", document, fetch: url => url.includes("/comment?") ? response({ comments: [], total: 0 }) : response({ fields: { summary: "Modal issue" } }) });
  const result = await page.read();
  assert.equal(result.issue.key, "TEAM_2-8");
  assert.equal(result.issue.url, "https://example.atlassian.net/browse/TEAM_2-8");
});

test("a stale issue heading cannot provide fallback content for a different selected issue", async () => {
  const summary = node("Previous issue");
  const breadcrumb = node("OLD-1", { href: "/browse/OLD-1" });
  const document = { querySelector: () => null, querySelectorAll: selector => selector.startsWith("#summary-val") ? [summary] : selector.startsWith("#key-val") ? [breadcrumb] : [] };
  const page = browser({ href: "https://example.atlassian.net/jira/software/projects/TEAM/boards/1?selectedIssue=NEW-2", document, fetch: () => response({}, 403) });
  const result = await page.read();
  assert.equal(result.ok, false);
  assert.match(result.error, /Could not read NEW-2/);
});

test("invalid context metadata cannot redirect authenticated requests off site", async () => {
  const context = node("", { content: "/\\external.example.test" });
  const document = { querySelector: selector => selector.startsWith("meta[") ? context : null, querySelectorAll: () => [] };
  const page = browser({ href: "https://example.atlassian.net/jira/software/projects/TEAM/boards/1?selectedIssue=TEAM-1", document, fetch: url => url.includes("/comment?") ? response({ comments: [], total: 0 }) : response({ fields: { summary: "Issue" } }) });
  const result = await page.read();
  assert.equal(result.ok, true);
  for (const request of page.requests) assert.equal(new URL(request.url).origin, "https://example.atlassian.net");
});
