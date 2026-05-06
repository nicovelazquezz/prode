"""Parser de fixtures del Mundial 2026 (sólo fase de grupos por ahora).

URL fuente: /futbol/mundial/copa-del-mundo/partidos/  — el tab 'Partidos' es el
único que muestra el fixture entero hidratado (la home y /calendario/ redirigen
al tab 'Clasificación' por SPA y solo traen la jornada actual).

Estrategia:
- Filtrar nodos con id `g_1_*` para descartar matches del sidebar de otros torneos.
- Cada `.event__match` trae `.event__time` con 'DD.MM. HH:MM' (hora AR).
- Headers `.event__round` agrupan por 'Jornada 1/2/3' (no se usa, todos son GROUPS).
- groupCode se resuelve buscando el fifaCode del home/away en teams.json scrapeado.
"""
from __future__ import annotations

import json
from pathlib import Path

from scrapling.parser import Selector

from .normalize import ar_local_to_utc, lock_at, es_to_fifa

MATCHES_URL = "https://www.flashscore.com.ar/futbol/mundial/copa-del-mundo/partidos/"
WAIT_SELECTOR = "div.event__match"

DATA_DIR = Path(__file__).resolve().parents[3] / "prisma" / "data"


def _load_team_groups() -> dict[str, str]:
    """fifaCode → groupCode desde teams.json."""
    f = DATA_DIR / "teams.json"
    if not f.exists():
        return {}
    return {
        t["fifaCode"]: t["groupCode"]
        for t in json.loads(f.read_text())
        if t.get("groupCode")
    }


def parse_matches(html: str) -> list[dict]:
    """
    Parsea los 72 matches de fase de grupos. Devuelve list[dict] con shape de
    seed-matches.ts (sin venue/city/country, que se mergean luego).
    """
    page = Selector(html)
    fifa_to_group = _load_team_groups()

    rows = page.css("div.event__match")
    parsed: list[dict] = []

    for row in rows:
        node_id = row.attrib.get("id", "")
        # Filtrar matches que no son de este torneo (sidebar de otros torneos).
        if not node_id.startswith("g_1_"):
            continue

        time_el = row.css(".event__time")
        home_el = row.css(".event__homeParticipant .wcl-name_jjfMf, .event__homeParticipant [class*='wcl-name']")
        away_el = row.css(".event__awayParticipant .wcl-name_jjfMf, .event__awayParticipant [class*='wcl-name']")
        if not (time_el and home_el and away_el):
            continue

        time_text = time_el[0].get_all_text(strip=True)  # 'DD.MM. HH:MM'
        # Filtrar fechas de junio/julio (Mundial 2026), descartar repechajes (marzo).
        date_part, _, hour_part = time_text.partition(" ")
        if not date_part.endswith("."):
            continue
        month = date_part.split(".")[1] if "." in date_part else ""
        if month not in ("06", "07"):
            continue

        home_name = home_el[0].get_all_text(strip=True)
        away_name = away_el[0].get_all_text(strip=True)
        try:
            home_code = es_to_fifa(home_name)
            away_code = es_to_fifa(away_name)
        except KeyError:
            raise

        date_full = f"{date_part.rstrip('.')}.2026"
        kickoff = ar_local_to_utc(date_full, hour_part.strip())

        group = fifa_to_group.get(home_code) or fifa_to_group.get(away_code)

        parsed.append(
            {
                "phase": "GROUPS",
                "groupCode": group,
                "homeTeamLabel": home_code,
                "awayTeamLabel": away_code,
                "kickoffAt": kickoff,
                "predictionsLockAt": lock_at(kickoff),
                "venue": None,
                "city": None,
                "country": None,
            }
        )

    # matchNumber: orden cronológico (mismo criterio que matches.json original).
    parsed.sort(key=lambda x: x["kickoffAt"])
    for i, m in enumerate(parsed, start=1):
        m["matchNumber"] = i

    return parsed
