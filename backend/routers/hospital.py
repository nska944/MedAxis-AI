# routers/hospital.py
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from supabase_config import get_supabase, build_user_row, maybe_one, merge_user_doc
from routers.auth_helpers import (
    get_current_hospital_uid,
    RoleAssignRequest,
    PatientAssignRequest,
    CreateDoctorRequest,
    generate_unique_id,
    build_standard_user_doc,
)

router = APIRouter()


class AddExistingDoctorRequest(BaseModel):
    email: str


@router.post("/hospital/add-existing-doctor")
def hospital_add_existing_doctor(req: AddExistingDoctorRequest, hospital_uid: str = Depends(get_current_hospital_uid)):
    """
    Affiliate an already-existing doctor account with THIS hospital by email.
    Sets the doctor's hospital_id + hospitalUid so they appear in this hospital's
    roster and can perform clinical actions.
    """
    supabase = get_supabase()
    try:
        hosp_res    = maybe_one(supabase.table("users").select("hospital_id").eq("uid", hospital_uid))
        hospital_id = (hosp_res.data or {}).get("hospital_id", "")
        if not hospital_id:
            raise HTTPException(status_code=403, detail="Hospital account is incomplete (missing hospitalId). Contact your super admin.")

        doc_res = maybe_one(supabase.table("users").select("uid, role, document, hospital_id").eq("email", req.email.strip().lower()))
        if not doc_res.data:
            # also try exact (non-lowercased) email in case it was stored mixed-case
            doc_res = maybe_one(supabase.table("users").select("uid, role, document, hospital_id").eq("email", req.email.strip()))
        if not doc_res.data:
            raise HTTPException(status_code=404, detail=f"No account found with email {req.email}.")
        if doc_res.data.get("role") != "doctor":
            raise HTTPException(status_code=400, detail="That account exists but is not a doctor.")

        doctor_uid    = doc_res.data["uid"]
        existing_hosp = doc_res.data.get("hospital_id", "")
        if existing_hosp and existing_hosp == hospital_id:
            raise HTTPException(status_code=400, detail="That doctor is already affiliated with your hospital.")
        if existing_hosp and existing_hosp != hospital_id:
            raise HTTPException(status_code=400, detail=f"That doctor is already affiliated with another hospital ({existing_hosp}).")

        merge_user_doc(supabase, doctor_uid, {"hospitalId": hospital_id, "hospitalUid": hospital_uid})

        supabase.table("audit_logs").insert({
            "action": "HOSPITAL_ADD_EXISTING_DOCTOR",
            "document": {"hospital_uid": hospital_uid, "hospital_id": hospital_id, "doctor_uid": doctor_uid, "email": req.email},
        }).execute()

        doc = doc_res.data.get("document") or {}
        return {
            "success": True,
            "doctor_uid": doctor_uid,
            "name": doc.get("name", ""),
            "message": "Doctor affiliated with your hospital successfully.",
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to add doctor: {exc}")


@router.post("/hospital/create-doctor")
def hospital_create_doctor(req: CreateDoctorRequest, hospital_uid: str = Depends(get_current_hospital_uid)):
    supabase = get_supabase()
    try:
        hosp_res  = maybe_one(supabase.table("users").select("hospital_id, document").eq("uid", hospital_uid))
        hosp_data = (hosp_res.data or {}).get("document") or {}
        hospital_id = (hosp_res.data or {}).get("hospital_id") or hosp_data.get("hospitalId", "")
        if not hospital_id:
            raise HTTPException(status_code=403, detail="Hospital account is incomplete (missing hospitalId). Contact your super admin.")

        hospital_code = hospital_id.split("-")[-1]

        auth_response = supabase.auth.admin.create_user({
            "email":         req.email,
            "password":      req.password,
            "email_confirm": True,
            "user_metadata": {"full_name": req.name},
            "app_metadata":  {"role": "doctor"},
        })
        user = auth_response.user
        uid  = user.id

        doctor_id   = generate_unique_id(supabase, "doctorId",   "DOC-",               4)
        employee_id = generate_unique_id(supabase, "employeeId", f"EMP-{hospital_code}-", 4, digits_only=True)

        user_data = build_standard_user_doc(
            uid=uid, role="doctor", email=req.email, name=req.name,
            doctorId=doctor_id, employeeId=employee_id,
            hospitalId=hospital_id, hospitalUid=hospital_uid,
            created_by=hospital_uid,
        )
        supabase.table("users").insert(build_user_row(user_data)).execute()

        supabase.table("audit_logs").insert({
            "action": "HOSPITAL_CREATE_DOCTOR",
            "document": {"hospital_uid": hospital_uid, "hospital_id": hospital_id,
                         "created_uid": uid, "doctor_id": doctor_id, "employee_id": employee_id, "email": req.email},
        }).execute()

        return {
            "success": True, "uid": uid,
            "doctorId": doctor_id, "employeeId": employee_id,
            "hospitalId": hospital_id,
            "message": "Doctor account created and affiliated successfully",
        }
    except HTTPException:
        raise
    except Exception as exc:
        msg = str(exc)
        if "already registered" in msg or "email_exists" in msg:
            raise HTTPException(status_code=400, detail="The email address is already in use.")
        raise HTTPException(status_code=500, detail=f"Failed to create doctor account: {msg}")


@router.get("/hospital/doctors")
def get_hospital_doctors(uid: str = Depends(get_current_hospital_uid)):
    supabase = get_supabase()
    try:
        hosp_res  = maybe_one(supabase.table("users").select("hospital_id").eq("uid", uid))
        hospital_id = (hosp_res.data or {}).get("hospital_id", "")
        if not hospital_id:
            raise HTTPException(status_code=403, detail="Hospital account is incomplete (missing hospitalId).")

        docs_res = supabase.table("users").select("uid, email, hospital_id, document").eq("role", "doctor").eq("hospital_id", hospital_id).execute()
        doctors  = []
        for row in (docs_res.data or []):
            doc_data   = row.get("document") or {}
            assign_res = supabase.table("doctor_assignments").select("patient_uid").eq("doctor_uid", row["uid"]).eq("status", "active").execute()
            doctors.append({
                "uid":            row["uid"],
                "email":          row.get("email", ""),
                "name":           doc_data.get("name", ""),
                "doctorId":       doc_data.get("doctorId", ""),
                "employeeId":     doc_data.get("employeeId", ""),
                "patient_count":  len(assign_res.data or []),
                "profileImage":   doc_data.get("profileImage", ""),
                "specialization": doc_data.get("specialization", ""),
            })
        return {"doctors": doctors, "total": len(doctors)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch doctors: {exc}")


@router.get("/hospital/patients")
def get_hospital_patients(uid: str = Depends(get_current_hospital_uid)):
    supabase = get_supabase()
    try:
        hosp_res  = maybe_one(supabase.table("users").select("hospital_id").eq("uid", uid))
        hospital_id = (hosp_res.data or {}).get("hospital_id", "")
        if not hospital_id:
            raise HTTPException(status_code=403, detail="Hospital account is incomplete (missing hospitalId).")

        docs_res  = supabase.table("users").select("uid").eq("role", "doctor").eq("hospital_id", hospital_id).execute()
        doctor_uids = [r["uid"] for r in (docs_res.data or [])]

        patient_uid_set: set = set()
        for doc_uid in doctor_uids:
            a_res = supabase.table("doctor_assignments").select("patient_uid").eq("doctor_uid", doc_uid).eq("status", "active").execute()
            for a in (a_res.data or []):
                patient_uid_set.add(a["patient_uid"])

        patients = []
        for p_uid in patient_uid_set:
            p_res = maybe_one(supabase.table("users").select("uid, email, document").eq("uid", p_uid))
            if p_res.data:
                p_data = p_res.data.get("document") or {}
                patients.append({
                    "uid":      p_uid,
                    "name":     p_data.get("name", ""),
                    "email":    p_res.data.get("email", ""),
                    "healthId": p_data.get("healthId", ""),
                })
        return {"patients": patients, "total": len(patients)}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch patients: {exc}")


@router.get("/hospital/stats")
def get_hospital_stats(uid: str = Depends(get_current_hospital_uid)):
    supabase = get_supabase()
    try:
        hosp_res  = maybe_one(supabase.table("users").select("hospital_id").eq("uid", uid))
        hospital_id = (hosp_res.data or {}).get("hospital_id", "")
        if not hospital_id:
            raise HTTPException(status_code=403, detail="Hospital account is incomplete (missing hospitalId).")

        docs_res    = supabase.table("users").select("uid").eq("role", "doctor").eq("hospital_id", hospital_id).execute()
        doctor_uids = [r["uid"] for r in (docs_res.data or [])]
        total_doctors = len(doctor_uids)

        patient_uid_set: set = set()
        for doc_uid in doctor_uids:
            a_res = supabase.table("doctor_assignments").select("patient_uid").eq("doctor_uid", doc_uid).eq("status", "active").execute()
            for a in (a_res.data or []):
                patient_uid_set.add(a["patient_uid"])
        total_patients = len(patient_uid_set)

        alerts_res     = supabase.table("alerts").select("patient_uid").eq("status", "unresolved").eq("risk_level", "High").execute()
        high_risk_alerts = sum(1 for a in (alerts_res.data or []) if a.get("patient_uid") in patient_uid_set)

        return {"total_doctors": total_doctors, "total_patients": total_patients, "high_risk_alerts": high_risk_alerts}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch hospital stats: {exc}")


@router.get("/hospital/audit-logs")
def get_audit_logs(uid: str = Depends(get_current_hospital_uid)):
    supabase = get_supabase()
    try:
        result = supabase.table("audit_logs").select("*").order("timestamp", desc=True).limit(50).execute()
        logs   = []
        for row in (result.data or []):
            doc = dict(row.get("document") or {})
            doc["action"]    = row.get("action", "")
            doc["timestamp"] = row.get("timestamp", "")
            logs.append(doc)
        return {"audit_logs": logs}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch audit logs: {exc}")


@router.post("/hospital/assign-patient")
def assign_patient_to_doctor(req: PatientAssignRequest, uid: str = Depends(get_current_hospital_uid)):
    supabase = get_supabase()
    if req.hospital_uid != uid:
        raise HTTPException(status_code=400, detail="Mismatched assigner ID.")
    try:
        # Verify doctor is affiliated with this hospital
        doc_res     = maybe_one(supabase.table("users").select("uid, hospital_id").eq("uid", req.doctor_uid).eq("role", "doctor"))
        hosp_res    = maybe_one(supabase.table("users").select("hospital_id").eq("uid", uid))
        if not doc_res.data:
            raise HTTPException(status_code=404, detail="Doctor not found.")
        if doc_res.data.get("hospital_id") != (hosp_res.data or {}).get("hospital_id"):
            raise HTTPException(status_code=403, detail="Doctor is not affiliated with your hospital.")

        # Verify patient exists
        pat_res = maybe_one(supabase.table("users").select("uid").eq("uid", req.patient_uid))
        if not pat_res.data:
            raise HTTPException(status_code=404, detail="Patient not found.")

        supabase.table("doctor_assignments").upsert({
            "doctor_uid":  req.doctor_uid,
            "patient_uid": req.patient_uid,
            "assigned_by": req.hospital_uid,
            "status":      "active",
        }).execute()

        supabase.table("audit_logs").insert({
            "action": "ASSIGN_PATIENT",
            "document": {"hospital_uid": req.hospital_uid, "doctor_uid": req.doctor_uid, "patient_uid": req.patient_uid},
        }).execute()

        return {"message": "Patient successfully assigned to doctor."}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to assign patient: {exc}")


@router.post("/admin/assign-role")
def assign_user_role(req: RoleAssignRequest):
    if req.role not in ("doctor", "hospital"):
        raise HTTPException(status_code=400, detail="Invalid role. Must be 'doctor' or 'hospital'.")
    supabase = get_supabase()
    try:
        assigner_res = supabase.auth.admin.get_user_by_id(req.assigner_uid)
        if (assigner_res.user.app_metadata or {}).get("role") != "hospital":
            raise HTTPException(status_code=403, detail="Unauthorized: Only hospital administrators can assign roles.")

        supabase.auth.admin.update_user_by_id(req.target_uid, {"app_metadata": {"role": req.role}})
        from supabase_config import merge_user_doc
        merge_user_doc(supabase, req.target_uid, {"role": req.role})

        supabase.table("audit_logs").insert({
            "action": "ASSIGN_ROLE",
            "document": {"assigner_uid": req.assigner_uid, "target_uid": req.target_uid, "assigned_role": req.role},
        }).execute()

        return {"message": f"Successfully assigned role '{req.role}' to user {req.target_uid}."}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to assign role: {exc}")
