"""Browser-based fetch con cache local. Usa StealthyFetcher de scrapling."""
from __future__ import annotations

import hashlib
import sys
import time
from pathlib import Path
from typing import Optional

CACHE_DIR = Path(__file__).resolve().parent.parent / ".cache"
CACHE_TTL_SECONDS = 12 * 60 * 60  # 12h


def _cache_path(url: str) -> Path:
    h = hashlib.sha1(url.encode()).hexdigest()
    return CACHE_DIR / f"{h}.html"


def _read_fresh_cache(url: str) -> Optional[str]:
    p = _cache_path(url)
    if not p.exists():
        return None
    age = time.time() - p.stat().st_mtime
    if age > CACHE_TTL_SECONDS:
        return None
    return p.read_text(encoding="utf-8")


def _write_cache(url: str, html: str) -> None:
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _cache_path(url).write_text(html, encoding="utf-8")


def fetch_html(
    url: str,
    *,
    wait_selector: str,
    use_cache: bool = True,
    timeout_ms: int = 45_000,
) -> str:
    """
    Devuelve el HTML hidratado de `url`. Cachea por SHA1(url) si use_cache.
    `wait_selector` es el selector CSS que indica que JS terminó de cargar
    el contenido relevante (ej. un partido real, no `.shimmer__event-row`).
    """
    if use_cache:
        cached = _read_fresh_cache(url)
        if cached is not None:
            print(f"[cache] {url}", file=sys.stderr)
            return cached

    # Import perezoso: scrapling es pesado y la primera vez instala browsers.
    from scrapling.fetchers import StealthyFetcher

    print(f"[fetch] {url}  (wait_selector={wait_selector})", file=sys.stderr)
    page = StealthyFetcher.fetch(
        url,
        headless=True,
        wait_selector=wait_selector,
        network_idle=True,
        timeout=timeout_ms,
        google_search=False,
    )
    if page.status >= 400:
        raise RuntimeError(f"HTTP {page.status} para {url}")
    html = page.html_content
    _write_cache(url, html)
    return html
