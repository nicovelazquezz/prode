"""Parser de plantillas (rosters) por selección.

Selectores en flashscore (verificados contra equipo/argentina/.../plantilla/):
- Filas: `.lineupTable__row`
- Número de camiseta: `.lineupTable__cell--jersey` (texto numérico, puede vacío)
- Nombre: `a.lineupTable__cell--name` (formato 'Apellido Nombre')

La página trae plantillas extendidas (todos los convocados históricos). El roster
oficial Mundial 2026 (26 jugadores por selección) se publica ~1 mes antes del
torneo. El scraper actual incluye TODOS los jugadores listados; el shirtNumber
ayuda a desambiguar dos jugadores con mismo nombre.
"""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor, as_completed

from scrapling.parser import Selector

from .fetch import fetch_html

ROSTER_WAIT_SELECTOR = "a.lineupTable__cell--name"


def _normalize_name(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _parse_jersey(text: str) -> int | None:
    digits = re.sub(r"\D", "", text or "")
    if not digits:
        return None
    n = int(digits)
    return n if 1 <= n <= 99 else None


def _parse_roster_html(html: str, fifa_code: str) -> list[dict]:
    """
    Flashscore repite cada jugador en varias tablas (estadísticas por torneo,
    histórico, convocatoria actual). Dedupeamos por (fullName, shirtNumber).
    """
    page = Selector(html)
    seen: set[tuple[str, int | None]] = set()
    out: list[dict] = []
    for row in page.css(".lineupTable__row"):
        name_el = row.css("a.lineupTable__cell--name")
        if not name_el:
            continue
        name = _normalize_name(name_el[0].get_all_text(strip=True))
        if not name:
            continue
        jersey_el = row.css(".lineupTable__cell--jersey")
        shirt = (
            _parse_jersey(jersey_el[0].get_all_text(strip=True)) if jersey_el else None
        )
        key = (name, shirt)
        if key in seen:
            continue
        seen.add(key)
        out.append(
            {"fullName": name, "teamFifaCode": fifa_code, "shirtNumber": shirt}
        )
    return out


def fetch_rosters(
    team_urls: dict[str, str],
    *,
    use_cache: bool,
    max_workers: int = 4,
) -> list[dict]:
    out: list[dict] = []

    def task(code: str, url: str) -> list[dict]:
        html = fetch_html(url, wait_selector=ROSTER_WAIT_SELECTOR, use_cache=use_cache)
        return _parse_roster_html(html, code)

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(task, code, url): code for code, url in team_urls.items()}
        for fut in as_completed(futures):
            code = futures[fut]
            try:
                rows = fut.result()
                if len(rows) < 20:
                    print(f"[warn] {code}: sólo {len(rows)} jugadores parseados")
                out.extend(rows)
            except Exception as exc:  # noqa: BLE001
                print(f"[err]  {code}: {exc}")
    return out
