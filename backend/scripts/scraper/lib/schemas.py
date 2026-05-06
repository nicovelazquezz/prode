"""JSON Schemas para validar el output del scraper antes de escribir."""
from __future__ import annotations

PHASE_VALUES = [
    "GROUPS",
    "ROUND_32",
    "ROUND_16",
    "QUARTERS",
    "SEMIS",
    "THIRD_PLACE",
    "FINAL",
]

CONFEDERATIONS = ["CONMEBOL", "UEFA", "CONCACAF", "AFC", "CAF", "OFC"]

MATCH_SCHEMA = {
    "type": "array",
    "minItems": 104,
    "maxItems": 104,
    "items": {
        "type": "object",
        "required": [
            "matchNumber",
            "phase",
            "homeTeamLabel",
            "awayTeamLabel",
            "kickoffAt",
            "predictionsLockAt",
        ],
        "properties": {
            "matchNumber": {"type": "integer", "minimum": 1, "maximum": 104},
            "phase": {"enum": PHASE_VALUES},
            "groupCode": {"type": ["string", "null"]},
            "homeTeamLabel": {"type": "string", "minLength": 1},
            "awayTeamLabel": {"type": "string", "minLength": 1},
            "kickoffAt": {"type": "string", "format": "date-time"},
            "predictionsLockAt": {"type": "string", "format": "date-time"},
            "venue": {"type": ["string", "null"]},
            "city": {"type": ["string", "null"]},
            "country": {"type": ["string", "null"]},
        },
    },
}

TEAM_SCHEMA = {
    "type": "array",
    "minItems": 48,
    "maxItems": 48,
    "items": {
        "type": "object",
        "required": ["fifaCode", "name", "shortName", "flagUrl", "confederation"],
        "properties": {
            "fifaCode": {"type": "string", "pattern": "^[A-Z]{3}$"},
            "name": {"type": "string", "minLength": 1},
            "shortName": {"type": "string", "minLength": 2, "maxLength": 4},
            "flagUrl": {"type": "string", "format": "uri"},
            "confederation": {"enum": CONFEDERATIONS},
            "groupCode": {"type": ["string", "null"], "pattern": "^[A-L]$"},
            "fifaRanking": {"type": ["integer", "null"]},
        },
    },
}

PLAYER_SCHEMA = {
    "type": "array",
    "minItems": 1,
    "items": {
        "type": "object",
        "required": ["fullName", "teamFifaCode"],
        "properties": {
            "fullName": {"type": "string", "minLength": 1},
            "teamFifaCode": {"type": "string", "pattern": "^[A-Z]{3}$"},
            "shirtNumber": {"type": ["integer", "null"], "minimum": 1, "maximum": 99},
        },
    },
}
