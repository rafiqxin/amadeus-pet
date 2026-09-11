"""Chunked wheel fetcher for networks that throttle long-lived connections.

Why this exists
---------------
On the AMA-DEUS dev box, full-file downloads from any index (PyPI,清华, Aliyun,
huggingface, download.pytorch.org) start fast, then stall to 0 B/s after tens of
megabytes. pip and curl both hang; ``--resume-retries`` reconnects but makes very
slow progress. Range requests tell a different story: an 8 MB ranged GET
completes in ~3 s, sustaining ~2.9 MB/s.

So: fetch wheels a few megabytes at a time, resuming from whatever is already on
disk. Each chunk is an independent short connection, which the throttler never
gets a chance to kill.

Usage
-----
    python tools/fetch_wheels.py onnxruntime-gpu scipy transformers
    python tools/fetch_wheels.py --wheelhouse .workspace/tts/wheelhouse -r req.txt
    python tools/fetch_wheels.py --list-only onnxruntime-gpu

Then install from what you fetched:

    pip install --find-links .workspace/tts/wheelhouse -r requirements.txt
"""

from __future__ import annotations

import argparse
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

DEFAULT_INDEX = "https://pypi.tuna.tsinghua.edu.cn/simple"
CHUNK_BYTES = 8 * 1024 * 1024
USER_AGENT = "amadeus-fetch-wheels/1.0"
MAX_CHUNK_ATTEMPTS = 6

# Wheel filename tags we can actually install, best first.
PREFERRED_TAGS = [
    "cp310-cp310-win_amd64",
    "cp310-abi3-win_amd64",
    "cp39-abi3-win_amd64",
    "cp38-abi3-win_amd64",
    "cp37-abi3-win_amd64",
    "py3-none-any",
    "py2.py3-none-any",
    "cp310-none-win_amd64",
]

REJECT = re.compile(
    r"(manylinux|musllinux|macosx|linux_|_linux|aarch64|arm64|ppc64|s390x|"
    r"win32|\.asc$|\.metadata$|\.sig$)",
    re.IGNORECASE,
)

try:  # pip vendors packaging; prefer it for correct PEP 440 ordering
    from pip._vendor.packaging.specifiers import SpecifierSet as _SpecifierSet
    from pip._vendor.packaging.version import InvalidVersion as _InvalidVersion
    from pip._vendor.packaging.version import parse as _parse_version
except Exception:  # noqa: BLE001 - fall back to a numeric approximation
    _parse_version = None
    _SpecifierSet = None
    _InvalidVersion = Exception  # type: ignore[assignment,misc]


def wheel_version(filename: str) -> str:
    """``name-1.2.3-cp310-...whl`` -> ``1.2.3``"""
    match = re.match(r"^[^-]+-([^-]+)-", filename)
    return match.group(1) if match else "0"


def version_key(filename: str):
    """Sort key for a wheel filename, so we pick the newest build."""
    raw = wheel_version(filename)
    if _parse_version is not None:
        try:
            return (1, _parse_version(raw))
        except _InvalidVersion:
            pass
    return (0, tuple(int(p) if p.isdigit() else -1 for p in re.split(r"[._+-]", raw)))


def split_spec(spec: str) -> tuple[str, str]:
    """``'transformers>=4.51,<5; python_version>"3"'`` -> ``('transformers', '>=4.51,<5')``"""
    cleaned = spec.split("#", 1)[0].split(";", 1)[0].strip()
    match = re.match(r"^([A-Za-z0-9._-]+)\s*(\[[^\]]*\])?\s*(.*)$", cleaned)
    if not match:
        return cleaned, ""
    return match.group(1), match.group(3).strip()


def _specifier_set(expression: str):
    if not expression or _SpecifierSet is None:
        return None
    try:
        return _SpecifierSet(expression)
    except Exception:  # noqa: BLE001 - unsupported constraint, ignore it
        return None


def _request(url: str, headers: dict[str, str] | None = None, method: str = "GET"):
    request = urllib.request.Request(url, method=method)
    request.add_header("User-Agent", USER_AGENT)
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    return urllib.request.urlopen(request, timeout=60)


def candidate_wheels(index: str, package: str, constraint: str = "") -> list[str]:
    """Return installable wheel URLs for *package*, newest version first.

    *constraint* is a PEP 440 expression (``>=4.51,<5``); candidates outside it
    are dropped so the wheelhouse never contradicts requirements.txt.
    """
    page = f"{index.rstrip('/')}/{package}/"
    try:
        with _request(page) as response:
            html = response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"{package}: index returned HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise SystemExit(f"{package}: cannot reach index: {exc.reason}") from exc

    hrefs = re.findall(r'href="([^"#]+)', html)
    urls = [urllib.parse.urljoin(page, href) for href in hrefs]
    allowed = _specifier_set(constraint)

    ranked: list[tuple[object, int, str]] = []
    for url in urls:
        name = urllib.parse.unquote(url.rsplit("/", 1)[-1])
        if not name.endswith(".whl") or REJECT.search(name):
            continue
        if allowed is not None:
            try:
                if _parse_version(wheel_version(name)) not in allowed:
                    continue
            except Exception:  # noqa: BLE001 - unparsable version, skip it
                continue
        for rank, tag in enumerate(PREFERRED_TAGS):
            if tag in name:
                ranked.append((version_key(name), rank, url))
                break

    # Newest version first; among equal versions, the best tag wins.
    # Stable sort: rank ascending, then re-sort by version descending.
    ranked.sort(key=lambda item: item[1])
    ranked.sort(key=lambda item: item[0], reverse=True)

    seen: set[str] = set()
    ordered: list[str] = []
    for _, _, url in ranked:
        if url not in seen:
            seen.add(url)
            ordered.append(url)
    return ordered


def remote_size(url: str) -> int:
    with _request(url, method="HEAD") as response:
        return int(response.headers.get("Content-Length") or 0)


def fetch(url: str, target: Path) -> tuple[bool, str]:
    """Download *url* to *target* in chunks, resuming an existing partial file."""
    try:
        total = remote_size(url)
    except Exception as exc:  # noqa: BLE001
        return False, f"HEAD failed: {type(exc).__name__}: {exc}"

    if total <= 0:
        return False, "server did not report a size"

    if target.exists() and target.stat().st_size == total:
        return True, f"already complete ({total / 1e6:.1f} MB)"

    started = time.time()
    mode = "r+b" if target.exists() else "wb"
    with open(target, mode) as handle:
        while handle.tell() < total:
            offset = handle.tell()
            end = min(offset + CHUNK_BYTES, total) - 1
            last_error = ""
            for attempt in range(1, MAX_CHUNK_ATTEMPTS + 1):
                try:
                    with _request(
                        url, headers={"Range": f"bytes={offset}-{end}"}
                    ) as response:
                        blob = response.read()
                    if not blob:
                        raise IOError("empty chunk")
                    handle.seek(offset)
                    handle.write(blob)
                    handle.flush()
                    handle.seek(offset + len(blob))
                    # A server that ignores Range replies 200 with the whole file.
                    if len(blob) > (end - offset + 1):
                        break
                    last_error = ""
                    break
                except Exception as exc:  # noqa: BLE001
                    last_error = f"{type(exc).__name__}: {exc}"
                    handle.seek(offset)
                    time.sleep(min(2 * attempt, 8))
            if last_error:
                return False, f"chunk at {offset} failed after {MAX_CHUNK_ATTEMPTS}: {last_error}"

    size = target.stat().st_size
    if size != total:
        return False, f"incomplete: {size} of {total} bytes"
    elapsed = time.time() - started
    return True, f"{total / 1e6:.1f} MB in {elapsed:.1f}s ({total / 1e6 / max(elapsed, 0.01):.2f} MB/s)"


def urls_from_report(path: Path) -> list[str]:
    """Collect wheel URLs from a ``pip install --dry-run --report`` JSON file.

    This is how the second phase works: let pip resolve the full closure against
    a partially-populated wheelhouse, then chunk-fetch whatever it still wants.
    """
    import json

    data = json.loads(path.read_text(encoding="utf-8"))
    urls: list[str] = []
    for item in data.get("install", []):
        url = (item.get("download_info") or {}).get("url")
        if url and url.endswith(".whl"):
            urls.append(url)
    return urls


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("packages", nargs="*", help="package names, optionally name==version")
    parser.add_argument("-r", "--requirement", action="append", default=[], help="requirements file")
    parser.add_argument("--index", default=DEFAULT_INDEX, help="simple index root")
    parser.add_argument(
        "--wheelhouse",
        default=".workspace/tts/wheelhouse",
        help="where to write wheels",
    )
    parser.add_argument("--list-only", action="store_true", help="print candidate URLs and exit")
    parser.add_argument(
        "--from-report",
        action="append",
        default=[],
        help="fetch every wheel URL listed in a pip --report JSON file",
    )
    args = parser.parse_args()

    names = list(args.packages)
    for requirement_file in args.requirement:
        for line in Path(requirement_file).read_text(encoding="utf-8").splitlines():
            line = line.split("#", 1)[0].strip()
            if not line or line.startswith("-"):
                continue
            # strip markers; keep version specifiers
            line = line.split(";", 1)[0].strip()
            names.append(line)

    direct_urls: list[str] = []
    for report in args.from_report:
        try:
            direct_urls.extend(urls_from_report(Path(report)))
        except Exception as exc:  # noqa: BLE001
            raise SystemExit(f"cannot read report {report}: {exc}") from exc

    if not names and not direct_urls:
        parser.error("no packages, requirements, or reports given")

    house = Path(args.wheelhouse)
    house.mkdir(parents=True, exist_ok=True)
    print(f"index      : {args.index}")
    print(f"wheelhouse : {house.resolve()}\n")

    failures: list[str] = []

    if direct_urls:
        print(f"=== {len(direct_urls)} wheel(s) from pip report ===")
        for url in direct_urls:
            name = urllib.parse.unquote(url.rsplit("/", 1)[-1])
            if (house / name).exists() and (house / name).stat().st_size > 0:
                print(f"    SKIP {name} (already present)")
                continue
            ok, detail = fetch(url, house / name)
            print(f"    {'OK  ' if ok else 'FAIL'} {name}: {detail}")
            if not ok:
                failures.append(name)

    for spec in names:
        package, constraint = split_spec(spec)
        if not package:
            continue
        print(f"=== {spec} ===")
        try:
            candidates = candidate_wheels(args.index, package, constraint)
        except SystemExit as exc:
            print(f"    {exc}")
            failures.append(spec)
            continue
        if not candidates:
            print("    no compatible wheel found")
            failures.append(spec)
            continue
        if args.list_only:
            for url in candidates[:4]:
                print("    " + urllib.parse.unquote(url.rsplit("/", 1)[-1]))
            continue

        downloaded = False
        for url in candidates[:3]:
            name = urllib.parse.unquote(url.rsplit("/", 1)[-1])
            ok, detail = fetch(url, house / name)
            print(f"    {'OK  ' if ok else 'FAIL'} {name}: {detail}")
            if ok:
                downloaded = True
                break
        if not downloaded:
            failures.append(spec)

    print()
    if failures:
        print(f"{len(failures)} failed: {', '.join(failures)}")
        return 1
    print("all wheels fetched")
    return 0


if __name__ == "__main__":
    sys.exit(main())
