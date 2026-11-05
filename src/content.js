(async () => {
  const KEY = /^[A-Z0-9_]+-\d+$/i;
  const MAX_COMMENTS = 1000;
  const SUMMARY = '#summary-val, [data-testid="issue.views.issue-base.foundation.summary.heading"], [data-testid="issue.views.issue-base.foundation.summary.heading.text"]';
  const PANEL = '[role="dialog"], [data-testid="issue.views.issue-base.foundation.issue-detail-container"], [data-testid="issue-detail-view"]';
  const CURRENT_KEY = '#key-val, [data-testid*="breadcrumbs"][data-testid*="current-issue"], [data-testid*="breadcrumbs"] [aria-current="page"]';

  const all = (root, selector) => Array.from(root.querySelectorAll(selector));
  const first = (root, selector) => root.querySelector(selector);
  const text = node => (node?.innerText || node?.textContent || "").trim();
  const keyValue = value => KEY.test(String(value || "").trim()) ? String(value).trim().toUpperCase() : "";
  const visible = node => !node.closest?.('[hidden], [aria-hidden="true"]');

  function issueView() {
    const summary = all(document, SUMMARY).find(visible);
    if (summary) return { summary, scope: summary.closest(PANEL) || document };
    for (const panel of all(document, PANEL).filter(visible)) {
      const heading = first(panel, "h1");
      if (heading) return { summary: heading, scope: panel };
    }
    return { summary: null, scope: document };
  }

  function browsePath(url) {
    const match = url.pathname.match(/^(.*?)\/browse\/([A-Z0-9_]+-\d+)(?:\/|$)/i);
    return match ? { context: match[1], key: keyValue(match[2]) } : null;
  }

  function currentIssue() {
    const url = new URL(location.href);
    if (url.protocol !== "https:") throw new Error("Open this Jira issue over HTTPS.");
    const view = issueView();
    const pathIssue = browsePath(url);
    let key = keyValue(url.searchParams.get("selectedIssue")) || keyValue(url.searchParams.get("issueKey")) || pathIssue?.key;
    let breadcrumbURL;
    // Board-card links must not select a different issue.
    if (view.summary) {
      const breadcrumbs = all(view.scope, CURRENT_KEY).filter(visible);
      const knownKeys = breadcrumbs.map(node => keyValue(text(node))).filter(Boolean);
      if (key && knownKeys.length && !knownKeys.includes(key)) view.summary = null;
      for (const node of breadcrumbs) {
        const candidate = keyValue(text(node));
        if (!candidate || (key && candidate !== key)) continue;
        key ||= candidate;
        const href = node.getAttribute("href") || first(node, "a[href]")?.getAttribute("href");
        if (href) {
          try {
            const linked = new URL(href, url);
            if (linked.origin === url.origin && browsePath(linked)?.key === key) breadcrumbURL = linked;
          } catch {}
        }
        break;
      }
    }
    if (!key) throw new Error("No current Jira issue found. Open or select an issue.");
    const metaContext = first(document, 'meta[name="ajs-context-path"]')?.getAttribute("content");
    const safeContext = typeof metaContext === "string" && /^(?:\/(?!\/)[^?#\\]*)?$/.test(metaContext) ? metaContext.replace(/\/$/, "") : null;
    const legacyContext = url.pathname.match(/^(.*?)\/(?:secure|plugins\/servlet)\//)?.[1];
    const context = pathIssue?.context ?? safeContext ?? (breadcrumbURL ? browsePath(breadcrumbURL).context : undefined) ?? legacyContext ?? "";
    return { key, context, origin: url.origin, view, url: `${url.origin}${context}/browse/${key}` };
  }

  class ApiError extends Error {
    constructor(message, status = 0) { super(message); this.status = status; }
  }
  const unsupported = error => [404, 405, 410, 501].includes(error.status);

  async function getJSON(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { credentials: "include", headers: { Accept: "application/json" }, redirect: "error", signal: controller.signal });
      if (!response.ok) throw new ApiError(`Jira returned HTTP ${response.status}`, response.status);
      try { return await response.json(); }
      catch { throw new ApiError("Jira did not return valid JSON"); }
    } catch (error) {
      if (error.name === "AbortError") throw new ApiError("Jira's response timed out");
      throw error;
    } finally { clearTimeout(timeout); }
  }

  function endpoint(current, version, suffix = "", params = {}) {
    const url = new URL(`${current.context}/rest/api/${version}/issue/${encodeURIComponent(current.key)}${suffix}`, current.origin);
    if (url.origin !== current.origin) throw new Error("Jira API requests must stay on the current site.");
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
    return url.href;
  }

  function rich(raw, rendered) {
    const body = {};
    if (raw && typeof raw === "object" && raw.type === "doc") body.adf = raw;
    if (typeof rendered === "string" && rendered.trim()) body.html = rendered;
    if (typeof raw === "string" && raw.trim()) body.text = raw;
    return body;
  }

  function display(value, depth = 0) {
    if (value == null || depth > 5) return "";
    if (typeof value !== "object") return String(value);
    if (Array.isArray(value)) return value.map(item => display(item, depth + 1)).filter(Boolean).join(", ");
    if (value.type === "doc") return "";
    const label = value.displayName ?? value.name ?? value.value ?? value.key;
    if (label != null) {
      const child = display(value.child, depth + 1);
      return `${display(label, depth + 1)}${child ? ` / ${child}` : ""}`;
    }
    return Object.entries(value)
      .filter(([name, item]) => !/^(?:id|self|accountId|avatarUrls|iconUrl|schema|type|_.*)$/i.test(name) && item != null)
      .slice(0, 12).map(([name, item]) => {
        const valueText = display(item, depth + 1);
        return valueText ? `${name}: ${valueText}` : "";
      }).filter(Boolean).join("; ");
  }

  function normalizeComment(comment, index) {
    return { id: String(comment.id ?? `comment-${index + 1}`), author: display(comment.author) || "Unknown author", created: String(comment.created || ""), body: rich(comment.body, comment.renderedBody) };
  }

  async function commentsFor(current, version, embedded, warnings) {
    const found = new Map();
    const add = comments => comments.forEach((comment, index) => {
      const normalized = normalizeComment(comment, index);
      if (found.size < MAX_COMMENTS || found.has(normalized.id)) found.set(normalized.id, normalized);
    });
    const initial = Array.isArray(embedded?.comments) ? embedded.comments : [];
    add(initial);
    let startAt = 0;
    let expected = Number.isFinite(embedded?.total) && embedded.total >= 0 ? embedded.total : null;
    // Raw v2 bodies need renderedBody from the comments endpoint.
    let finished = found.size === expected
      && initial.every(comment => comment.body?.type === "doc" || (typeof comment.renderedBody === "string" && comment.renderedBody.trim()));
    try {
      for (let pageNumber = 0; !finished && pageNumber < 100 && startAt < MAX_COMMENTS; pageNumber++) {
        const params = { startAt, maxResults: Math.min(100, MAX_COMMENTS - startAt), orderBy: "created", expand: "renderedBody" };
        let page;
        try { page = await getJSON(endpoint(current, version, "/comment", params)); }
        catch (error) {
          if (version !== 3 || !unsupported(error)) throw error;
          version = 2;
          page = await getJSON(endpoint(current, version, "/comment", params));
        }
        if (!Array.isArray(page.comments)) throw new ApiError("Jira returned an invalid comments page");
        if (Number.isFinite(page.total)) expected = page.total;
        add(page.comments);
        const pageStart = Number.isFinite(page.startAt) ? page.startAt : startAt;
        const next = pageStart + page.comments.length;
        if (page.isLast === true || (expected !== null && next >= expected)) { finished = true; break; }
        if (!page.comments.length && expected === null) { finished = true; break; }
        if (!page.comments.length || next <= startAt) break;
        startAt = next;
        // Without a total, stop only on an empty page: servers may reduce page sizes.
      }
      if (!finished && (expected === null || found.size < expected)) warnings.push(`Comments may be incomplete: exported ${found.size}${expected === null ? "" : ` of ${expected}`}.`);
    } catch (error) {
      warnings.push(`Could not retrieve all comments (${error.message}). Exported ${found.size} available comments.`);
    }
    return [...found.values()].sort((a, b) => a.created.localeCompare(b.created));
  }

  function issueReference(issue) {
    return [issue?.key, issue?.fields?.summary].filter(Boolean).join(" — ");
  }

  function normalizeIssue(data, current) {
    const raw = data.fields;
    const rendered = data.renderedFields || {};
    const names = data.names || {};
    const key = keyValue(data.key) || current.key;
    const issue = { key, title: String(raw.summary || key), url: `${current.origin}${current.context}/browse/${key}`, fields: [], description: rich(raw.description, rendered.description), comments: [], attachments: [], customFields: [], sections: [], warnings: [] };
    const field = (name, value) => { const readable = display(value); if (readable) issue.fields.push({ name, value: readable }); };
    for (const [id, name] of [
      ["issuetype", "Type"], ["status", "Status"], ["priority", "Priority"], ["project", "Project"],
      ["assignee", "Assignee"], ["reporter", "Reporter"], ["creator", "Creator"], ["resolution", "Resolution"],
      ["created", "Created"], ["updated", "Updated"], ["resolutiondate", "Resolved"], ["duedate", "Due date"],
      ["labels", "Labels"], ["components", "Components"], ["fixVersions", "Fix versions"], ["versions", "Affected versions"], ["security", "Security level"]
    ]) field(name, raw[id]);
    if (Object.hasOwn(raw, "assignee") && raw.assignee === null) field("Assignee", "Unassigned");
    if (raw.parent) field("Parent", issueReference(raw.parent));
    for (const [id, name] of [["originalEstimate", "Original estimate"], ["remainingEstimate", "Remaining estimate"], ["timeSpent", "Time spent"]]) field(name, raw.timetracking?.[id]);
    if (raw.environment || rendered.environment) issue.sections.push({ name: "Environment", body: rich(raw.environment, rendered.environment) });
    const linked = (raw.issuelinks || []).map(link => {
      const other = link.outwardIssue || link.inwardIssue;
      const relation = link.outwardIssue ? link.type?.outward : link.type?.inward;
      return other ? `${relation || "relates to"}: ${issueReference(other)}` : "";
    }).filter(Boolean);
    if (linked.length) issue.sections.push({ name: "Linked issues", body: { text: linked.join("\n") } });
    if (raw.subtasks?.length) issue.sections.push({ name: "Subtasks", body: { text: raw.subtasks.map(issueReference).join("\n") } });
    for (const [id, value] of Object.entries(raw)) {
      if (!/^customfield_\d+$/.test(id) || value == null) continue;
      const name = names[id] || id;
      const body = rich(value, rendered[id]);
      if (body.adf || body.html || (body.text && body.text.includes("\n"))) issue.sections.push({ name, body });
      else { const readable = display(value); if (readable) issue.customFields.push({ name, value: readable }); }
    }
    issue.attachments = (raw.attachment || []).map(item => {
      const attachment = { id: String(item.id || ""), name: String(item.filename || "Attachment"), url: String(item.content || "") };
      if (item.mimeType) attachment.mimeType = item.mimeType;
      if (typeof item.size === "number") attachment.size = item.size;
      if (item.mediaId) attachment.mediaId = String(item.mediaId);
      return attachment;
    }).filter(item => /^https?:\/\//i.test(item.url));
    return issue;
  }

  function domBody(node) {
    if (!node) return {};
    const copy = node.cloneNode(true);
    for (const control of all(copy, "script, style, button, input, textarea, select, svg")) control.remove();
    return { html: copy.innerHTML || "", text: text(node) };
  }

  function readVisible(current, error) {
    const fresh = currentIssue();
    if (fresh.key !== current.key) throw new Error("The selected Jira issue changed while reading it. Try the export again.");
    const { scope, summary } = fresh.view;
    if (!summary || !text(summary)) throw new Error(`Could not read ${current.key}: ${error.message}. Check that the issue is open and you are signed in.`);
    const issue = { key: current.key, title: text(summary), url: current.url, fields: [], description: domBody(first(scope, '#description-val, [data-testid="issue.views.field.rich-text.description"], [data-testid*="description-content"]')), comments: [], attachments: [], customFields: [], sections: [], warnings: [`Jira API unavailable (${error.message}). Exported visible page content; collapsed or unloaded content may be missing.`] };
    for (const [name, selector] of [
      ["Type", '#type-val, [data-testid*="issue-type"]'], ["Status", '#status-val, [data-testid*="status-field"]'],
      ["Priority", '#priority-val, [data-testid*="priority-field"]'], ["Assignee", '#assignee-val, [data-testid*="assignee-field"]'],
      ["Reporter", '#reporter-val, [data-testid*="reporter-field"]'], ["Labels", "#labels-val"], ["Components", "#components-val"],
      ["Fix versions", "#fixfor-val"], ["Affected versions", "#versions-val"], ["Created", "#created-val"], ["Updated", "#updated-val"], ["Due date", "#due-date"]
    ]) { const value = text(first(scope, selector)); if (value) issue.fields.push({ name, value }); }
    const ids = new Set();
    const containers = all(scope, '.issue-comment, [data-comment-id], [data-testid="issue.views.issue-base.activity.comment"], [data-testid*="comment.ui.comment-container"], [id^="comment-"]');
    for (const [index, node] of containers.entries()) {
      if (!visible(node)) continue;
      const body = first(node, '.action-body, .comment-body, [data-testid*="comment-body"], [data-testid*="comment-content"]');
      if (!body) continue;
      const id = node.getAttribute("data-comment-id") || node.id?.match(/^comment-(\d+)$/)?.[1] || `visible-comment-${index + 1}`;
      if (ids.has(id)) continue;
      ids.add(id);
      const date = first(node, "time, .date, [data-testid*=\"created\"]");
      issue.comments.push({ id, author: text(first(node, '.user-hover, [rel="author"], [data-testid*="author"]')) || "Unknown author", created: date?.getAttribute("datetime") || date?.getAttribute("title") || text(date), body: domBody(body) });
    }
    for (const node of all(scope, '[id^="customfield_"][id$="-val"]')) {
      const id = node.id.replace(/-val$/, "");
      const label = first(scope, `label[for="${id}"], #${id}-label`) || first(node.parentElement || node, ".name, dt, label");
      const value = text(node);
      if (value) issue.customFields.push({ name: text(label).replace(/:$/, "") || id, value });
    }
    const seenAttachments = new Set();
    for (const anchor of all(scope, 'a[href*="/secure/attachment/"], a[href*="/attachment/content/"]')) {
      const url = new URL(anchor.getAttribute("href"), current.origin).href;
      if (seenAttachments.has(url)) continue;
      seenAttachments.add(url);
      issue.attachments.push({ id: url.match(/\/(?:attachment|content)\/(\d+)/)?.[1] || "", name: anchor.getAttribute("download") || text(anchor) || "Attachment", url });
    }
    return issue;
  }

  async function readIssue() {
    const current = currentIssue();
    let data;
    let version = 3;
    try {
      try { data = await getJSON(endpoint(current, version, "", { fields: "*all", expand: "names,renderedFields" })); }
      catch (error) {
        if (!unsupported(error)) throw error;
        version = 2;
        data = await getJSON(endpoint(current, version, "", { fields: "*all", expand: "names,renderedFields" }));
      }
      if (!data?.fields || typeof data.fields !== "object") throw new ApiError("Jira returned an invalid issue response");
    } catch (error) { return readVisible(current, error); }
    const issue = normalizeIssue(data, current);
    issue.comments = await commentsFor(current, version, data.fields.comment, issue.warnings);
    if (!issue.warnings.length) delete issue.warnings;
    return issue;
  }

  try { return { ok: true, issue: await readIssue() }; }
  catch (error) { return { ok: false, error: error.message || "Could not read this Jira issue." }; }
})();
