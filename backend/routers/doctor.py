# routers/doctor.py
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from supabase_config import get_supabase, maybe_one
from routers.auth_helpers import (
    get_current_doctor_uid,
    get_authenticated_user_info,
    DoctorCommentRequest,
    PrescriptionCommentRequest,
    AlertResolveRequest,
    PrescriptionRequest,
    DoctorProfileUpdateRequest,
)

router = APIRouter()


def get_doctor_uid_any(info: dict = Depends(get_authenticated_user_info)) -> str:
    """
    Like get_current_doctor_uid but does NOT require hospital affiliation.
    Used for actions on the doctor's OWN account (e.g. editing their profile),
    which shouldn't be blocked just because they're not yet assigned a hospital.
    """
    if info.get("role") != "doctor":
        raise HTTPException(status_code=403, detail="Only doctors can perform this action.")
    return info["uid"]


def _assert_doctor_role(supabase, uid: str):
    """Verify the uid belongs to a doctor (via Supabase Auth app_metadata)."""
    try:
        response = supabase.auth.admin.get_user_by_id(uid)
        role = (response.user.app_metadata or {}).get("role", "")
        if role != "doctor":
            raise HTTPException(status_code=403, detail="Unauthorized: Only verified doctors can perform this action.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=404, detail="User not found.")


@router.get("/doctor/reports")
def get_doctor_reports(doctor_uid: str):
    supabase = get_supabase()
    try:
        _assert_doctor_role(supabase, doctor_uid)

        assignments = supabase.table("doctor_assignments").select("patient_uid").eq("doctor_uid", doctor_uid).execute()
        patient_uids = [r["patient_uid"] for r in (assignments.data or [])]
        if not patient_uids:
            return {"reports": []}

        all_reports = []
        for p_uid in patient_uids:
            consent = maybe_one(supabase.table("consents").select("granted").eq("patient_uid", p_uid).eq("doctor_uid", doctor_uid))
            if not consent.data or not consent.data.get("granted"):
                continue

            reports_res = supabase.table("fhir_reports").select("document").eq("user_id", p_uid).eq("collection_type", "reports").execute()
            for row in (reports_res.data or []):
                rd = dict(row["document"])
                rd["patient_uid"] = p_uid
                alert_res = supabase.table("alerts").select("id, status").eq("report_id", rd.get("id", "")).limit(1).execute()
                if alert_res.data:
                    rd["alert_status"] = alert_res.data[0].get("status", "unresolved")
                    rd["alert_id"]     = alert_res.data[0]["id"]
                else:
                    rd["alert_status"] = "none"
                all_reports.append(rd)

        return {"reports": all_reports}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch reports: {exc}")


@router.post("/doctor/resolve-alert")
def resolve_high_risk_alert(req: AlertResolveRequest):
    supabase = get_supabase()
    try:
        _assert_doctor_role(supabase, req.doctor_uid)

        alert_res = maybe_one(supabase.table("alerts").select("id").eq("id", req.alert_id))
        if not alert_res.data:
            raise HTTPException(status_code=404, detail="Alert not found.")

        supabase.table("alerts").update({
            "status":      "resolved",
            "resolved_at": datetime.utcnow().isoformat(),
            "resolved_by": req.doctor_uid,
        }).eq("id", req.alert_id).execute()

        supabase.table("audit_logs").insert({
            "action": "RESOLVE_ALERT",
            "document": {"doctor_uid": req.doctor_uid, "alert_id": req.alert_id},
        }).execute()

        return {"message": "Alert resolved successfully."}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to resolve alert: {exc}")


@router.post("/doctor/add-comment")
def add_doctor_comment(req: DoctorCommentRequest):
    supabase = get_supabase()
    try:
        _assert_doctor_role(supabase, req.doctor_uid)

        report_res = supabase.table("fhir_reports").select("document").eq("user_id", req.patient_uid).eq("collection_type", "reports").execute()
        target = None
        for row in (report_res.data or []):
            if row["document"].get("id") == req.report_id:
                target = row
                break
        if target is None:
            raise HTTPException(status_code=404, detail="DiagnosticReport not found.")

        doc   = dict(target["document"])
        notes = doc.get("note", [])
        notes.append({
            "author":    req.doctor_uid,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "type":      "doctor_comment",
            "text":      req.comment,
        })
        doc["note"] = notes

        supabase.table("fhir_reports").update({"document": doc}).eq("user_id", req.patient_uid).eq("id", req.report_id).eq("collection_type", "reports").execute()

        supabase.table("audit_logs").insert({
            "action": "ADD_DOCTOR_COMMENT",
            "document": {"doctor_uid": req.doctor_uid, "patient_uid": req.patient_uid, "report_id": req.report_id},
        }).execute()

        return {"message": "Comment added successfully.", "note": notes[-1]}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to add comment: {exc}")


@router.post("/doctor/add-prescription")
def add_prescription(payload: PrescriptionRequest, doctor_uid: str = Depends(get_current_doctor_uid)):
    from prescription_utils import build_prescription_bundle
    supabase = get_supabase()
    try:
        medications  = [med.dict() for med in payload.medications]
        prescription = build_prescription_bundle(
            patient_uid=payload.patient_uid, doctor_uid=doctor_uid,
            medications=medications, notes=payload.notes or "",
        )
        supabase.table("fhir_prescriptions").insert({
            "id": prescription["id"], "user_id": payload.patient_uid, "document": prescription,
        }).execute()
        supabase.table("audit_logs").insert({
            "action": "prescription_created",
            "document": {"doctor_uid": doctor_uid, "patient_uid": payload.patient_uid,
                         "prescription_id": prescription["id"]},
        }).execute()
        return {"message": "Prescription created successfully.", "prescription": prescription}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create prescription: {exc}")


@router.put("/doctor/profile")
def update_doctor_profile(payload: DoctorProfileUpdateRequest, doctor_uid: str = Depends(get_doctor_uid_any)):
    supabase = get_supabase()
    try:
        updates = {k: v for k, v in payload.dict().items() if v is not None}
        if not updates:
            return {"message": "No updates provided.", "updates": {}}
        from supabase_config import merge_user_doc
        merge_user_doc(supabase, doctor_uid, updates)
        return {"message": "Profile updated successfully.", "updates": updates}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to update profile: {exc}")


@router.get("/doctor/patient-prescriptions")
def get_patient_uploaded_prescriptions(patient_uid: str, doctor_uid: str = Depends(get_current_doctor_uid)):
    supabase = get_supabase()
    try:
        result = supabase.table("fhir_prescriptions").select("id, document").eq("user_id", patient_uid).order("created_at", desc=True).execute()
        prescriptions = []
        for row in (result.data or []):
            d = dict(row.get("document") or {})
            d["id"] = row["id"]
            prescriptions.append(d)
        return {"prescriptions": prescriptions}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/doctor/add-prescription-comment")
def add_prescription_comment(req: PrescriptionCommentRequest, doctor_uid: str = Depends(get_current_doctor_uid)):
    supabase = get_supabase()
    try:
        rx_res = maybe_one(supabase.table("fhir_prescriptions").select("document").eq("user_id", req.patient_uid).eq("id", req.prescription_id))
        if not rx_res.data:
            raise HTTPException(status_code=404, detail="Prescription not found.")

        doc      = dict(rx_res.data["document"])
        comments = doc.get("doctor_comments", [])
        new_comment = {
            "author":    doctor_uid,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "type":      "doctor_comment",
            "text":      req.comment,
        }
        comments.append(new_comment)
        doc["doctor_comments"] = comments

        supabase.table("fhir_prescriptions").update({"document": doc}).eq("user_id", req.patient_uid).eq("id", req.prescription_id).execute()
        supabase.table("audit_logs").insert({
            "action": "ADD_PRESCRIPTION_COMMENT",
            "document": {"doctor_uid": doctor_uid, "patient_uid": req.patient_uid, "prescription_id": req.prescription_id},
        }).execute()

        return {"message": "Comment added successfully.", "comment": new_comment}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to add comment: {exc}")
