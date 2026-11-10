"""Vocabulaire original de matières, distinct des capacités de commande d’un modèle."""

# Les noms des profils sont des repères de lecture, jamais une preuve de compatibilité ACE.
FAMILIES = frozenset(
    {
        "PLA",
        "PETG",
        "ABS",
        "ASA",
        "TPU",
        "PA",
        "PC",
        "PVA",
        "HIPS",
        "PPS",
        "PET",
        "PEBA",
        "PA6",
        "PPA",
        "BVOH",
        "SBS",
        "PE",
        "PP",
        "EVA",
        "PHA",
    }
)
VARIANTS = frozenset(
    {
        "PLA+",
        "PLA Clear",
        "PLA Galaxy",
        "PLA Glow",
        "PLA High Speed",
        "PLA Marble",
        "PLA Matte",
        "PLA Metal",
        "PLA Silk",
        "PLA Translucent",
        "PLA Wood",
        "PLA SE",
        "PLA Basic",
        "PLA Pro",
        "PLA HS",
        "PLA Plus",
        "PLA Aero",
        "PLA-CF",
        "PET-CF",
        "PETG-CF",
        "PA-CF",
        "PA-GF",
        "PA6-CF",
        "PPS-CF",
        "PPA-CF",
        "PPA-GF",
        "ABS-GF",
        "ASA-Aero",
        "PE-CF",
        "PP-CF",
        "PP-GF",
        "PACF",
    }
)
# Ces neuf valeurs ont un parcours explicite dans le client ; les autres restent consultables.
EDITABLE = ("PLA", "PETG", "ABS", "PACF", "PC", "ASA", "HIPS", "PA", "PLA SE")
HIGH = frozenset({"ABS", "ASA", "PC", "PA", "PA6", "PAHT", "PET", "PPS", "PPA"})
LOW = frozenset({"PLA", "TPU", "PVA", "BVOH", "SBS"})


def recognized_material(value, model=None):
    """Renvoie un nom canonique autorisé, ou None ; PAHT-CF reste propre au S1 Max."""
    if not isinstance(value, str):
        return None
    names = FAMILIES | VARIANTS
    if str(model or "").removeprefix("Anycubic ").strip().casefold() == "kobra s1 max":
        names = names | {"PAHT-CF"}
    return next((name for name in names if name.casefold() == value.strip().casefold()), None)


def editable_materials():
    """Renvoie les valeurs établies pour l’édition ACE, indépendamment des profils de lecture."""
    return list(EDITABLE)


def material_family(value, model=None):
    """Ramène un nom reconnu à sa famille pour les comparaisons, ou None si inconnu."""
    known = recognized_material(value, model)
    if known is None:
        return None
    return "PA" if known == "PACF" else known.split(" ")[0].split("-")[0].rstrip("+")


def material_warnings(materials, spools, colors=None, model=None):
    """Renvoie les avertissements de correspondance sans bloquer un mélange de filaments."""
    warnings = []
    expected = [material_family(value, model) for value in materials]
    actual = [material_family(spool.get("material_type"), model) for spool in spools]
    if not expected or not actual or len(expected) != len(actual) or None in expected + actual:
        warnings.append("metadata-missing")
    if any(a != b for a, b in zip(expected, actual, strict=False) if a and b):
        warnings.append("material-mismatch")
    families = set(expected + actual)
    if families & HIGH and families & LOW:
        warnings.append("mixed-temperatures")
    if colors and any(
        isinstance(color, list)
        and len(color) == 3
        and isinstance(spool.get("color"), list)
        and color != spool["color"][:3]
        for color, spool in zip(colors, spools, strict=False)
    ):
        warnings.append("color-mismatch")
    return warnings
