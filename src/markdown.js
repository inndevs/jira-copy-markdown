// Original Markdown renderer. ADF shapes follow Atlassian's public documentation:
// https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/

const DEFAULT_OPTIONS = Object.freeze({
  description: true, comments: true, metadata: true,
  attachments: true, fields: false, sections: true,
});

const array = (value) => Array.isArray(value) ? value : [];
const string = (value) => value == null ? "" : String(value);
const blocks = (values) => values.filter((value) => value && value.trim()).join("\n\n");

function escapeText(value) {
  return string(value).replace(/\r\n?/g, "\n")
    .replace(/&(?=(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);)/gi, "&amp;")
    .replace(/[\\`*_{}\[\]<>#|~!]/g, "\\$&")
    .replace(/(^|\n)(\s*)([-+])(?=\s)/g, "$1$2\\$3")
    .replace(/(^|\n)([ \t]{0,3})(-+|=+|\+)(?=[ \t]*(?:\n|$))/g, "$1$2\\$3")
    .replace(/(^|\n)(\s*\d+)([.)])(?=\s)/g, "$1$2\\$3");
}

function oneLine(value) {
  return escapeText(string(value).replace(/\s+/g, " ").trim());
}

function resolveUrl(value, baseUrl) {
  if (!value) return "";
  try {
    const url = baseUrl ? new URL(string(value), baseUrl) : new URL(string(value));
    if (!["http:", "https:", "mailto:", "tel:"].includes(url.protocol)) return "";
    // Encode Markdown delimiters without changing query parameters or their order.
    return url.href.replace(/[<>()\\\s]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
  } catch {
    return "";
  }
}

function link(label, href, context) {
  const url = resolveUrl(href, context.baseUrl);
  return url ? `[${label || escapeText(href)}](${url})` : label;
}

function wrap(value, delimiter) {
  const [, leading, core, trailing] = /^(\s*)([\s\S]*?)(\s*)$/.exec(value);
  return core ? `${leading}${delimiter}${core}${delimiter}${trailing}` : value;
}

function codeSpan(value) {
  const text = string(value).replace(/\r?\n/g, " ");
  const longest = Math.max(0, ...(text.match(/`+/g) || []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const padding = /^`|`$/.test(text) || (/^ .* $/.test(text) && /\S/.test(text)) ? " " : "";
  return `${fence}${padding}${text}${padding}${fence}`;
}

function codeBlock(value, language = "") {
  const text = string(value).replace(/\r\n?/g, "\n");
  const longest = Math.max(2, ...(text.match(/`+/g) || []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  const info = string(language).replace(/[^a-zA-Z0-9_+.#-]/g, "");
  return `${fence}${info}\n${text}${text.endsWith("\n") ? "" : "\n"}${fence}`;
}

function applyMarks(value, marks, context, rawText) {
  const supported = array(marks);
  let result = supported.some((mark) => mark.type === "code") ? codeSpan(rawText ?? value) : value;
  for (const type of ["strong", "em", "strike", "subsup", "underline", "link"]) {
    const mark = supported.find((candidate) => candidate.type === type);
    if (!mark) continue;
    if (type === "strong") result = wrap(result, "**");
    if (type === "em") result = wrap(result, "*");
    if (type === "strike") result = wrap(result, "~~");
    if (type === "underline") result = `<u>${result}</u>`;
    if (type === "subsup" && ["sub", "sup"].includes(mark.attrs?.type)) {
      result = `<${mark.attrs.type}>${result}</${mark.attrs.type}>`;
    }
    if (type === "link") result = link(result, mark.attrs?.href, context);
  }
  return result;
}

function quote(value) {
  return value.split("\n").map((line) => line ? `> ${line}` : ">").join("\n");
}

function listItem(value, marker) {
  const lines = value.trim().split("\n");
  return lines.map((line, index) => index === 0 ? `${marker}${line}` :
    line ? `${" ".repeat(marker.length)}${line}` : "").join("\n");
}

function table(rows) {
  if (!rows.length) return "";
  const grid = [];
  let hasHeader = false;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = grid[rowIndex] ||= [];
    let column = 0;
    for (const cell of rows[rowIndex]) {
      while (row[column] !== undefined) column++;
      const width = Math.min(100, Math.max(1, Number(cell.colspan) || 1));
      const height = Math.min(rows.length - rowIndex, Math.max(1, Number(cell.rowspan) || 1));
      row[column] = cell.text.trim().replace(/(?<!\\)\|/g, "\\|").replace(/\r?\n+/g, "<br>");
      if (rowIndex === 0 && cell.header) hasHeader = true;
      for (let y = 0; y < height; y++) {
        const covered = grid[rowIndex + y] ||= [];
        for (let x = 0; x < width; x++) {
          if (x || y) covered[column + x] = "";
        }
      }
      column += width;
    }
  }
  const width = Math.max(...grid.map((row) => row.length));
  if (!width) return "";
  const renderRow = (row) => `| ${Array.from({ length: width }, (_, index) => row[index] || "").join(" | ")} |`;
  const header = hasHeader ? grid.shift() : [];
  return [renderRow(header), renderRow(Array(width).fill("---")), ...grid.map(renderRow)].join("\n");
}

function media(node, context) {
  const attrs = node.attrs || {};
  const attachments = array(context.attachments);
  const id = string(attrs.id);
  let attachment = id ? attachments.find((item) =>
    string(item.mediaId) === id || string(item.id) === id) : undefined;
  if (!attachment && attrs.alt) {
    const matches = attachments.filter((item) => item.name === attrs.alt);
    if (matches.length === 1) attachment = matches[0];
  }
  const name = attachment?.name || attrs.alt || attrs.name || "Attachment";
  const attachmentUrl = resolveUrl(attachment?.url, context.baseUrl);
  if (attachmentUrl) {
    const image = /^image\//i.test(attachment.mimeType || "") ||
      /\.(?:png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(attachment.name || "");
    return `${image ? "!" : ""}[${oneLine(name)}](${attachmentUrl})`;
  }
  const directUrl = attrs.url || attrs.src || array(node.marks).find((mark) => mark.type === "link")?.attrs?.href;
  if (resolveUrl(directUrl, context.baseUrl)) return link(oneLine(name), directUrl, context);
  return resolveUrl(context.baseUrl) ? link(`${oneLine(name)} — view in Jira`, context.baseUrl, context) :
    `${oneLine(name)} (media unavailable)`;
}

function adfChildren(node, context, inline = false) {
  const children = array(node?.content).map((child) => adfNode(child, context));
  return inline ? children.join("") : blocks(children);
}

function adfNode(node, context) {
  if (!node || typeof node !== "object") return "";
  const attrs = node.attrs || {};
  switch (node.type) {
    case "text": return applyMarks(escapeText(node.text), node.marks, context, node.text);
    case "doc": return adfChildren(node, context);
    case "paragraph": return adfChildren(node, context, true);
    case "heading": return `${"#".repeat(Math.min(6, Math.max(1, Number(attrs.level) || 1)))} ${adfChildren(node, context, true)}`;
    case "hardBreak": return "  \n";
    case "rule": return "---";
    case "codeBlock": return codeBlock(array(node.content).map((child) => child.text || "").join(""), attrs.language);
    case "blockquote": return quote(adfChildren(node, context));
    case "bulletList":
    case "orderedList":
    case "taskList": {
      const start = Number.isInteger(attrs.order) && attrs.order >= 0 ? attrs.order : 1;
      return array(node.content).map((item, index) => {
        let value = node.type === "taskList" ? adfChildren(item, context, true) : "";
        for (const child of node.type === "taskList" ? [] : array(item.content)) {
          const rendered = adfNode(child, context);
          if (!rendered) continue;
          value += (value ? /^(?:bullet|ordered|task)List$/.test(child.type) ? "\n" : "\n\n" : "") + rendered;
        }
        const marker = node.type === "orderedList" ? `${start + index}. ` : node.type === "taskList" ?
          `- [${item.attrs?.state === "DONE" ? "x" : " "}] ` : "- ";
        return listItem(value, marker);
      }).join("\n");
    }
    case "listItem": return adfChildren(node, context);
    case "table": return table(array(node.content).map((row) => array(row.content).map((cell) => ({
      text: adfChildren(cell, context), header: cell.type === "tableHeader",
      colspan: cell.attrs?.colspan, rowspan: cell.attrs?.rowspan,
    }))));
    case "mention": return escapeText(attrs.text || `@${attrs.id || "user"}`);
    case "emoji": return escapeText(attrs.text || attrs.shortName || ":emoji:");
    case "status": return wrap(escapeText(attrs.text || "Status"), "**");
    case "date": {
      const date = new Date(Number(attrs.timestamp));
      return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : escapeText(attrs.timestamp);
    }
    case "inlineCard":
    case "blockCard": return link(escapeText(attrs.text || attrs.url || "Link"), attrs.url, context);
    case "media":
    case "mediaInline": return media(node, context);
    case "mediaSingle":
    case "mediaGroup": return adfChildren(node, context);
    case "panel": return quote(adfChildren(node, context));
    case "expand":
    case "nestedExpand": return blocks([attrs.title ? wrap(oneLine(attrs.title), "**") : "", adfChildren(node, context)]);
    default: return array(node.content).length ? adfChildren(node, context, !array(node.content).some((child) =>
      ["paragraph", "heading", "bulletList", "orderedList", "codeBlock", "table"].includes(child.type))) :
      escapeText(node.text || attrs.text || "");
  }
}

/** Convert an Atlassian Document Format tree without fetching remote resources. */
export function adfToMarkdown(doc, { baseUrl = "", attachments = [] } = {}) {
  return adfNode(doc, { baseUrl, attachments }).trim();
}

const HTML_BLOCKS = new Set(["P", "DIV", "SECTION", "ARTICLE", "MAIN", "HEADER", "FOOTER", "ASIDE", "NAV", "ADDRESS", "FIGURE", "FIGCAPTION", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "TABLE", "HR", "DL", "DT", "DD"]);
const HTML_IGNORE = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "IFRAME", "OBJECT", "EMBED", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]);

function htmlChildren(node, context, inline = false) {
  if (inline) return Array.from(node.childNodes).map((child) => htmlNode(child, context)).join("");
  const result = [];
  let pending = "";
  const flush = () => { if (pending.trim()) result.push(pending.trim()); pending = ""; };
  for (const child of node.childNodes) {
    if (HTML_BLOCKS.has(child.nodeName)) {
      flush();
      result.push(htmlNode(child, context));
    } else pending += htmlNode(child, context);
  }
  flush();
  return blocks(result);
}

function htmlNode(node, context) {
  if (node.nodeType === 3) return escapeText(node.nodeValue.replace(/\s+/g, " "));
  if (node.nodeType !== 1 || HTML_IGNORE.has(node.nodeName) || node.hasAttribute("hidden") || node.getAttribute("aria-hidden") === "true") return "";
  const tag = node.nodeName;
  const inline = () => htmlChildren(node, context, true);
  if (/^H[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${inline().trim()}`;
  switch (tag) {
    case "BR": return "  \n";
    case "HR": return "---";
    case "P": return inline().trim();
    case "STRONG":
    case "B": return wrap(inline(), "**");
    case "EM":
    case "I": return wrap(inline(), "*");
    case "S":
    case "DEL":
    case "STRIKE": return wrap(inline(), "~~");
    case "U": return `<u>${inline()}</u>`;
    case "SUB": return `<sub>${inline()}</sub>`;
    case "SUP": return `<sup>${inline()}</sup>`;
    case "CODE":
    case "KBD":
    case "SAMP": return codeSpan(node.textContent);
    case "PRE": {
      const code = node.querySelector("code");
      const language = (code?.className || node.className || "").match(/(?:language|lang)-([\w+.#-]+)/)?.[1] || node.getAttribute("data-language");
      return codeBlock(node.textContent, language);
    }
    case "A": return link(inline(), node.getAttribute("href"), context);
    case "IMG": {
      const url = resolveUrl(node.getAttribute("src"), context.baseUrl);
      return url ? `![${oneLine(node.getAttribute("alt") || "Image")}](${url})` : oneLine(node.getAttribute("alt") || "Image");
    }
    case "BLOCKQUOTE": return quote(htmlChildren(node, context));
    case "UL":
    case "OL": {
      const start = Number.parseInt(node.getAttribute("start") || "1", 10);
      let number = Number.isFinite(start) ? start : 1;
      return Array.from(node.children).filter((child) => child.nodeName === "LI").map((item) => {
        if (tag === "OL" && item.hasAttribute("value")) {
          const explicit = Number.parseInt(item.getAttribute("value"), 10);
          if (Number.isFinite(explicit)) number = explicit;
        }
        let content = "";
        for (const child of item.childNodes) {
          const rendered = htmlNode(child, context);
          const separator = ["OL", "UL"].includes(child.nodeName) ? "\n" : HTML_BLOCKS.has(child.nodeName) ? "\n\n" : "";
          content += (content.trim() && separator ? separator : "") + rendered;
        }
        return listItem(content, tag === "OL" ? `${number++}. ` : "- ");
      }).join("\n");
    }
    case "TABLE": {
      const rows = Array.from(node.rows || []).filter((row) => row.closest("table") === node);
      return table(rows.map((row) => Array.from(row.cells).map((cell) => ({
        text: htmlChildren(cell, context), header: cell.nodeName === "TH", colspan: cell.colSpan, rowspan: cell.rowSpan,
      }))));
    }
    case "DT": return wrap(inline(), "**");
    case "DD": return htmlChildren(node, context);
    default: return htmlChildren(node, context, !HTML_BLOCKS.has(tag));
  }
}

function decodeEntities(value) {
  const names = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
    if (entity[0] !== "#") return names[entity.toLowerCase()] || match;
    const point = entity[1].toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return point > 0 && point <= 0x10FFFF && !(point >= 0xD800 && point <= 0xDFFF) ? String.fromCodePoint(point) : "�";
  });
}

/** Convert rendered Jira HTML. Outside a browser, retain readable text only. */
export function htmlToMarkdown(html, { baseUrl = "" } = {}) {
  if (typeof DOMParser === "undefined") {
    const text = string(html).replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<!--[^]*?-->/g, "")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote|pre)\s*>/gi, "\n\n")
      .replace(/<[^>]*>/g, "");
    return escapeText(decodeEntities(text).replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n").trim());
  }
  const document = new DOMParser().parseFromString(string(html), "text/html");
  return htmlChildren(document.body, { baseUrl }).trim();
}

function bodyToMarkdown(body, context) {
  if (typeof body === "string") return escapeText(body).trim();
  if (!body) return "";
  if (body.adf) {
    const rendered = adfToMarkdown(body.adf, context);
    if (rendered) return rendered;
  }
  if (body.html) {
    const rendered = htmlToMarkdown(body.html, context);
    if (rendered) return rendered;
  }
  return escapeText(body.text || "").trim();
}

function fieldValue(value, context) {
  if (value == null) return "";
  if (Array.isArray(value)) return value.map((item) => fieldValue(item, context)).filter(Boolean).join(", ");
  if (typeof value === "object") {
    if (value.type === "doc") return adfToMarkdown(value, context);
    if (value.adf || value.html || value.text != null) return bodyToMarkdown(value, context);
    if (value.displayName != null || value.name != null || value.value != null) return fieldValue(value.displayName ?? value.name ?? value.value, context);
    return escapeText(JSON.stringify(value));
  }
  return escapeText(value);
}

function fieldsTable(fields, context) {
  if (!array(fields).length) return "";
  return table([
    [{ text: "Field", header: true }, { text: "Value", header: true }],
    ...array(fields).map((field) => [{ text: oneLine(field.name) }, { text: fieldValue(field.value, context) }]),
  ]);
}

/** Render the normalized issue contract; options toggle sections, never the source. */
export function renderIssue(issue = {}, options = {}) {
  const include = { ...DEFAULT_OPTIONS, ...options };
  const context = { baseUrl: issue.url || "", attachments: array(issue.attachments) };
  const heading = [issue.key, issue.title].filter(Boolean).join(" — ") || "Jira issue";
  const output = [`# ${oneLine(heading)}`, `Source: ${link(oneLine(issue.url || "Source unavailable"), issue.url, context)}`];
  if (include.metadata) {
    const value = fieldsTable(issue.fields, context);
    if (value) output.push(`## Details\n\n${value}`);
  }
  if (include.description) {
    const value = bodyToMarkdown(issue.description, context);
    if (value) output.push(`## Description\n\n${value}`);
  }
  if (include.fields) {
    const value = fieldsTable(issue.customFields, context);
    if (value) output.push(`## Additional fields\n\n${value}`);
  }
  if (include.sections) {
    for (const section of array(issue.sections)) {
      const value = bodyToMarkdown(section.body, context);
      if (value) output.push(`## ${oneLine(section.name || "Section")}\n\n${value}`);
    }
  }
  if (include.attachments && array(issue.attachments).length) {
    output.push(`## Attachments\n\n${issue.attachments.map((attachment) => {
      const name = oneLine(attachment.name || "Attachment");
      const size = typeof attachment.size === "number" && Number.isFinite(attachment.size) ? ` (${attachment.size} bytes)` : "";
      return `- ${link(name, attachment.url, context)}${size}`;
    }).join("\n")}`);
  }
  if (include.comments && array(issue.comments).length) {
    const comments = issue.comments.map((comment) => {
      const author = typeof comment.author === "object" ? comment.author?.displayName || comment.author?.name : comment.author;
      const heading = [author || "Unknown author", comment.created].filter(Boolean).map(oneLine).join(" — ");
      return `### ${heading}\n\n${bodyToMarkdown(comment.body, context) || "(Empty comment)"}`;
    });
    output.push(`## Comments\n\n${comments.join("\n\n")}`);
  }
  return `${blocks(output).trim()}\n`;
}
