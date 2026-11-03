from __future__ import annotations

from backend.app.database import db_connection
from backend.app.settings import Settings


def _actor_sql(alias: str) -> str:
    return f"""
        CASE
            WHEN NULLIF(TRIM({alias}.username), '') IS NOT NULL
             AND NULLIF(TRIM({alias}.full_name), '') IS NOT NULL
                THEN CONCAT({alias}.username, ': ', {alias}.full_name)
            WHEN NULLIF(TRIM({alias}.username), '') IS NOT NULL THEN {alias}.username
            WHEN NULLIF(TRIM({alias}.full_name), '') IS NOT NULL THEN {alias}.full_name
            ELSE NULL
        END
    """


def lookup_inicio_qc_decision_actors(settings: Settings, submission_keys: list[str]) -> dict[str, str]:
    keys = list(dict.fromkeys(str(k or '').strip() for k in submission_keys if str(k or '').strip()))
    if not settings.database_url or not keys:
        return {}

    results = {}

    with db_connection(settings) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                WITH latest_reviews AS (
                    SELECT DISTINCT ON (mc.submission_key)
                        mc.submission_key,
                        {_actor_sql('ua')} AS actor,
                        al.reviewed_at
                    FROM clean.main_case mc
                    JOIN clean.audio_listening al
                      ON al.case_id = mc.case_id
                    JOIN app.user_account ua
                      ON ua.user_id = NULLIF(al.assigned_to_user_id, '')::uuid
                    WHERE mc.submission_key = ANY(%s)
                      AND UPPER(TRIM(COALESCE(al.assigned_to_role, ''))) = 'INICIO-QC'
                      AND LOWER(TRIM(COALESCE(al.status, ''))) = 'reviewed'
                    ORDER BY mc.submission_key, al.reviewed_at DESC NULLS LAST
                )
                SELECT submission_key, actor
                FROM latest_reviews
                WHERE NULLIF(TRIM(COALESCE(actor, '')), '') IS NOT NULL
                """,
                (keys,),
            )

            for row in cur.fetchall():
                results[row['submission_key']] = row['actor']

    return results
