# routers/superadmin.py
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from supabase_config import get_supabase, build_user_row
from routers.auth_helpers import (
    get_current_superadmin_uid,
    SuperAdminCreateUserRequest,
    generate_unique_id,
    build_standard_user_doc,
)

router = APIRouter()


@router.get("/superadmin/all-users")
def get_all_users(uid: str = Depends(get_current_superadmin_uid)):
    supabase = get_supabase()
    try:
        result = supabase.table("users").select("uid, role, email, document").execute()
        result_map = {"patients": [], "doctors": [], "hospitals": [], "superadmins": []}
        for row in (result.data or []):
            data = dict(row.get("document") or {})
            data.update({"uid": row["uid"], "role": row["role"], "email": row["email"], "id": row["uid"]})
            role = row.get("role", "patient")
            if role == "patient":
                result_map["patients"].append(data)
            elif role == "doctor":
                result_map["doctors"].append(data)
            elif role == "hospital":
                result_map["hospitals"].append(data)
            elif role == "superadmin":
                result_map["superadmins"].append(data)
        return result_map
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/superadmin/platform-stats")
def get_platform_stats(uid: str = Depends(get_current_superadmin_uid)):
    supabase = get_supabase()
    try:
        users_res = supabase.table("users").select("uid, role").execute()
        users     = result_data = users_res.data or []
        patients  = [u for u in users if u.get("role") == "patient"]
        doctors   = [u for u in users if u.get("role") == "doctor"]
        hospitals = [u for u in users if u.get("role") == "hospital"]

        total_reports = 0
        for p in patients:
            reports_res = supabase.table("fhir_reports").select("id").eq("user_id", p["uid"]).eq("collection_type", "reports").execute()
            total_reports += len(reports_res.data or [])

        alerts_res       = supabase.table("alerts").select("id").eq("status", "unresolved").execute()
        unresolved_alerts = len(alerts_res.data or [])

        return {
            "total_patients":   len(patients),
            "total_doctors":    len(doctors),
            "total_hospitals":  len(hospitals),
            "total_reports":    total_reports,
            "unresolved_alerts": unresolved_alerts,
            "total_users":      len(users),
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/superadmin/all-reports")
def get_all_reports_superadmin(uid: str = Depends(get_current_superadmin_uid)):
    supabase = get_supabase()
    try:
        patients_res = supabase.table("users").select("uid, email, document").eq("role", "patient").execute()
        all_reports  = []
        for p in (patients_res.data or []):
            p_data      = p.get("document") or {}
            reports_res = supabase.table("fhir_reports").select("id, document").eq("user_id", p["uid"]).eq("collection_type", "reports").execute()
            for row in (reports_res.data or []):
                rd = dict(row["document"])
                rd.update({"id": row["id"], "patient_uid": p["uid"],
                            "patient_name": p_data.get("name", "Unknown"),
                            "patient_email": p.get("email", "")})
                all_reports.append(rd)
        return {"reports": all_reports}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/superadmin/create-user")
def superadmin_create_user(req: SuperAdminCreateUserRequest, admin_uid: str = Depends(get_current_superadmin_uid)):
    if req.role not in ("patient", "doctor", "hospital"):
        raise HTTPException(status_code=400, detail="Role must be 'patient', 'doctor', or 'hospital'.")
    supabase = get_supabase()
    try:
        auth_response = supabase.auth.admin.create_user({
            "email":         req.email,
            "password":      req.password,
            "email_confirm": True,
            "user_metadata": {"full_name": req.name},
            "app_metadata":  {"role": req.role},
        })
        user = auth_response.user
        uid  = user.id

        kwargs: dict = {"uid": uid, "role": req.role, "email": req.email, "name": req.name, "created_by": admin_uid}
        if req.role == "patient":
            kwargs["healthId"] = generate_unique_id(supabase, "healthId", "PAT-", 6)
            kwargs["height"] = kwargs["weight"] = kwargs["bmi"] = ""
        elif req.role == "doctor":
            kwargs["doctorId"] = generate_unique_id(supabase, "doctorId", "DOC-", 4)
        elif req.role == "hospital":
            kwargs["hospitalId"] = generate_unique_id(supabase, "hospitalId", "HOSP-", 4, digits_only=True)

        user_data = build_standard_user_doc(**kwargs)
        supabase.table("users").insert(build_user_row(user_data)).execute()

        supabase.table("audit_logs").insert({
            "action": "SUPERADMIN_CREATE_USER",
            "document": {"admin_uid": admin_uid, "created_uid": uid, "role": req.role, "email": req.email},
        }).execute()

        return {"success": True, "uid": uid, "user": user_data}
    except HTTPException:
        raise
    except Exception as exc:
        msg = str(exc)
        if "already registered" in msg or "email_exists" in msg:
            raise HTTPException(status_code=400, detail="The email address is already in use.")
        raise HTTPException(status_code=500, detail=f"Failed to create user: {msg}")


class EditPasswordRequest(BaseModel):
    new_password: str


@router.put("/superadmin/edit-password/{target_uid}")
def superadmin_edit_password(target_uid: str, req: EditPasswordRequest, admin_uid: str = Depends(get_current_superadmin_uid)):
    supabase = get_supabase()
    try:
        target_res = supabase.auth.admin.get_user_by_id(target_uid)
        if (target_res.user.app_metadata or {}).get("role") == "superadmin" and target_uid != admin_uid:
            raise HTTPException(status_code=403, detail="Cannot edit another super admin's password.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=404, detail="User not found.")

    if len(req.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters.")

    try:
        supabase.auth.admin.update_user_by_id(target_uid, {"password": req.new_password})
        supabase.table("audit_logs").insert({
            "action": "SUPERADMIN_EDIT_PASSWORD",
            "document": {"admin_uid": admin_uid, "target_uid": target_uid},
        }).execute()
        return {"success": True, "message": f"Password for {target_uid} updated successfully."}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to update password: {exc}")


@router.delete("/superadmin/delete-user/{target_uid}")
def superadmin_delete_user(target_uid: str, admin_uid: str = Depends(get_current_superadmin_uid)):
    supabase = get_supabase()
    try:
        target_res = supabase.auth.admin.get_user_by_id(target_uid)
        if (target_res.user.app_metadata or {}).get("role") == "superadmin":
            raise HTTPException(status_code=403, detail="Cannot delete a super admin account.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=404, detail="User not found.")

    try:
        supabase.auth.admin.delete_user(target_uid)
        supabase.table("users").delete().eq("uid", target_uid).execute()
        supabase.table("audit_logs").insert({
            "action": "SUPERADMIN_DELETE_USER",
            "document": {"admin_uid": admin_uid, "deleted_uid": target_uid},
        }).execute()
        return {"success": True, "message": f"User {target_uid} deleted successfully."}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to delete user: {exc}")
