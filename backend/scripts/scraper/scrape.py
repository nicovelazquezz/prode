#!/usr/bin/env python3
"""
CLI del scraper Mundial 2026.

  python scrape.py --target {matches,teams,players,all} [--dry-run] [--no-cache]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

from jsonschema import validate
from scrapling.parser import Selector

from lib.fetch import fetch_html
from lib import matches as matches_mod
from lib import teams as teams_mod
from lib import players as players_mod
from lib import schemas

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "prisma" / "data"


def _load_json(path: Path) -> Any:
    if not path.exists():
        return None
    return json.loads(path.read_text())


def _atomic_write(path: Path, obj: Any) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def _diff_summary(label: str, prev: Any, new: Any) -> None:
    print(f"\n=== diff: {label} ===")
    if prev is None:
        print(f"  (sin archivo previo, {len(new)} items nuevos)")
        return
    print(f"  prev={len(prev)}  new={len(new)}")
    if label == "matches.json" and isinstance(prev, list) and isinstance(new, list):
        prev_by_n = {m.get("matchNumber"): m for m in prev}
        for m in new:
            n = m.get("matchNumber")
            old = prev_by_n.get(n)
            if not old:
                print(f"  +match #{n}")
                continue
            changes = [
                k for k in ("homeTeamLabel", "awayTeamLabel", "kickoffAt", "groupCode", "phase")
                if old.get(k) != m.get(k)
            ]
            if changes:
                print(f"  ~match #{n}: {', '.join(changes)}")
    elif label == "teams.json" and isinstance(prev, list) and isinstance(new, list):
        prev_codes = {t["fifaCode"] for t in prev}
        new_codes = {t["fifaCode"] for t in new}
        for c in sorted(new_codes - prev_codes):
            print(f"  +team {c}")
        for c in sorted(prev_codes - new_codes):
            print(f"  -team {c}")
        for t in new:
            old = next((x for x in prev if x["fifaCode"] == t["fifaCode"]), None)
            if old and old.get("groupCode") != t.get("groupCode"):
                print(f"  ~team {t['fifaCode']}: groupCode {old.get('groupCode')} → {t.get('groupCode')}")


def _merge_groups_with_knockout(
    new_groups: list[dict], existing: list[dict] | None
) -> list[dict]:
    """
    Combina los 72 matches de grupos scrapeados con los matches de knockout del
    archivo existente (mantenidos con placeholders 'Ganador R32 N' hasta que se
    resuelva la clasificación). venue/city/country se preservan del archivo previo
    para los 72 de grupos también (no se scrapean).
    """
    if not existing:
        return new_groups
    by_n = {m.get("matchNumber"): m for m in existing}
    # Conservar venue/city/country en los grupos por matchNumber
    for m in new_groups:
        old = by_n.get(m.get("matchNumber"))
        if old:
            m["venue"] = old.get("venue")
            m["city"] = old.get("city")
            m["country"] = old.get("country")
    # Mantener todos los matches de fase eliminatoria del archivo existente
    knockout = [m for m in existing if m.get("phase") != "GROUPS"]
    return new_groups + knockout


def run_matches(*, use_cache: bool, dry_run: bool) -> None:
    html = fetch_html(
        matches_mod.MATCHES_URL,
        wait_selector=matches_mod.WAIT_SELECTOR,
        use_cache=use_cache,
    )
    parsed_groups = matches_mod.parse_matches(html)
    print(f"[matches] grupos parseados: {len(parsed_groups)}")

    existing = _load_json(DATA_DIR / "matches.json")
    full = _merge_groups_with_knockout(parsed_groups, existing)
    full.sort(key=lambda x: x.get("matchNumber", 0))

    validate(instance=full, schema=schemas.MATCH_SCHEMA)
    _diff_summary("matches.json", existing, full)

    if dry_run:
        print("[matches] dry-run, no escribo")
        return
    _atomic_write(DATA_DIR / "matches.json", full)
    print(f"[matches] escritos {len(full)} en {DATA_DIR / 'matches.json'}")


def run_teams(*, use_cache: bool, dry_run: bool) -> None:
    html = fetch_html(
        teams_mod.STANDINGS_URL,
        wait_selector=teams_mod.WAIT_SELECTOR,
        use_cache=use_cache,
    )
    parsed = teams_mod.parse_teams(html)
    print(f"[teams] parseados: {len(parsed)}")

    existing = _load_json(DATA_DIR / "teams.json")
    validate(instance=parsed, schema=schemas.TEAM_SCHEMA)
    _diff_summary("teams.json", existing, parsed)

    if dry_run:
        print("[teams] dry-run, no escribo")
        return
    _atomic_write(DATA_DIR / "teams.json", parsed)
    print(f"[teams] escritos {len(parsed)} en {DATA_DIR / 'teams.json'}")


# Cada match link tiene `partido/futbol/{slug1}-{id1}/{slug2}-{id2}/`. Flashscore
# a veces invierte home/away entre URL y visualización, así que matcheamos por
# slug (no por posición) para asignar URLs correctas.
_MATCH_HREF = re.compile(
    r"partido/futbol/([a-z0-9\-]+)-([A-Za-z0-9]{8})/([a-z0-9\-]+)-([A-Za-z0-9]{8})/"
)


def _slug_to_fifa(slug: str) -> str | None:
    """
    Busca el fifaCode de un slug tipo 'republica-checa' / 'bosnia-herzegovina'
    contra el dict ES_NAME_TO_FIFA. Normaliza ambos lados (lowercase, sin tildes,
    espacios↔guiones).
    """
    import unicodedata
    from lib.normalize import ES_NAME_TO_FIFA

    def norm(s: str) -> str:
        s = unicodedata.normalize("NFD", s)
        s = "".join(c for c in s if unicodedata.category(c) != "Mn")
        return s.lower().replace("-", " ").replace(".", "").strip()

    target = norm(slug)
    for name, code in ES_NAME_TO_FIFA.items():
        if norm(name) == target:
            return code
    # Fallbacks comunes
    aliases = {
        "ee uu": "USA",
        "usa": "USA",
        "rd congo": "COD",
    }
    return aliases.get(target)


def _extract_team_urls_from_matches(html: str) -> dict[str, str]:
    """
    Devuelve dict[fifaCode, roster_url]. Matchea slug → fifaCode, ignorando si
    flashscore invirtió home/away entre el href y la visualización.
    """
    page = Selector(html)
    out: dict[str, str] = {}
    rows = page.css("div.event__match")
    for row in rows:
        if not row.attrib.get("id", "").startswith("g_1_"):
            continue
        link = row.css("a.eventRowLink")
        if not link:
            continue
        m = _MATCH_HREF.search(link[0].attrib.get("href", ""))
        if not m:
            continue
        for slug, tid in ((m.group(1), m.group(2)), (m.group(3), m.group(4))):
            code = _slug_to_fifa(slug)
            if code:
                out[code] = (
                    f"https://www.flashscore.com.ar/equipo/{slug}/{tid}/plantilla/"
                )
    return out


def run_players(*, use_cache: bool, dry_run: bool) -> None:
    matches_html = fetch_html(
        matches_mod.MATCHES_URL,
        wait_selector=matches_mod.WAIT_SELECTOR,
        use_cache=use_cache,
    )
    team_urls = _extract_team_urls_from_matches(matches_html)
    print(f"[players] equipos detectados: {len(team_urls)}")
    if len(team_urls) < 48:
        print(f"[warn] esperaba 48 URLs de plantilla, parseadas {len(team_urls)}")

    parsed = players_mod.fetch_rosters(team_urls, use_cache=use_cache)
    print(f"[players] total parseados: {len(parsed)}")

    existing = _load_json(DATA_DIR / "players.json")
    validate(instance=parsed, schema=schemas.PLAYER_SCHEMA)
    _diff_summary("players.json", existing, parsed)

    if dry_run:
        print("[players] dry-run, no escribo")
        return
    _atomic_write(DATA_DIR / "players.json", parsed)
    print(f"[players] escritos {len(parsed)} en {DATA_DIR / 'players.json'}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--target",
        choices=["matches", "teams", "players", "all"],
        required=True,
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--no-cache", action="store_true", help="ignorar .cache/")
    args = parser.parse_args()

    use_cache = not args.no_cache
    dry = args.dry_run

    if args.target in ("teams", "all"):
        run_teams(use_cache=use_cache, dry_run=dry)
    if args.target in ("matches", "all"):
        run_matches(use_cache=use_cache, dry_run=dry)
    if args.target in ("players", "all"):
        run_players(use_cache=use_cache, dry_run=dry)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001
        print(f"FATAL: {exc}", file=sys.stderr)
        sys.exit(1)
