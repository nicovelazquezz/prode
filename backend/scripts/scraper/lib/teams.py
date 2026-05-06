"""Parser de las 48 selecciones clasificadas + groupCode."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

from scrapling.parser import Selector

from .normalize import es_to_fifa, FIFA_TO_CONFEDERATION

STANDINGS_URL = (
    "https://www.flashscore.com.ar/futbol/mundial/copa-del-mundo/clasificacion/"
)
WAIT_SELECTOR = "[class*='ui-table'], .ui-table__row, .ui-table"

# Lookup por fifaCode dentro del teams.json existente para mantener
# name/shortName/flagUrl/confederation/fifaRanking estables.
DATA_DIR = Path(__file__).resolve().parents[3] / "prisma" / "data"


def _load_existing() -> dict[str, dict]:
    f = DATA_DIR / "teams.json"
    if not f.exists():
        return {}
    return {t["fifaCode"]: t for t in json.loads(f.read_text())}


def parse_teams(html: str) -> list[dict]:
    """
    Parsea la página de standings. Devuelve list[dict] (48 items) con shape de
    seed-teams.ts. Toma name + flagUrl directos de flashscore (logos oficiales),
    y `confederation` / `fifaRanking` los preserva del teams.json existente.
    """
    page = Selector(html)
    existing = _load_existing()

    parsed: dict[str, dict] = {}

    tables: Iterable = page.css(".ui-table, [class*='standings'], [class*='Group']") or []
    for table in tables:
        header_text = (
            (table.css(".ui-table__header, [class*='groupTitle']") or [])[:1]
        )
        group_label = (
            header_text[0].get_all_text(strip=True) if header_text else ""
        )
        group_code = None
        upper = group_label.upper()
        idx = upper.find("GRUPO ")
        if idx != -1:
            cand = upper[idx + 6 : idx + 7]
            if cand.isalpha() and "A" <= cand <= "L":
                group_code = cand
        # Saltar tablas resumen (sin "Grupo X" en su header) — listan los mismos
        # teams que las tablas de grupo y sobreescribirían groupCode con None.
        if group_code is None:
            continue

        rows = table.css(".ui-table__row, [class*='tableRow']") or []
        for row in rows:
            name_el = row.css(".tableCellParticipant__name, [class*='participantName']")
            if not name_el:
                continue
            name = name_el[0].get_all_text(strip=True)
            try:
                code = es_to_fifa(name)
            except KeyError:
                raise

            # Logo oficial de flashscore. <img alt="México" src="...static.flashscore.com/...png">.
            logo_el = row.css("img[src*='static.flashscore.com']")
            logo_url = logo_el[0].attrib.get("src") if logo_el else None

            base = existing.get(code, {})
            parsed[code] = {
                "fifaCode": code,
                "name": name,  # nombre tal cual lo muestra flashscore en español
                "shortName": base.get("shortName", code),
                "flagUrl": logo_url or base.get("flagUrl") or f"https://flagcdn.com/{code.lower()}.svg",
                "confederation": FIFA_TO_CONFEDERATION.get(
                    code, base.get("confederation", "UEFA")
                ),
                "groupCode": group_code,
                "fifaRanking": base.get("fifaRanking"),
            }

    return list(parsed.values())
