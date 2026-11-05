#!/usr/bin/env python3
"""Package the extension's runtime files."""

import argparse
from html.parser import HTMLParser
import json
from pathlib import Path
import posixpath
import re
import sys
from urllib.parse import unquote, urlsplit
import zipfile

ROOT = Path(__file__).resolve().parent.parent
RUNTIME_FILES = (
    "manifest.json", "popup.html", "popup.css",
    "src/popup.js", "src/clipboard.js", "src/markdown.js", "src/content.js",
    "icons/icon16.png", "icons/icon32.png", "icons/icon48.png", "icons/icon128.png",
)


def check_reference(reference, source):
    url = urlsplit(reference)
    path = unquote(url.path)
    if url.scheme or url.netloc or "\\" in path:
        raise ValueError(f"{source}: invalid local resource {reference!r}")
    if path:
        target = path.lstrip("/") if path.startswith("/") else posixpath.join(posixpath.dirname(source), path)
        if posixpath.normpath(target) not in RUNTIME_FILES:
            raise ValueError(f"{source}: resource is not packaged: {reference}")


class Resources(HTMLParser):
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "base" or "srcset" in attrs:
            raise ValueError("popup.html: base URLs and srcset are unsupported")
        for key in ("src", "poster", *(["href"] if tag == "link" else [])):
            if attrs.get(key):
                check_reference(attrs[key], "popup.html")


def validate():
    files = {}
    for name in RUNTIME_FILES:
        path = ROOT / name
        if not path.is_file() or path.resolve() != path:
            raise ValueError(f"Missing or symlinked runtime file: {name}")
        files[name] = path.read_bytes()
    manifest = json.loads(files["manifest.json"])
    version = manifest["version"]
    if (manifest["manifest_version"] != 3 or
        not re.fullmatch(r"(?:0|[1-9][0-9]*)(?:\.(?:0|[1-9][0-9]*)){0,3}", version) or
        not any(int(part) for part in version.split(".")) or
        any(int(part) > 65535 for part in version.split("."))):
        raise ValueError("Invalid Manifest V3 version")
    action = manifest["action"]
    for reference in [action["default_popup"], *action["default_icon"].values(), *manifest["icons"].values()]:
        check_reference(reference, "manifest.json")
    Resources().feed(files["popup.html"].decode())
    for name, data in files.items():
        if name.endswith(".js"):
            pattern = r"(?:\bfrom\s*|\bimport\s*\(?\s*)(['\"])(.*?)\1"
        elif name.endswith(".css"):
            pattern = r"(?:url\(\s*|@import\s*)(['\"]?)([^'\"\s;)]+)\1"
        else:
            continue
        for match in re.finditer(pattern, data.decode()):
            check_reference(match[2], name)
    return version, files


def package(version, files):
    destination = ROOT / "dist" / f"jira-ticket-copy-as-markdown-{version}.zip"
    destination.parent.mkdir(exist_ok=True)
    temporary = destination.with_suffix(".tmp")
    try:
        with zipfile.ZipFile(temporary, "w") as archive:
            for name, data in files.items():
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, data, compresslevel=9)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="validate without creating a ZIP")
    args = parser.parse_args()
    try:
        version, files = validate()
        print(f"Validated {len(files)} runtime files." if args.check else package(version, files).relative_to(ROOT))
    except (OSError, ValueError, KeyError, TypeError) as error:
        sys.exit(f"Packaging failed: {error}")
