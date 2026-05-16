# main.py
# ─────────────────────────────────────────────────────────────────────────────
# Application entry point. Initialises Supabase, wires CORS, registers routers.
# Run with: uvicorn main:app --reload
# ─────────────────────────────────────────────────────────────────────────────

import base64
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

from supabase_config import get_supabase, build_user_row, merge_user_doc

app = FastAPI(
    title="MedAxis AI Backend",
    description="FastAPI service for the MedAxis AI Platform (Supabase edition)",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Root / Health ────────────────────────────────────────────────────────────

@app.get("/")
def read_root():
    return {"message": "Welcome to MedAxis AI Backend"}


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "MedAxis AI Backend"}


# ─── Auth Register ────────────────────────────────────────────────────────────

from routers.auth_helpers import RegisterRequest, generate_unique_id, build_standard_user_doc, get_any_authenticated_uid, normalize_phone


@app.post("/auth/register")
def register_user(req: RegisterRequest):
    """
    Public self-registration — patients ONLY.
    Doctor/hospital/superadmin accounts are created by privileged roles.
    """
    if not req.email or not req.password:
        raise HTTPException(status_code=400, detail="email and password are required.")
    if req.role in ("doctor", "hospital", "superadmin"):
        raise HTTPException(status_code=403, detail="Self-registration is not allowed for this role.")
    if req.role != "patient":
        raise HTTPException(status_code=400, detail="Only 'patient' self-registration is allowed.")

    supabase = get_supabase()
    try:
        # Create user in Supabase Auth with role in app_metadata
        auth_response = supabase.auth.admin.create_user({
            "email":         req.email,
            "password":      req.password,
            "email_confirm": True,
            "user_metadata": {"full_name": req.name},
            "app_metadata":  {"role": "patient"},
        })
        user = auth_response.user
        uid  = user.id

        health_id = generate_unique_id(supabase, "healthId", "PAT-", 6)
        name_parts = req.name.strip().split(" ", 1)
        first_name = name_parts[0]
        last_name  = name_parts[1] if len(name_parts) > 1 else ""
        normalized_phone = normalize_phone(req.phoneNumber)

        # Handle base64 profile image
        profile_image_url = req.profileImage
        if profile_image_url and profile_image_url.startswith("data:image/"):
            try:
                header, encoded = profile_image_url.split(",", 1)
                mime_type = header.split(";")[0].split(":")[1]
                file_ext  = mime_type.split("/")[1]
                image_data = base64.b64decode(encoded)
                path = f"profile_images/{uid}.{file_ext}"
                supabase.storage.from_("medaxis").upload(path, image_data, {"content-type": mime_type, "upsert": "true"})
                profile_image_url = supabase.storage.from_("medaxis").get_public_url(path)
            except Exception as img_err:
                print(f"Base64 image upload failed during registration: {img_err}")

        user_data = build_standard_user_doc(
            uid=uid, role="patient", email=req.email, name=req.name,
            firstName=first_name, lastName=last_name,
            healthId=health_id, phoneNumber=normalized_phone,
            profileImage=profile_image_url,
            height=req.height, weight=req.weight, bmi=req.bmi,
        )
        row = build_user_row(user_data)
        supabase.table("users").insert(row).execute()

        return {"success": True, "uid": uid, "healthId": health_id, "message": "Patient account registered successfully"}
    except HTTPException:
        raise
    except Exception as exc:
        msg = str(exc)
        if "already registered" in msg or "email_exists" in msg or "already been registered" in msg:
            raise HTTPException(status_code=400, detail="The email address is already in use.")
        raise HTTPException(status_code=500, detail=f"Registration failed: {msg}")


# ─── File Uploads ─────────────────────────────────────────────────────────────

@app.post("/upload/profile-image")
async def upload_profile_image(file: UploadFile = File(...), token_uid: str = Depends(get_any_authenticated_uid)):
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image.")
    file_bytes = await file.read()
    if len(file_bytes) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File size exceeds 5 MB limit.")

    try:
        supabase  = get_supabase()
        path      = f"profile_images/{token_uid}.jpg"
        supabase.storage.from_("medaxis").upload(path, file_bytes, {"content-type": file.content_type, "upsert": "true"})
        image_url = supabase.storage.from_("medaxis").get_public_url(path)
        merge_user_doc(supabase, token_uid, {"profileImage": image_url})
        return {"success": True, "profileImage": image_url, "message": "Profile image updated successfully."}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to upload profile image: {exc}")


@app.get("/user/me")
def get_current_user_profile(token_uid: str = Depends(get_any_authenticated_uid)):
    supabase = get_supabase()
    result = supabase.table("users").select("document, uid, role, email").eq("uid", token_uid).maybe_single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="User profile not found")
    row = result.data
    doc = dict(row.get("document") or {})
    doc.update({"uid": row["uid"], "role": row["role"], "email": row["email"]})
    return doc


# ─── Register Routers ─────────────────────────────────────────────────────────

from routers import auth, patient, doctor, hospital, superadmin

app.include_router(auth.router)
app.include_router(patient.router)
app.include_router(doctor.router)
app.include_router(hospital.router)
app.include_router(superadmin.router)
