# SPDX-License-Identifier: GPL-3.0-or-later
"""Validation commune des valeurs reçues aux frontières HTTP."""

import json
from aiohttp import web


async def json_object(request, *, message="Corps JSON invalide."):
    """Lit un objet JSON ; ValueError donne une réponse 400 avant tout appel au Cloud."""
    try:
        value = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError, web.HTTPBadRequest):
        raise ValueError(message) from None
    if not isinstance(value, dict):
        raise ValueError(message)
    return value
