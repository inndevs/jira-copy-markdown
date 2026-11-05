#!/usr/bin/env python3
"""Validate and reproducibly package only the extension's runtime files."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import tempfile
from html.parser import HTMLParser
from urllib.parse import unquote, urlsplit
import zipfile


ROOT = Path(__file__).resolve().parent.parent
RUNTIME_FILES = (
    "manifest.json",
    "popup.html",
    "popup.css",
    "src/popup.js",
    "src/clipboard.js",
    "src/markdown.js",
    "src/content.js",
    "icons/icon16.png",
    "icons/icon32.png",
    "icons/icon48.png",
    "icons/icon128.png",
)
ALLOWED_FILES = frozenset(RUNTIME_FILES)


class PackageError(ValueError):
    """An input would produce an incomplete or invalid extension package."""


def check_reference(reference: str, source: str) -> None:
    """Resolve a packaged resource relative to its referencing file."""
    if not isinstance(reference, str) or not reference:
        raise PackageError(f"{source}: invalid resource reference {reference!r}")
    parsed = urlsplit(reference)
    if parsed.scheme or parsed.netloc:
        raise PackageError(f"{source}: remote resource is not packaged: {reference}")
    path = unquote(parsed.path)
    if not path:  # An in-document anchor does not refer to another file.
        return
    if "\\" in path:
        raise PackageError(f"{source}: use forward slashes in {reference!r}")
    candidate = PurePosixPath(path.lstrip("/")) if path.startswith("/") else PurePosixPath(source).parent / path
    parts: list[str] = []
    for part in candidate.parts:
        if part == "..":
            if not parts:
                raise PackageError(f"{source}: reference escapes the package: {reference}")
            parts.pop()
        elif part != ".":
            parts.append(part)
    normalized = "/".join(parts)
    if normalized not in ALLOWED_FILES:
        raise PackageError(f"{source}: referenced file is outside the runtime list: {reference}")


class ResourceParser(HTMLParser):
    def __init__(self, source: str) -> None:
        super().__init__()
        self.source = source

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "base":
            raise PackageError(f"{self.source}: base URLs are unsupported")
        for attribute in ("src", "poster"):
            if attributes.get(attribute):
                check_reference(attributes[attribute], self.source)
        if tag == "link" and attributes.get("href"):
            check_reference(attributes["href"], self.source)
        if attributes.get("srcset"):
            raise PackageError(f"{self.source}: srcset needs explicit packaging validation")


def manifest_references(manifest: dict) -> list[str]:
    refs: list[str] = []

    def icons(value: object) -> None:
        if isinstance(value, str):
            refs.append(value)
        elif isinstance(value, dict):
            refs.extend(value.values())

    icons(manifest.get("icons", {}))
    for name in ("action", "browser_action", "page_action"):
        action = manifest.get(name, {})
        icons(action.get("default_icon", {}))
        if action.get("default_popup"):
            refs.append(action["default_popup"])
    background = manifest.get("background", {})
    refs.extend(background.get("scripts", []))
    for key in ("service_worker", "page"):
        if background.get(key):
            refs.append(background[key])
    for content_script in manifest.get("content_scripts", []):
        refs.extend(content_script.get("js", []))
        refs.extend(content_script.get("css", []))
    for resources in manifest.get("web_accessible_resources", []):
        refs.extend(resources.get("resources", []) if isinstance(resources, dict) else [resources])
    if manifest.get("options_page"):
        refs.append(manifest["options_page"])
    if manifest.get("options_ui", {}).get("page"):
        refs.append(manifest["options_ui"]["page"])
    refs.extend(manifest.get("chrome_url_overrides", {}).values())
    if manifest.get("devtools_page"):
        refs.append(manifest["devtools_page"])
    if manifest.get("side_panel", {}).get("default_path"):
        refs.append(manifest["side_panel"]["default_path"])
    refs.extend(manifest.get("sandbox", {}).get("pages", []))
    for rules in manifest.get("declarative_net_request", {}).get("rule_resources", []):
        refs.append(rules["path"])
    return refs


def validate() -> tuple[str, dict[str, bytes]]:
    files: dict[str, bytes] = {}
    for name in RUNTIME_FILES:
        path = ROOT / name
        if not path.is_file() or path.resolve() != path:
            raise PackageError(f"Required runtime file is missing or is a symlink: {name}")
        files[name] = path.read_bytes()
    manifest = json.loads(files["manifest.json"])
    if manifest.get("manifest_version") != 3:
        raise PackageError("manifest.json must use Manifest V3")
    version = manifest.get("version", "")
    if not isinstance(version, str) or not re.fullmatch(r"(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){0,3}", version):
        raise PackageError("manifest.json contains an invalid Chrome extension version")
    version_parts = [int(part) for part in version.split(".")]
    if not any(version_parts) or any(part > 65535 for part in version_parts):
        raise PackageError("Version components must be 0–65535, and the version cannot be all zero")
    for reference in manifest_references(manifest):
        check_reference(reference, "manifest.json")
    for name, content in files.items():
        if name.endswith(".html"):
            ResourceParser(name).feed(content.decode("utf-8"))
        elif name.endswith(".css"):
            css = content.decode("utf-8")
            for match in re.finditer(r"url\(\s*(['\"]?)(.*?)\1\s*\)", css):
                check_reference(match[2], name)
            for match in re.finditer(r"@import\s+(['\"])(.*?)\1", css):
                check_reference(match[2], name)
        elif name.endswith(".js"):
            javascript = content.decode("utf-8")
            for match in re.finditer(r"(?:\bfrom\s*|\bimport\s*\(?\s*)(['\"])(.*?)\1", javascript):
                check_reference(match[2], name)
    return version, files


def package() -> Path:
    version, files = validate()
    output_dir = ROOT / "dist"
    output_dir.mkdir(exist_ok=True)
    destination = output_dir / f"jira-copy-markdown-{version}.zip"
    descriptor, temporary_name = tempfile.mkstemp(prefix=".package-", suffix=".zip", dir=output_dir)
    os.close(descriptor)
    temporary = Path(temporary_name)
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
            for name in RUNTIME_FILES:
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, files[name], compresslevel=9)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate runtime files without creating a ZIP")
    args = parser.parse_args()
    try:
        if args.check:
            version, _ = validate()
            print(f"Validated {len(RUNTIME_FILES)} runtime files for version {version}.")
        else:
            destination = package()
            print(f"Created {destination.relative_to(ROOT)} ({len(RUNTIME_FILES)} runtime files).")
    except (PackageError, OSError, ValueError, KeyError, TypeError) as error:
        print(f"Packaging failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
