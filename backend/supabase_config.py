import os
from supabase import create_client, Client

_client: Client | None = None


def get_supabase() -> Client:
    """Return a singleton Supabase client (service-role key — full DB + Auth admin access)."""
    global _client
    if _client is None:
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_SERVICE_KEY")
        if not url or not key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in environment")
        _client = create_client(url, key)
    return _client


def get_user_doc(row: dict) -> dict | None:
    """
    Convert a Supabase users row to a flat Firestore-compatible dict.
    Explicit column values take precedence over the JSONB document blob.
    """
    if row is None:
        return None
    doc = dict(row.get("document") or {})
    # Explicit indexed columns win
    for key in ("uid", "role", "email"):
        if row.get(key) is not None:
            doc[key] = row[key]
    return doc


def build_user_row(user_data: dict) -> dict:
    """
    Split a flat user dict into explicit DB columns + JSONB document blob.
    The JSONB document stores the full dict (camelCase, Firestore-compatible).
    """
    return {
        "uid":          user_data.get("uid", ""),
        "role":         user_data.get("role", "patient"),
        "email":        user_data.get("email", ""),
        "phone_number": user_data.get("phoneNumber", user_data.get("phone_number", "")),
        "health_id":    user_data.get("healthId",    user_data.get("health_id",    "")),
        "hospital_id":  user_data.get("hospitalId",  user_data.get("hospital_id",  "")),
        "doctor_id":    user_data.get("doctorId",    user_data.get("doctor_id",    "")),
        "employee_id":  user_data.get("employeeId",  user_data.get("employee_id",  "")),
        "hospital_uid": user_data.get("hospitalUid", user_data.get("hospital_uid", "")),
        "document":     user_data,
    }


def merge_user_doc(supabase: Client, uid: str, updates: dict) -> None:
    """
    Merge partial updates into an existing users row (like Firestore set(data, merge=True)).
    Also refreshes any explicit indexed columns that appear in updates.
    """
    result = supabase.table("users").select("document").eq("uid", uid).maybe_single().execute()
    existing = (result.data or {}).get("document") or {}
    merged = {**existing, **updates}

    row_update: dict = {"document": merged}
    if "phoneNumber" in updates:
        row_update["phone_number"] = updates["phoneNumber"]
    if "role" in updates:
        row_update["role"] = updates["role"]
    if "email" in updates:
        row_update["email"] = updates["email"]
    if "healthId" in updates:
        row_update["health_id"] = updates["healthId"]
    if "hospitalId" in updates:
        row_update["hospital_id"] = updates["hospitalId"]
    if "doctorId" in updates:
        row_update["doctor_id"] = updates["doctorId"]
    if "employeeId" in updates:
        row_update["employee_id"] = updates["employeeId"]
    if "hospitalUid" in updates:
        row_update["hospital_uid"] = updates["hospitalUid"]

    supabase.table("users").update(row_update).eq("uid", uid).execute()
