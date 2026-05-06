"""Normalización de datos scrapeados desde flashscore (ES) a formato Prisma."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Optional

from dateutil import parser as date_parser

# flashscore.com.ar siempre muestra horarios en zona horaria de Argentina
# (UTC-3, sin DST), independientemente del TZ del navegador. Confirmado por el
# usuario en el calendario del Mundial 2026.
SCRAPED_TZ = timezone(timedelta(hours=-3))

# Mapeo nombre español (como aparece en flashscore.com.ar) → fifaCode.
# Fallar ruidosamente con KeyError ante un nombre desconocido es deliberado:
# obliga a actualizar este dict cuando aparece una selección nueva.
ES_NAME_TO_FIFA: dict[str, str] = {
    # CONMEBOL
    "Argentina": "ARG",
    "Brasil": "BRA",
    "Uruguay": "URU",
    "Colombia": "COL",
    "Ecuador": "ECU",
    "Paraguay": "PAR",
    # UEFA
    "Francia": "FRA",
    "España": "ESP",
    "Inglaterra": "ENG",
    "Portugal": "POR",
    "Países Bajos": "NED",
    "Holanda": "NED",
    "Bélgica": "BEL",
    "Alemania": "GER",
    "Croacia": "CRO",
    "Italia": "ITA",
    "Suiza": "SUI",
    "Dinamarca": "DEN",
    "Austria": "AUT",
    "Ucrania": "UKR",
    "Turquía": "TUR",
    "Serbia": "SRB",
    "Polonia": "POL",
    "Noruega": "NOR",
    "República Checa": "CZE",
    "Chequia": "CZE",
    "Hungría": "HUN",
    "Suecia": "SWE",
    "Rumania": "ROU",
    "Rumanía": "ROU",
    "Escocia": "SCO",
    "Gales": "WAL",
    "República de Irlanda": "IRL",
    "Irlanda": "IRL",
    "Albania": "ALB",
    "Eslovaquia": "SVK",
    "Eslovenia": "SVN",
    "Bosnia y Herzegovina": "BIH",
    "Bosnia-Herzegovina": "BIH",
    "Bosnia y Hercegovina": "BIH",
    "Grecia": "GRE",
    # CONCACAF
    "Estados Unidos": "USA",
    "EE.UU.": "USA",
    "EE. UU.": "USA",
    "EEUU": "USA",
    "México": "MEX",
    "Canadá": "CAN",
    "Panamá": "PAN",
    "Costa Rica": "CRC",
    "Jamaica": "JAM",
    "Honduras": "HON",
    "Curazao": "CUW",
    "Haití": "HAI",
    # AFC
    "Japón": "JPN",
    "Irán": "IRN",
    "Corea del Sur": "KOR",
    "Australia": "AUS",
    "Arabia Saudita": "KSA",
    "Arabia Saudí": "KSA",
    "Qatar": "QAT",
    "Catar": "QAT",
    "Uzbekistán": "UZB",
    "Jordania": "JOR",
    "Iraq": "IRQ",
    "Irak": "IRQ",
    "Emiratos Árabes Unidos": "UAE",
    # CAF
    "Marruecos": "MAR",
    "Senegal": "SEN",
    "Egipto": "EGY",
    "Nigeria": "NGA",
    "Argelia": "ALG",
    "Costa de Marfil": "CIV",
    "Túnez": "TUN",
    "Camerún": "CMR",
    "Ghana": "GHA",
    "Sudáfrica": "RSA",
    "Cabo Verde": "CPV",
    # OFC
    "Nueva Zelanda": "NZL",
    # CONCACAF / repechaje
    "Surinam": "SUR",
    "Bolivia": "BOL",
    "República Democrática del Congo": "COD",
    "RD del Congo": "COD",
    "RD Congo": "COD",
}


# Mapeo fifaCode → confederation. Necesario para teams nuevos (clasificados
# vía repechaje) que no estaban en teams.json original.
FIFA_TO_CONFEDERATION: dict[str, str] = {
    # CONMEBOL (10 federaciones, hasta 6 clasifican)
    "ARG": "CONMEBOL", "BRA": "CONMEBOL", "URU": "CONMEBOL",
    "COL": "CONMEBOL", "ECU": "CONMEBOL", "PAR": "CONMEBOL",
    "BOL": "CONMEBOL", "CHI": "CONMEBOL", "PER": "CONMEBOL", "VEN": "CONMEBOL",
    # CONCACAF
    "USA": "CONCACAF", "MEX": "CONCACAF", "CAN": "CONCACAF",
    "PAN": "CONCACAF", "CRC": "CONCACAF", "JAM": "CONCACAF",
    "HON": "CONCACAF", "CUW": "CONCACAF", "HAI": "CONCACAF", "SUR": "CONCACAF",
    # UEFA
    "FRA": "UEFA", "ESP": "UEFA", "ENG": "UEFA", "POR": "UEFA",
    "NED": "UEFA", "BEL": "UEFA", "GER": "UEFA", "CRO": "UEFA",
    "ITA": "UEFA", "SUI": "UEFA", "DEN": "UEFA", "AUT": "UEFA",
    "UKR": "UEFA", "TUR": "UEFA", "SRB": "UEFA", "POL": "UEFA",
    "NOR": "UEFA", "CZE": "UEFA", "HUN": "UEFA", "SWE": "UEFA",
    "ROU": "UEFA", "SCO": "UEFA", "WAL": "UEFA", "IRL": "UEFA",
    "ALB": "UEFA", "SVK": "UEFA", "SVN": "UEFA", "BIH": "UEFA",
    "GRE": "UEFA",
    # AFC
    "JPN": "AFC", "IRN": "AFC", "KOR": "AFC", "AUS": "AFC",
    "KSA": "AFC", "QAT": "AFC", "UZB": "AFC", "JOR": "AFC",
    "IRQ": "AFC", "UAE": "AFC",
    # CAF
    "MAR": "CAF", "SEN": "CAF", "EGY": "CAF", "NGA": "CAF",
    "ALG": "CAF", "CIV": "CAF", "TUN": "CAF", "CMR": "CAF",
    "GHA": "CAF", "RSA": "CAF", "CPV": "CAF", "COD": "CAF",
    # OFC
    "NZL": "OFC",
}


def es_to_fifa(name: str) -> str:
    """Resuelve nombre ES a fifaCode. KeyError si no está mapeado."""
    cleaned = name.strip()
    if cleaned not in ES_NAME_TO_FIFA:
        raise KeyError(
            f"Selección no mapeada: '{cleaned}'. "
            f"Agregarla a ES_NAME_TO_FIFA en lib/normalize.py."
        )
    return ES_NAME_TO_FIFA[cleaned]


def maybe_es_to_fifa(name: str) -> Optional[str]:
    """Resuelve nombre ES a fifaCode, o None si parece placeholder de bracket."""
    cleaned = name.strip()
    # Heurística: placeholders tipo "Ganador R32 1", "Ganador grupo A", etc.
    placeholder_markers = ("ganador", "perdedor", "2º", "1º", "grupo ", "rep.")
    lower = cleaned.lower()
    if any(m in lower for m in placeholder_markers):
        return None
    return es_to_fifa(cleaned)


def ar_local_to_utc(date_str: str, time_str: str) -> str:
    """
    Convierte (fecha, hora) tal como aparece en flashscore → ISO UTC string.
      date_str: '11.06.2026' o '11/06/2026'
      time_str: '14:00'
    Asume que las horas vienen en `SCRAPED_TZ` (UTC por default, ver constante).
    """
    naive = date_parser.parse(f"{date_str} {time_str}", dayfirst=True)
    aware = naive.replace(tzinfo=SCRAPED_TZ)
    return aware.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def lock_at(kickoff_iso: str, minutes_before: int = 10) -> str:
    """predictionsLockAt = kickoffAt - N min."""
    dt = date_parser.isoparse(kickoff_iso)
    return (dt - timedelta(minutes=minutes_before)).isoformat().replace("+00:00", "Z")
