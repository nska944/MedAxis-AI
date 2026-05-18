# routers/patient.py
# ─────────────────────────────────────────────────────────────────────────────
# All /patient/*, /fhir/*, /family/*, /upload/blood-report endpoints.
# Firebase Admin + Firestore → Supabase.
# ─────────────────────────────────────────────────────────────────────────────

import random
import uuid
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from supabase_config import get_supabase, merge_user_doc
from fhir_utils import (
    build_fhir_patient,
    calculate_bmi,
    build_fhir_observation,
    build_fhir_diagnostic_report,
)
from ai_engine import analyze_blood_report
from pdf_parser import extract_text_from_file
from prescription_utils import build_prescription_bundle

from routers.auth_helpers import (
    get_current_patient_uid,
    get_any_authenticated_uid,
    get_authenticated_user_info,
    PatientRequest,
    VitalsRequest,
    DiagnosticReportRequest,
    PatientConsentRequest,
    StepLogRequest,
    SyncStepsRequest,
    OTPGenerateRequest,
    OTPVerifyRequest,
    normalize_phone,
    send_email_otp,
    REWARD_TIERS,
)

router = APIRouter()


# ─── FHIR Resource Creation ────────────────────────────────────────────────────

@router.post("/fhir/patient")
def create_fhir_patient(patient: PatientRequest):
    supabase = get_supabase()
    try:
        updates = {
            "firstName": patient.firstName,
            "lastName":  patient.lastName,
            "name":      f"{patient.firstName} {patient.lastName}".strip() or "Patient",
            "gender":    patient.gender,
            "birthDate": patient.birthDate,
        }
        merge_user_doc(supabase, patient.uid, updates)

        fhir_json = build_fhir_patient(
            uid=patient.uid,
            first_name=patient.firstName,
            last_name=patient.lastName,
            gender=patient.gender,
            birth_date=patient.birthDate,
            health_id=patient.healthId or "",
        )
        supabase.table("fhir_patients").upsert({"user_id": patient.uid, "document": fhir_json}).execute()
        return {"message": "FHIR Patient registered successfully", "data": fhir_json}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create FHIR Patient: {exc}")


@router.post("/fhir/observation/vitals")
def create_fhir_vitals(vitals: VitalsRequest):
    supabase = get_supabase()
    try:
        observations = []
        if vitals.height_cm is not None and vitals.weight_kg is not None:
            bmi = calculate_bmi(vitals.height_cm, vitals.weight_kg)
            observations += [
                build_fhir_observation(vitals.uid, "8302-2",  "Body Height", vitals.height_cm, "cm",     "cm"),
                build_fhir_observation(vitals.uid, "29463-7", "Body Weight", vitals.weight_kg, "kg",     "kg"),
                build_fhir_observation(vitals.uid, "39156-5", "Body Mass Index", bmi,          "kg/m2",  "kg/m2"),
            ]
        if vitals.heartRate is not None:
            observations.append(build_fhir_observation(vitals.uid, "8867-4", "Heart rate", vitals.heartRate, "/min", "/min"))
        if vitals.oxygen is not None:
            observations.append(build_fhir_observation(vitals.uid, "59408-5", "Oxygen saturation", vitals.oxygen, "%", "%"))

        for obs in observations:
            supabase.table("fhir_observations").upsert({
                "id": obs["id"], "user_id": vitals.uid,
                "collection_type": "vitals", "document": obs,
            }).execute()

        return {"message": "FHIR Vitals created successfully", "data": observations}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create FHIR Vitals: {exc}")


@router.post("/fhir/diagnostic-report")
def create_diagnostic_report(report_req: DiagnosticReportRequest):
    supabase = get_supabase()
    try:
        observations = []
        labs = report_req.labValues
        if labs.hemoglobin is not None:
            observations.append(build_fhir_observation(report_req.uid, "718-7",    "Hemoglobin",         labs.hemoglobin, "g/dL",   "g/dL"))
        if labs.vitaminD is not None:
            observations.append(build_fhir_observation(report_req.uid, "62292-8",  "25-hydroxyvitamin D", labs.vitaminD,  "ng/mL",  "ng/mL"))
        if labs.glucose is not None:
            observations.append(build_fhir_observation(report_req.uid, "2345-7",   "Glucose",             labs.glucose,   "mg/dL",  "mg/dL"))

        obs_ids = [obs["id"] for obs in observations]
        report  = build_fhir_diagnostic_report(report_req.uid, obs_ids)

        supabase.table("fhir_reports").upsert({
            "id": report["id"], "user_id": report_req.uid,
            "collection_type": "reports", "document": report,
        }).execute()
        for obs in observations:
            supabase.table("fhir_reports").upsert({
                "id": obs["id"], "user_id": report_req.uid,
                "collection_type": "observations", "document": obs,
            }).execute()

        return {"message": "FHIR Diagnostic Report created", "data": report, "observations_created": len(observations)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to create FHIR Diagnostic Report: {exc}")


# ─── Blood Report Upload ───────────────────────────────────────────────────────

@router.post("/upload/blood-report")
async def upload_blood_report(uid: str = Form(...), file: UploadFile = File(...)):
    import time
    supabase   = get_supabase()
    file_bytes = await file.read()
    try:
        t0 = time.perf_counter()
        safe_name = file.filename.replace(" ", "_")
        path      = f"blood_reports/{uid}/{safe_name}"
        supabase.storage.from_("medaxis").upload(path, file_bytes, {"content-type": file.content_type, "upsert": "true"})
        pdf_url = supabase.storage.from_("medaxis").get_public_url(path)
        t_upload = time.perf_counter() - t0

        t1 = time.perf_counter()
        raw_text = extract_text_from_file(file_bytes, file.filename)
        t_extract = time.perf_counter() - t1

        t2 = time.perf_counter()
        ai_summary = analyze_blood_report(raw_text)
        t_ai = time.perf_counter() - t2
        print(f"[upload-blood] {file.filename}: storage={t_upload:.1f}s  extract={t_extract:.1f}s  ai={t_ai:.1f}s")

        observations = []
        for val in ai_summary.get("all_values", []):
            try:
                numeric = float("".join(c for c in str(val.get("value", "0")) if c.isdigit() or c == "."))
                obs = build_fhir_observation(uid, "lab-value", val.get("test", "Unknown"), numeric, val.get("unit", ""), val.get("unit", ""))
                observations.append(obs)
            except (ValueError, TypeError):
                pass

        note_parts = [f"AI Risk Level: {ai_summary.get('risk_level', 'Unknown')}",
                      f"\nClinical Summary: {ai_summary.get('clinical_summary', 'N/A')}"]
        for ab in ai_summary.get("abnormal_values", []):
            note_parts.append(f"  • {ab.get('test','?')}: {ab.get('value','?')} (Ref: {ab.get('reference_range','?')}) — {ab.get('status','?')}")
        for r in ai_summary.get("lifestyle_recommendations", []):
            note_parts.append(f"  - {r}")

        report = build_fhir_diagnostic_report(uid, [o["id"] for o in observations])
        report["presentedForm"] = [{"url": pdf_url, "title": file.filename}]
        report["note"]          = [{"text": "\n".join(note_parts)}]

        supabase.table("fhir_reports").upsert({
            "id": report["id"], "user_id": uid,
            "collection_type": "reports", "document": report,
        }).execute()
        for obs in observations:
            supabase.table("fhir_reports").upsert({
                "id": obs["id"], "user_id": uid,
                "collection_type": "observations", "document": obs,
            }).execute()

        if ai_summary.get("risk_level") == "High":
            alert_id = str(uuid.uuid4())
            supabase.table("alerts").insert({
                "id": alert_id, "patient_uid": uid,
                "report_id": report["id"], "risk_level": "High",
                "status": "unresolved", "document": {},
            }).execute()

        return {"message": "Blood Report uploaded and analysed.", "pdf_url": pdf_url,
                "ai_analysis": ai_summary, "fhir_report": report}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to process Blood Report: {exc}")


@router.post("/upload/prescription")
async def upload_prescription(uid: str = Form(...), file: UploadFile = File(...)):
    from ai_engine import analyze_prescription
    supabase   = get_supabase()
    file_bytes = await file.read()
    try:
        unique_id = str(uuid.uuid4())[:8]
        safe_name = file.filename.replace(" ", "_")
        path      = f"prescriptions/{uid}/{unique_id}_{safe_name}"
        supabase.storage.from_("medaxis").upload(path, file_bytes, {"content-type": file.content_type, "upsert": "true"})
        file_url = supabase.storage.from_("medaxis").get_public_url(path)

        raw_text   = extract_text_from_file(file_bytes, file.filename)
        ai_summary = analyze_prescription(raw_text)
        report_id  = str(uuid.uuid4())

        prescription_data = {
            "id":               report_id,
            "patient_uid":      uid,
            "filename":         file.filename,
            "file_url":         file_url,
            "created_at":       datetime.utcnow().isoformat(),
            "ai_analysis":      ai_summary,
            "raw_text_preview": raw_text[:500],
        }
        supabase.table("fhir_prescriptions").insert({
            "id": report_id, "user_id": uid, "document": prescription_data,
        }).execute()

        return {"message": "Prescription uploaded and analysed.", "file_url": file_url,
                "ai_analysis": ai_summary, "report_id": report_id}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to process Prescription: {exc}")


# ─── Patient Data Endpoints ───────────────────────────────────────────────────

@router.get("/patient/reports")
def get_patient_reports(uid: str = Depends(get_current_patient_uid)):
    supabase = get_supabase()
    try:
        reports_res = supabase.table("fhir_reports").select("document").eq("user_id", uid).eq("collection_type", "reports").execute()
        obs_res     = supabase.table("fhir_reports").select("document").eq("user_id", uid).eq("collection_type", "observations").execute()
        reports      = [r["document"] for r in (reports_res.data or [])]
        observations = [r["document"] for r in (obs_res.data or [])]
        return {"uid": uid, "reports": reports, "observations": observations}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch patient reports: {exc}")


@router.get("/patient/vitals")
def get_patient_vitals(uid: str = Depends(get_current_patient_uid)):
    supabase = get_supabase()
    try:
        result = supabase.table("fhir_observations").select("document").eq("user_id", uid).eq("collection_type", "vitals").execute()
        vitals = [r["document"] for r in (result.data or [])]
        return {"uid": uid, "vitals": vitals}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch patient vitals: {exc}")


@router.get("/patient/doctors")
def get_all_doctors(uid: str = Depends(get_current_patient_uid)):
    supabase = get_supabase()
    try:
        result  = supabase.table("users").select("uid, email, document").eq("role", "doctor").execute()
        doctors = []
        for row in (result.data or []):
            d = row.get("document") or {}
            doctors.append({
                "uid":            row["uid"],
                "name":           d.get("name", "Unknown Doctor"),
                "email":          row.get("email", ""),
                "specialization": d.get("specialization", "General Medicine"),
                "profileImage":   d.get("profileImage", ""),
            })
        return {"doctors": doctors}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch doctors: {exc}")


@router.get("/patient/consents")
def get_patient_consents(uid: str = Depends(get_current_patient_uid)):
    supabase = get_supabase()
    try:
        result   = supabase.table("consents").select("doctor_uid").eq("patient_uid", uid).eq("granted", True).execute()
        consents = [r["doctor_uid"] for r in (result.data or [])]
        return {"consents": consents}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to fetch consents: {exc}")


@router.post("/patient/grant-consent")
def grant_patient_consent(req: PatientConsentRequest, uid: str = Depends(get_current_patient_uid)):
    supabase = get_supabase()
    try:
        supabase.table("consents").upsert({
            "patient_uid": uid, "doctor_uid": req.doctor_uid,
            "granted": True, "timestamp": datetime.utcnow().isoformat(),
        }).execute()
        return {"message": "Consent granted successfully."}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to grant consent: {exc}")


@router.post("/patient/revoke-consent")
def revoke_patient_consent(req: PatientConsentRequest, uid: str = Depends(get_current_patient_uid)):
    supabase = get_supabase()
    try:
        supabase.table("consents").upsert({
            "patient_uid": uid, "doctor_uid": req.doctor_uid,
            "granted": False, "timestamp": datetime.utcnow().isoformat(),
        }).execute()
        return {"message": "Consent revoked successfully."}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to revoke consent: {exc}")


@router.post("/patient/log-steps")
def log_steps(req: StepLogRequest, uid: str = Depends(get_current_patient_uid)):
    supabase = get_supabase()
    try:
        today  = datetime.utcnow().strftime("%Y-%m-%d")
        result = supabase.table("step_rewards").select("*").eq("user_id", uid).maybe_single().execute()
        data   = result.data or {"daily_steps": {}, "total_points": 0, "rewards_claimed": []}

        points = 0
        for threshold, pts in REWARD_TIERS:
            if req.steps >= threshold:
                points = pts
                break

        data["daily_steps"][today] = req.steps
        data["total_points"]       = data.get("total_points", 0) + points
        supabase.table("step_rewards").upsert({
            "user_id": uid, "daily_steps": data["daily_steps"],
            "total_points": data["total_points"], "rewards_claimed": data.get("rewards_claimed", []),
        }).execute()

        return {"message": f"Logged {req.steps} steps for {today}", "points_earned": points,
                "total_points": data["total_points"], "steps_today": req.steps}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/patient/sync-steps")
def sync_steps(req: SyncStepsRequest, uid: str = Depends(get_current_patient_uid)):
    import requests as http_requests
    supabase = get_supabase()
    try:
        now           = datetime.utcnow()
        start_of_day  = datetime(now.year, now.month, now.day, 0, 0, 0)
        start_millis  = int(start_of_day.timestamp() * 1000)
        end_millis    = int(now.timestamp() * 1000)

        fit_url  = "https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate"
        headers  = {"Authorization": f"Bearer {req.google_access_token}", "Content-Type": "application/json"}
        payload  = {
            "aggregateBy":   [{"dataTypeName": "com.google.step_count.delta"}],
            "bucketByTime":  {"durationMillis": 86400000},
            "startTimeMillis": start_millis,
            "endTimeMillis":   end_millis,
        }
        resp = http_requests.post(fit_url, headers=headers, json=payload)
        if resp.status_code == 401:
            raise HTTPException(status_code=401, detail="Google Access Token expired or invalid")
        elif resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=f"Google Fit Error: {resp.text}")

        total_steps = sum(
            val.get("intVal", 0)
            for bucket in resp.json().get("bucket", [])
            for dataset in bucket.get("dataset", [])
            for point in dataset.get("point", [])
            for val in point.get("value", [])
        )

        today_str = now.strftime("%Y-%m-%d")
        result    = supabase.table("step_rewards").select("*").eq("user_id", uid).maybe_single().execute()
        data      = result.data or {"daily_steps": {}, "total_points": 0, "rewards_claimed": []}

        prev_steps = data["daily_steps"].get(today_str, 0)
        prev_pts   = next((pts for thr, pts in REWARD_TIERS if prev_steps >= thr), 0)
        new_pts    = next((pts for thr, pts in REWARD_TIERS if total_steps >= thr), 0)

        data["total_points"]          = data.get("total_points", 0) - prev_pts + new_pts
        data["daily_steps"][today_str] = total_steps
        supabase.table("step_rewards").upsert({
            "user_id": uid, "daily_steps": data["daily_steps"],
            "total_points": data["total_points"], "rewards_claimed": data.get("rewards_claimed", []),
        }).execute()

        return {"message": f"Synced {total_steps} steps from Google Fit for {today_str}",
                "points_earned": new_pts, "total_points": data["total_points"], "steps_synced": total_steps}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/patient/step-rewards")
def get_step_rewards(uid: str = Depends(get_current_patient_uid)):
    supabase = get_supabase()
    try:
        result = supabase.table("step_rewards").select("*").eq("user_id", uid).maybe_single().execute()
        if not result.data:
            return {"daily_steps": {}, "total_points": 0, "rewards_claimed": []}
        row = result.data
        return {"daily_steps": row.get("daily_steps", {}), "total_points": row.get("total_points", 0),
                "rewards_claimed": row.get("rewards_claimed", [])}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/patient/prescriptions")
def get_patient_prescriptions(uid: str = Depends(get_current_patient_uid)):
    supabase = get_supabase()
    try:
        result = supabase.table("fhir_prescriptions").select("document").eq("user_id", uid).order("created_at", desc=True).execute()
        prescriptions = [r["document"] for r in (result.data or [])]
        return {"prescriptions": prescriptions}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


class CheckupDateRequest(BaseModel):
    lastCheckupDate: str


@router.patch("/patient/update-checkup-date")
def update_checkup_date(req: CheckupDateRequest, uid: str = Depends(get_current_patient_uid)):
    supabase = get_supabase()
    try:
        merge_user_doc(supabase, uid, {"lastCheckupDate": req.lastCheckupDate})
        return {"message": "Checkup date updated.", "lastCheckupDate": req.lastCheckupDate}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/patient/me")
def get_patient_me(uid: str = Depends(get_current_patient_uid)):
    supabase = get_supabase()
    try:
        result = supabase.table("users").select("document, uid, role, email").eq("uid", uid).maybe_single().execute()
        if not result.data:
            raise HTTPException(status_code=404, detail="Patient profile not found.")
        row  = result.data
        data = dict(row.get("document") or {})
        data.update({"uid": row["uid"], "role": row["role"], "email": row["email"]})
        return {
            "uid":            data.get("uid", uid),
            "name":           data.get("name", ""),
            "firstName":      data.get("firstName", ""),
            "lastName":       data.get("lastName", ""),
            "gender":         data.get("gender", ""),
            "birthDate":      data.get("birthDate", ""),
            "email":          data.get("email", ""),
            "healthId":       data.get("healthId", ""),
            "profileImage":   data.get("profileImage", ""),
            "height":         data.get("height", ""),
            "weight":         data.get("weight", ""),
            "bmi":            data.get("bmi", ""),
            "role":           data.get("role", "patient"),
            "lastCheckupDate":data.get("lastCheckupDate", ""),
            "faceData":       data.get("faceData"),
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


class FaceDataRequest(BaseModel):
    faceData: list


@router.patch("/patient/face-data")
def update_face_data(req: FaceDataRequest, uid: str = Depends(get_current_patient_uid)):
    """Store face descriptor for 3-layer patient authentication."""
    supabase = get_supabase()
    try:
        merge_user_doc(supabase, uid, {"faceData": req.faceData})
        return {"message": "Face data updated successfully."}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/patient/lookup")
def lookup_patient_by_health_id(health_id: str, requester: dict = Depends(get_authenticated_user_info)):
    supabase       = get_supabase()
    requester_uid  = requester["uid"]
    requester_role = requester["role"]

    if requester_role not in ("doctor", "hospital", "superadmin"):
        raise HTTPException(status_code=403, detail="Access denied — clinical staff only.")

    try:
        result = supabase.table("users").select("uid, document, email").eq("role", "patient").eq("health_id", health_id).limit(1).execute()
        if not result.data:
            raise HTTPException(status_code=404, detail=f"No patient found with Health ID: {health_id}")

        row          = result.data[0]
        matched_uid  = row["uid"]
        matched_data = dict(row.get("document") or {})
        matched_data.setdefault("email", row.get("email", ""))

        if requester_role == "doctor":
            consent = supabase.table("consents").select("granted").eq("patient_uid", matched_uid).eq("doctor_uid", requester_uid).maybe_single().execute()
            has_consent = consent.data and consent.data.get("granted") is True

            assignment = supabase.table("doctor_assignments").select("status").eq("doctor_uid", requester_uid).eq("patient_uid", matched_uid).maybe_single().execute()
            has_assign  = assignment.data and assignment.data.get("status") == "active"

            if not has_consent and not has_assign:
                raise HTTPException(status_code=403, detail="Access denied — patient consent required.")

        reports_res = supabase.table("fhir_reports").select("document").eq("user_id", matched_uid).eq("collection_type", "reports").execute()
        rx_res      = supabase.table("fhir_prescriptions").select("document").eq("user_id", matched_uid).execute()

        return {
            "found": True,
            "patient": {
                "uid":    matched_uid,
                "name":   matched_data.get("name", "Unknown"),
                "email":  matched_data.get("email", ""),
                "healthId": matched_data.get("healthId", ""),
                "height": matched_data.get("height", ""),
                "weight": matched_data.get("weight", ""),
                "bmi":    matched_data.get("bmi", ""),
            },
            "reports":       [r["document"] for r in (reports_res.data or [])],
            "prescriptions": [r["document"] for r in (rx_res.data or [])],
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


# ─── 3-Layer Security OTP ─────────────────────────────────────────────────────

@router.post("/patient/generate-otp")
def generate_patient_otp(req: OTPGenerateRequest, background_tasks: BackgroundTasks):
    """
    Generate an OTP, store it, return immediately, and dispatch SMS + email in the background.
    Twilio/SMTP can take 5-30s; we don't make the frontend wait for them.
    """
    supabase = get_supabase()
    try:
        otp_code   = str(random.randint(100000, 999999))
        expires_at = (datetime.utcnow() + timedelta(minutes=5)).isoformat()

        supabase.table("login_otps").upsert({
            "uid":        req.uid,
            "otp":        otp_code,
            "expires_at": expires_at,
        }).execute()

        print(f"\n{'='*50}\n[LAYER 2] OTP for Patient {req.uid}: {otp_code}\n{'='*50}\n")

        user_result = supabase.table("users").select("document, email").eq("uid", req.uid).maybe_single().execute()
        if user_result.data:
            row        = user_result.data
            data       = row.get("document") or {}
            user_email = row.get("email") or data.get("email")
            if user_email:
                background_tasks.add_task(send_email_otp, user_email, otp_code)

        return {"message": "OTP generated and sent successfully."}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to generate OTP: {exc}")


@router.post("/patient/verify-otp")
def verify_patient_otp(req: OTPVerifyRequest):
    supabase = get_supabase()
    try:
        result = supabase.table("login_otps").select("*").eq("uid", req.uid).maybe_single().execute()
        if not result.data:
            raise HTTPException(status_code=400, detail="No active OTP found. Please request a new one.")

        data       = result.data
        expires_at = data.get("expires_at", "")
        if isinstance(expires_at, str):
            expires_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        else:
            expires_dt = expires_at

        if datetime.utcnow().timestamp() > expires_dt.timestamp():
            supabase.table("login_otps").delete().eq("uid", req.uid).execute()
            raise HTTPException(status_code=400, detail="OTP has expired. Please request a new one.")

        if data.get("otp") != req.otp:
            raise HTTPException(status_code=400, detail="Invalid OTP code.")

        supabase.table("login_otps").delete().eq("uid", req.uid).execute()
        return {"message": "OTP verified successfully", "success": True}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to verify OTP: {exc}")


# ─── Family Health Tracking ───────────────────────────────────────────────────

class FamilyMemberRequest(BaseModel):
    name: str
    age: int
    relation: str
    lastCheckupDate: Optional[str] = ""
    medicalNotes:    Optional[str] = ""


@router.post("/family/member")
def add_family_member(req: FamilyMemberRequest, uid: str = Depends(get_current_patient_uid)):
    supabase  = get_supabase()
    member_id = str(uuid.uuid4())
    try:
        doc = {
            "id":              member_id,
            "name":            req.name,
            "age":             req.age,
            "relation":        req.relation,
            "lastCheckupDate": req.lastCheckupDate or "",
            "medicalNotes":    req.medicalNotes or "",
            "uid":             uid,
            "createdAt":       datetime.utcnow().isoformat(),
        }
        supabase.table("family_members").insert({"id": member_id, "patient_uid": uid, "document": doc}).execute()
        return {"message": "Family member added.", "member_id": member_id, "member": doc}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/family/members")
def get_family_members(uid: str = Depends(get_current_patient_uid)):
    supabase = get_supabase()
    try:
        result  = supabase.table("family_members").select("id, document").eq("patient_uid", uid).execute()
        members = []
        for row in (result.data or []):
            d = dict(row.get("document") or {})
            d["id"] = row["id"]
            members.append(d)
        return {"members": members}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.patch("/family/member/{member_id}")
def update_family_member(member_id: str, req: FamilyMemberRequest, uid: str = Depends(get_current_patient_uid)):
    supabase = get_supabase()
    try:
        existing = supabase.table("family_members").select("document").eq("id", member_id).eq("patient_uid", uid).maybe_single().execute()
        doc = dict((existing.data or {}).get("document") or {})
        doc.update({
            "name":            req.name,
            "age":             req.age,
            "relation":        req.relation,
            "lastCheckupDate": req.lastCheckupDate or "",
            "medicalNotes":    req.medicalNotes or "",
            "updatedAt":       datetime.utcnow().isoformat(),
        })
        supabase.table("family_members").update({"document": doc}).eq("id", member_id).eq("patient_uid", uid).execute()
        return {"message": "Family member updated."}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.delete("/family/member/{member_id}")
def delete_family_member(member_id: str, uid: str = Depends(get_current_patient_uid)):
    supabase = get_supabase()
    try:
        supabase.table("family_prescriptions").delete().eq("member_id", member_id).execute()
        supabase.table("family_members").delete().eq("id", member_id).eq("patient_uid", uid).execute()
        return {"message": "Family member deleted."}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/family/upload-prescription")
async def upload_family_prescription(
    uid: str = Form(...), member_id: str = Form(...), file: UploadFile = File(...)
):
    from ai_engine import analyze_prescription
    supabase   = get_supabase()
    file_bytes = await file.read()
    try:
        unique_id = str(uuid.uuid4())[:8]
        safe_name = file.filename.replace(" ", "_")
        path      = f"family/{uid}/{member_id}/prescriptions/{unique_id}_{safe_name}"
        supabase.storage.from_("medaxis").upload(path, file_bytes, {"content-type": file.content_type, "upsert": "true"})
        file_url = supabase.storage.from_("medaxis").get_public_url(path)

        raw_text   = extract_text_from_file(file_bytes, file.filename)
        ai_summary = analyze_prescription(raw_text)
        report_id  = str(uuid.uuid4())

        doc = {
            "id":          report_id,
            "member_id":   member_id,
            "patient_uid": uid,
            "filename":    file.filename,
            "file_url":    file_url,
            "uploaded_at": datetime.utcnow().isoformat(),
            "ai_analysis": ai_summary,
        }
        supabase.table("family_prescriptions").insert({
            "id": report_id, "member_id": member_id, "patient_uid": uid, "document": doc,
        }).execute()

        return {"message": "Prescription uploaded.", "file_url": file_url,
                "ai_analysis": ai_summary, "report_id": report_id}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Family prescription upload failed: {exc}")


@router.get("/family/member/{member_id}/prescriptions")
def get_family_member_prescriptions(member_id: str, uid: str = Depends(get_current_patient_uid)):
    supabase = get_supabase()
    try:
        result = supabase.table("family_prescriptions").select("document").eq("member_id", member_id).order("uploaded_at", desc=True).execute()
        return {"prescriptions": [r["document"] for r in (result.data or [])]}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
