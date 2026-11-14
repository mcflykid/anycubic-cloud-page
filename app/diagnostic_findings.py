"""Détecte les incohérences dans les relevés expurgés de l’atelier."""


def diagnostic_findings(freshness, ace, trace, job_active):
    """Retourne des codes stables afin que l’interface explique chaque constat."""
    findings = []
    for source in ("updated_at", "mqtt_updated_at"):
        age = freshness.get(source)
        if type(age) in (int, float) and age > 30:
            findings.append("cloud_stale" if source == "updated_at" else "mqtt_stale")
    requested = (trace or {}).get("requested_slots")
    observed = [box["observed_slot"] for box in ace if type(box.get("observed_slot")) is int]
    # Les impressions multicolores changent de filament et ne permettent pas ce rapprochement.
    if (
        job_active
        and (trace or {}).get("matches_active_job") is True
        and isinstance(requested, list)
        and len(requested) == len(observed) == 1
        and requested != observed
    ):
        findings.append("ace_mismatch")
    return findings
