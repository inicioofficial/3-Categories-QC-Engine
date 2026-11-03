from backend.app.services.user_management import _ensure_role_registered


class RecordingCursor:
    def __init__(self):
        self.calls = []

    def execute(self, statement, params):
        self.calls.append((statement, params))


def test_ensure_inicio_qc_role_is_registered_before_assignment():
    cursor = RecordingCursor()

    _ensure_role_registered(cursor, "INICIO-QC")

    assert len(cursor.calls) == 1
    statement, params = cursor.calls[0]
    assert "INSERT INTO app.role" in statement
    assert "ON CONFLICT (role_code) DO NOTHING" in statement
    assert params == ("INICIO-QC", "INICIO-QC")
