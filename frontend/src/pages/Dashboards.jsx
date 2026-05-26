import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Building2, Stethoscope, User, LogOut, UserPlus, CheckCircle, AlertCircle, Search, FileText, Activity } from 'lucide-react';
import { ProfileImageUpload } from '../components/ProfileImageUpload';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// ─── Doctor Dashboard ──────────────────────────────────────────────────────

export const DoctorDashboard = () => {
    const { currentUser, logout } = useAuth();
    const [activeTab, setActiveTab] = useState('patients');
    const [reports, setReports] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [commentData, setCommentData] = useState({});

    const [searchId, setSearchId] = useState('');
    const [searchResult, setSearchResult] = useState(null);
    const [searchError, setSearchError] = useState('');
    const [searchLoading, setSearchLoading] = useState(false);
    const [patientPrescriptions, setPatientPrescriptions] = useState([]);
    const [rxCommentData, setRxCommentData] = useState({});   // { [rx_id]: text }
    const [rxCommentPosting, setRxCommentPosting] = useState({});  // { [rx_id]: bool }
    const [profileImage, setProfileImage] = useState(null);
    const [profile, setProfile] = useState(null);
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [profileForm, setProfileForm] = useState({
        specialization: '', qualification: '', yearsOfExperience: '', bio: ''
    });
    const [updateProfileLoading, setUpdateProfileLoading] = useState(false);

    useEffect(() => {
        const fetchProfile = async () => {
            if (!currentUser) return;
            try {
                const token = await currentUser.getIdToken();
                const res = await fetch(`${API_BASE_URL}/user/me`, { headers: { 'Authorization': `Bearer ${token}` } });
                if (res.ok) {
                    const data = await res.json();
                    setProfileImage(data.profileImage || null);
                    setProfile(data);
                    setProfileForm({
                        specialization: data.specialization || '',
                        qualification: data.qualification || '',
                        yearsOfExperience: data.yearsOfExperience || '',
                        bio: data.bio || ''
                    });
                }
            } catch (err) { console.error('Failed to fetch profile:', err); }
        };
        fetchProfile();
    }, [currentUser]);

    const handleProfileSubmit = async (e) => {
        e.preventDefault();
        setUpdateProfileLoading(true);
        try {
            const token = await currentUser.getIdToken();
            const res = await fetch(`${API_BASE_URL}/doctor/profile`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    specialization: profileForm.specialization,
                    qualification: profileForm.qualification,
                    yearsOfExperience: parseInt(profileForm.yearsOfExperience) || 0,
                    bio: profileForm.bio
                })
            });
            if (!res.ok) throw new Error('Failed to update profile');
            const data = await res.json();
            setProfile(prev => ({ ...prev, ...data.updates }));
            setIsEditingProfile(false);
            alert('Profile updated successfully!');
        } catch (err) {
            alert(err.message);
        } finally {
            setUpdateProfileLoading(false);
        }
    };

    // Prescription State
    const [showPrescribeModal, setShowPrescribeModal] = useState(false);
    const [prescribePatientUid, setPrescribePatientUid] = useState(null);
    const [prescriptionForm, setPrescriptionForm] = useState({
        medications: [{ name: '', dosage: '', frequency: '', duration: '' }],
        notes: ''
    });
    const [prescribeLoading, setPrescribeLoading] = useState(false);

    const handleAddMedicationRow = () => {
        setPrescriptionForm(prev => ({
            ...prev,
            medications: [...prev.medications, { name: '', dosage: '', frequency: '', duration: '' }]
        }));
    };

    const handleMedicationChange = (index, field, value) => {
        setPrescriptionForm(prev => {
            const newMeds = [...prev.medications];
            newMeds[index][field] = value;
            return { ...prev, medications: newMeds };
        });
    };

    const submitPrescription = async () => {
        const validMeds = prescriptionForm.medications.filter(m => m.name.trim() && m.dosage.trim());
        if (validMeds.length === 0) return alert('Please add at least one valid medication (name and dosage).');

        setPrescribeLoading(true);
        try {
            const token = await currentUser.getIdToken();
            const res = await fetch(`${API_BASE_URL}/doctor/add-prescription`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({
                    patient_uid: prescribePatientUid,
                    medications: validMeds,
                    notes: prescriptionForm.notes
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to create prescription');

            alert('Prescription created successfully!');
            setShowPrescribeModal(false);
            setPrescriptionForm({ medications: [{ name: '', dosage: '', frequency: '', duration: '' }], notes: '' });

            // Refetch search result if open
            if (searchId) handleSearch();

        } catch (err) {
            alert(err.message);
        } finally {
            setPrescribeLoading(false);
        }
    };

    useEffect(() => {
        const fetchReports = async () => {
            try {
                const token = await currentUser.getIdToken();
                const res = await fetch(`${API_BASE_URL}/doctor/reports?doctor_uid=${currentUser.uid}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const data = await res.json();
                if (res.ok) setReports(data.reports || []);
            } catch (err) { setError(err.message); }
            finally { setLoading(false); }
        };
        fetchReports();
    }, [currentUser]);

    const handleCommentChange = (reportId, value) => {
        setCommentData(prev => ({ ...prev, [reportId]: value }));
    };

    const submitComment = async (patientUid, reportId) => {
        const comment = commentData[reportId];
        if (!comment || !comment.trim()) return;
        try {
            const token = await currentUser.getIdToken();
            const res = await fetch(`${API_BASE_URL}/doctor/add-comment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ doctor_uid: currentUser.uid, patient_uid: patientUid, report_id: reportId, comment })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed');
            setReports(reports.map(rep => {
                if (rep.id === reportId) return { ...rep, note: [...(rep.note || []), data.note] };
                return rep;
            }));
            setCommentData(prev => ({ ...prev, [reportId]: "" }));
        } catch (err) { alert(err.message); }
    };

    const handleSearch = async () => {
        if (!searchId.trim()) return;
        setSearchLoading(true); setSearchError(''); setSearchResult(null); setPatientPrescriptions([]);
        try {
            const token = await currentUser.getIdToken();
            const res = await fetch(`${API_BASE_URL}/patient/lookup?health_id=${searchId.trim()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Not found');

            // Access not yet granted → backend created a pending request
            if (data.access_requested) {
                setSearchResult(null);
                setSearchError(`🔔 ${data.message}`);
                return;
            }

            setSearchResult(data);

            // Also fetch patient-uploaded prescriptions (with AI analysis)
            if (data.patient?.uid) {
                try {
                    const rxRes = await fetch(`${API_BASE_URL}/doctor/patient-prescriptions?patient_uid=${data.patient.uid}`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (rxRes.ok) {
                        const rxData = await rxRes.json();
                        setPatientPrescriptions(rxData.prescriptions || []);
                    }
                } catch (_) {}
            }
        } catch (err) { setSearchError(err.message); }
        finally { setSearchLoading(false); }
    };

    // Post a doctor comment on a patient-uploaded prescription
    const postRxComment = async (patientUid, rxId) => {
        const comment = rxCommentData[rxId]?.trim();
        if (!comment) return;
        setRxCommentPosting(p => ({ ...p, [rxId]: true }));
        try {
            const token = await currentUser.getIdToken();
            const res = await fetch(`${API_BASE_URL}/doctor/add-prescription-comment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ doctor_uid: currentUser.uid, patient_uid: patientUid, prescription_id: rxId, comment })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to post comment');
            // Append comment locally so UI updates instantly
            setPatientPrescriptions(prev => prev.map(rx =>
                rx.id === rxId
                    ? { ...rx, doctor_comments: [...(rx.doctor_comments || []), data.comment] }
                    : rx
            ));
            setRxCommentData(p => ({ ...p, [rxId]: '' }));
        } catch (err) { alert(err.message); }
        finally { setRxCommentPosting(p => ({ ...p, [rxId]: false })); }
    };

    const tabs = [
        { id: 'patients', label: '🔍 Search Patient' },
        { id: 'reports', label: '📋 My Patients' },
        { id: 'profile', label: '👤 Profile' },
    ];

    return (
        <div className="dashboard">
            <div className="dashboard-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: profileImage ? 'none' : 'var(--gradient-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        {profileImage ? <img src={profileImage} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Stethoscope size={20} color="white" />}
                    </div>
                    <div>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>Doctor Workspace</h2>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{currentUser?.email}</span>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span className="badge badge-success">Doctor</span>
                    <button onClick={logout} className="btn-outline" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><LogOut size={14} /> Sign Out</button>
                </div>
            </div>

            {/* Tabs */}
            <div className="tab-list">
                {tabs.map(tab => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}>{tab.label}</button>
                ))}
            </div>

            {error && <div className="error-msg"><AlertCircle size={16} /> {error}</div>}

            {/* Patient Search Tab */}
            {activeTab === 'patients' && (
                <div className="glass-panel">
                    <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Search size={20} /> Search Patient by Health ID</h3>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>Search for any patient across all hospitals. Enter their Health ID to view records.</p>
                    <div className="search-bar" style={{ marginBottom: '1rem' }}>
                        <input type="text" className="form-input" placeholder="e.g. PAT-A1B2C3" value={searchId} onChange={e => setSearchId(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} style={{ margin: 0, flex: 1 }} />
                        <button className="btn-primary" style={{ margin: 0, width: 'auto' }} onClick={handleSearch} disabled={searchLoading}>{searchLoading ? '...' : 'Search'}</button>
                    </div>
                    {searchError && <div style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '1rem' }}>{searchError}</div>}

                    {searchResult && (
                        <div style={{ marginTop: '1rem' }}>
                            <div className="report-card" style={{ marginBottom: '1rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                                    <CheckCircle size={18} color="var(--success)" />
                                    <h4 style={{ color: 'var(--success)' }}>Patient Found</h4>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '0.75rem' }}>
                                    {[
                                        ['Name', searchResult.patient.name],
                                        ['Health ID', searchResult.patient.healthId],
                                        ['Email', searchResult.patient.email],
                                        ['BMI', searchResult.patient.bmi || '—'],
                                    ].map(([label, value], i) => (
                                        <div key={i} style={{ padding: '0.6rem', background: 'var(--input-bg)', borderRadius: 'var(--radius-sm)' }}>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                                            <div style={{ fontSize: '0.9rem', fontWeight: 500, marginTop: '0.15rem', fontFamily: label === 'Health ID' ? 'monospace' : 'inherit', color: label === 'Health ID' ? 'var(--primary)' : 'var(--text-main)' }}>{value}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {searchResult.reports.length > 0 && (
                                <div>
                                    <h4 style={{ fontSize: '0.95rem', marginBottom: '0.75rem' }}>Reports ({searchResult.reports.length})</h4>
                                    {searchResult.reports.map((r, i) => {
                                        let aiText = '';
                                        const aiNote = r.note?.find(n => !n.type || n.type !== 'doctor_comment');
                                        if (aiNote) aiText = aiNote.text || '';
                                        return (
                                            <div key={i} className="report-card" style={{ marginBottom: '0.75rem' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                                    <div>
                                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Report: {r.id}</span>
                                                        {r.issued && <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginLeft: '1rem' }}>📅 {new Date(r.issued).toLocaleString()}</span>}
                                                    </div>
                                                    {r.presentedForm?.[0]?.url && <a href={r.presentedForm[0].url} target="_blank" rel="noreferrer" className="link" style={{ fontSize: '0.8rem' }}>View PDF →</a>}
                                                </div>
                                                {aiText && <p style={{ fontSize: '0.85rem', color: 'var(--text-main)', whiteSpace: 'pre-wrap', lineHeight: 1.6, borderLeft: '3px solid var(--success)', paddingLeft: '0.75rem', margin: '0.5rem 0' }}>{aiText}</p>}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Patient-Uploaded Prescriptions with AI Analysis */}
                            <div style={{ marginTop: '1.5rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                                    <h4 style={{ fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <Activity size={17} color="var(--primary)" /> Patient Prescriptions &amp; AI Analysis
                                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 400 }}>({patientPrescriptions.length})</span>
                                    </h4>
                                    <button className="btn-primary" style={{ fontSize: '0.82rem', padding: '0.4rem 0.9rem' }} onClick={() => { setPrescribePatientUid(searchResult.patient.uid); setShowPrescribeModal(true); }}>
                                        + New Prescription
                                    </button>
                                </div>

                                {patientPrescriptions.length === 0 ? (
                                    <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', padding: '1rem 0' }}>No uploaded prescriptions found for this patient.</p>
                                ) : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                        {patientPrescriptions.map((rx) => {
                                            const ai = rx.ai_analysis || {};
                                            const severity = ai.severity || 'Unknown';
                                            const severityColor = severity === 'High' ? 'var(--danger)' : severity === 'Moderate' ? 'var(--warning)' : severity === 'Low' ? 'var(--success)' : 'var(--text-muted)';
                                            const rxId = rx.id;
                                            return (
                                                <div key={rxId} style={{ background: 'var(--gradient-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1.25rem', borderLeft: `3px solid ${severityColor}` }}>
                                                    {/* Header */}
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.85rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                        <div>
                                                            <div style={{ fontWeight: 600, fontSize: '0.95rem' }}>{rx.filename || 'Prescription'}</div>
                                                            {rx.uploaded_at && <div style={{ fontSize: '0.73rem', color: 'var(--text-dim)' }}>📅 {new Date(rx.uploaded_at?.seconds ? rx.uploaded_at.seconds * 1000 : rx.uploaded_at).toLocaleString()}</div>}
                                                        </div>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                            <span style={{ fontSize: '0.75rem', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '999px', background: `${severityColor}22`, color: severityColor, border: `1px solid ${severityColor}55` }}>
                                                                Severity: {severity}
                                                            </span>
                                                            {rx.file_url && <a href={rx.file_url} target="_blank" rel="noreferrer" className="link" style={{ fontSize: '0.78rem' }}>View Doc →</a>}
                                                        </div>
                                                    </div>

                                                    {/* AI Summary */}
                                                    {ai.summary && (
                                                        <div style={{ marginBottom: '0.75rem', padding: '0.75rem', background: 'rgba(16,185,129,0.06)', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--success)' }}>
                                                            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--success)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>AI Summary</div>
                                                            <p style={{ fontSize: '0.9rem', lineHeight: 1.6, color: 'var(--text-main)' }}>{ai.summary}</p>
                                                        </div>
                                                    )}

                                                    {/* Comparison */}
                                                    {ai.comparison && (
                                                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: '0.75rem' }}>&quot;{ai.comparison}&quot;</p>
                                                    )}

                                                    {/* Recommendations */}
                                                    {ai.recommendations?.length > 0 && (
                                                        <div style={{ padding: '0.65rem 0.9rem', background: 'rgba(99,102,241,0.07)', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--primary)', marginBottom: '0.85rem' }}>
                                                            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--primary)', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Recommendations</div>
                                                            {ai.recommendations.map((r, i) => <div key={i} style={{ fontSize: '0.83rem', color: 'var(--text-main)' }}>• {r}</div>)}
                                                        </div>
                                                    )}

                                                    {/* Medicines */}
                                                    {ai.medicines?.length > 0 && (
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.85rem' }}>
                                                            {ai.medicines.map((m, i) => (
                                                                <span key={i} style={{ fontSize: '0.75rem', padding: '0.2rem 0.55rem', borderRadius: '999px', background: 'rgba(245,158,11,0.12)', color: 'var(--warning)', border: '1px solid rgba(245,158,11,0.25)' }}>💊 {m}</span>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {/* Existing Doctor Comments */}
                                                    {rx.doctor_comments?.length > 0 && (
                                                        <div style={{ marginBottom: '0.85rem' }}>
                                                            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--accent)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Doctor Comments</div>
                                                            {rx.doctor_comments.map((c, i) => (
                                                                <div key={i} style={{ padding: '0.55rem 0.75rem', marginBottom: '0.3rem', borderLeft: '2px solid var(--accent)', background: 'rgba(139,92,246,0.05)', borderRadius: 'var(--radius-sm)', fontSize: '0.85rem' }}>
                                                                    <div style={{ color: 'var(--text-main)' }}>{c.text}</div>
                                                                    <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>{c.timestamp ? new Date(c.timestamp).toLocaleString() : ''}</div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {/* Add Doctor Comment */}
                                                    <div className="search-bar" style={{ marginTop: '0.5rem' }}>
                                                        <input
                                                            type="text"
                                                            className="form-input"
                                                            placeholder="Add clinical advice or comment..."
                                                            value={rxCommentData[rxId] || ''}
                                                            onChange={e => setRxCommentData(p => ({ ...p, [rxId]: e.target.value }))}
                                                            onKeyDown={e => e.key === 'Enter' && postRxComment(searchResult.patient.uid, rxId)}
                                                            style={{ margin: 0, flex: 1 }}
                                                        />
                                                        <button
                                                            className="btn-primary"
                                                            style={{ margin: 0, width: 'auto', fontSize: '0.85rem' }}
                                                            disabled={rxCommentPosting[rxId] || !rxCommentData[rxId]?.trim()}
                                                            onClick={() => postRxComment(searchResult.patient.uid, rxId)}
                                                        >
                                                            {rxCommentPosting[rxId] ? '⏳' : 'Post'}
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* My Patients Reports Tab */}
            {activeTab === 'reports' && (
                <div>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                            <span className="loader" style={{ display: 'block', margin: '0 auto 1rem' }}></span>Loading reports...
                        </div>
                    ) : reports.length === 0 ? (
                        <div className="glass-panel" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                            <FileText size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
                            <p>No patient reports assigned to you yet.</p>
                            <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>Use the "Search Patient" tab to find patients by their Health ID.</p>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                            {reports.map(report => (
                                <div key={report.id} className="glass-panel">
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                                        <div>
                                            <h4 style={{ fontSize: '1rem', display: 'inline-block' }}>Report: {report.id}</h4>
                                            {report.issued && <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginLeft: '1rem' }}>📅 {new Date(report.issued).toLocaleString()}</span>}
                                        </div>
                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Patient: {report.patient_uid?.substring(0, 8)}...</span>
                                    </div>

                                    {report.presentedForm?.[0]?.url && (
                                        <a href={report.presentedForm[0].url} target="_blank" rel="noreferrer" className="link" style={{ fontSize: '0.85rem', display: 'inline-block', marginBottom: '1rem' }}>→ View Blood Report PDF</a>
                                    )}

                                    {/* Notes & Analysis */}
                                    <div style={{ marginBottom: '1rem' }}>
                                        {report.note?.map((n, i) => (
                                            <div key={i} style={{ padding: '0.75rem', marginBottom: '0.5rem', borderRadius: 'var(--radius-sm)', background: n.type === 'doctor_comment' ? 'rgba(139,92,246,0.05)' : 'rgba(16,185,129,0.05)', borderLeft: `3px solid ${n.type === 'doctor_comment' ? 'var(--accent)' : 'var(--success)'}` }}>
                                                <div style={{ fontSize: '0.75rem', color: n.type === 'doctor_comment' ? 'var(--accent)' : 'var(--success)', fontWeight: 600, marginBottom: '0.3rem' }}>
                                                    {n.type === 'doctor_comment' ? `Dr. Comment` : 'AI Analysis'}
                                                </div>
                                                <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.85rem', lineHeight: 1.6 }}>{n.text}</div>
                                                {n.timestamp && <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.3rem' }}>{new Date(n.timestamp).toLocaleString()}</div>}
                                            </div>
                                        ))}
                                    </div>

                                    {/* Add Comment */}
                                    <div className="search-bar">
                                        <input type="text" className="form-input" placeholder="Add a clinical comment..." value={commentData[report.id] || ''} onChange={e => handleCommentChange(report.id, e.target.value)} style={{ margin: 0, flex: 1 }} />
                                        <button onClick={() => submitComment(report.patient_uid, report.id)} className="btn-primary" style={{ margin: 0, width: 'auto' }}>Post</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Profile */}
            {activeTab === 'profile' && (
                <div className="glass-panel" style={{ padding: '2rem', maxWidth: '600px', margin: '0 auto' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: '2rem' }}>
                        <ProfileImageUpload
                            currentImage={profileImage}
                            onImageUpdate={url => setProfileImage(url)}
                        />
                        <h3 style={{ marginTop: '1.5rem', marginBottom: '0.25rem' }}>{profile?.name || currentUser?.displayName || 'Doctor'}</h3>
                        <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{currentUser?.email}</span>
                        {profile?.employeeId && (
                            <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                                <span className="badge" style={{ background: 'rgba(96,165,250,0.1)', color: '#60a5fa', fontFamily: 'monospace' }}>🎫 {profile.employeeId}</span>
                                {profile?.hospitalId && <span className="badge" style={{ background: 'rgba(236,72,153,0.1)', color: '#ec4899', fontFamily: 'monospace' }}>🏥 {profile.hospitalId}</span>}
                            </div>
                        )}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                        <h3 style={{ fontSize: '1.1rem' }}>Professional Details</h3>
                        <button className="btn-outline" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }} onClick={() => setIsEditingProfile(!isEditingProfile)}>
                            {isEditingProfile ? 'Cancel' : 'Edit Profile'}
                        </button>
                    </div>

                    {isEditingProfile ? (
                        <form onSubmit={handleProfileSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div>
                                <label className="form-label">Specialization</label>
                                <input type="text" className="form-input" value={profileForm.specialization} onChange={e => setProfileForm(p => ({ ...p, specialization: e.target.value }))} placeholder="e.g. Cardiology" />
                            </div>
                            <div>
                                <label className="form-label">Qualification</label>
                                <input type="text" className="form-input" value={profileForm.qualification} onChange={e => setProfileForm(p => ({ ...p, qualification: e.target.value }))} placeholder="e.g. MBBS, MD" />
                            </div>
                            <div>
                                <label className="form-label">Years of Experience</label>
                                <input type="number" className="form-input" value={profileForm.yearsOfExperience} onChange={e => setProfileForm(p => ({ ...p, yearsOfExperience: e.target.value }))} placeholder="e.g. 10" />
                            </div>
                            <div>
                                <label className="form-label">Bio</label>
                                <textarea className="form-input" rows="4" value={profileForm.bio} onChange={e => setProfileForm(p => ({ ...p, bio: e.target.value }))} placeholder="Brief professional background..."></textarea>
                            </div>
                            <button type="submit" className="btn-primary" disabled={updateProfileLoading} style={{ marginTop: '0.5rem' }}>
                                {updateProfileLoading ? 'Saving...' : 'Save Changes'}
                            </button>
                        </form>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                            <div style={{ padding: '1rem', background: 'var(--input-bg)', borderRadius: 'var(--radius-sm)' }}>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '0.2rem' }}>Specialization</div>
                                <div>{profile?.specialization || 'Not specified'}</div>
                            </div>
                            <div style={{ padding: '1rem', background: 'var(--input-bg)', borderRadius: 'var(--radius-sm)' }}>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '0.2rem' }}>Qualification</div>
                                <div>{profile?.qualification || 'Not specified'}</div>
                            </div>
                            <div style={{ padding: '1rem', background: 'var(--input-bg)', borderRadius: 'var(--radius-sm)' }}>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '0.2rem' }}>Years of Experience</div>
                                <div>{profile?.yearsOfExperience ? `${profile.yearsOfExperience} years` : 'Not specified'}</div>
                            </div>
                            <div style={{ padding: '1rem', background: 'var(--input-bg)', borderRadius: 'var(--radius-sm)' }}>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '0.2rem' }}>Bio</div>
                                <div style={{ whiteSpace: 'pre-wrap' }}>{profile?.bio || 'No bio available.'}</div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Prescription Modal */}
            {showPrescribeModal && (
                <div className="modal-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem', backdropFilter: 'blur(4px)' }}>
                    <div className="glass-panel" style={{ width: '100%', maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }}>
                        <h3 style={{ marginBottom: '1rem', fontSize: '1.25rem', color: 'var(--primary)' }}>Create Prescription</h3>
                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Add medications and dosages. These will be logged automatically to the patient's FHIR record.</p>

                        <div style={{ marginBottom: '1rem' }}>
                            <label className="form-label">Medications</label>
                            {prescriptionForm.medications.map((med, idx) => (
                                <div key={idx} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem', background: 'var(--input-bg)', padding: '0.75rem', borderRadius: 'var(--radius-sm)', borderLeft: '3px solid var(--primary)' }}>
                                    <input type="text" className="form-input" placeholder="Name (e.g. Amoxicillin)" value={med.name} onChange={e => handleMedicationChange(idx, 'name', e.target.value)} style={{ flex: '1 1 200px', margin: 0 }} />
                                    <input type="text" className="form-input" placeholder="Dosage (e.g. 500mg)" value={med.dosage} onChange={e => handleMedicationChange(idx, 'dosage', e.target.value)} style={{ flex: '1 1 120px', margin: 0 }} />
                                    <input type="text" className="form-input" placeholder="Frequency (e.g. Twice daily)" value={med.frequency} onChange={e => handleMedicationChange(idx, 'frequency', e.target.value)} style={{ flex: '1 1 150px', margin: 0 }} />
                                    <input type="text" className="form-input" placeholder="Duration (e.g. 5 days)" value={med.duration} onChange={e => handleMedicationChange(idx, 'duration', e.target.value)} style={{ flex: '1 1 120px', margin: 0 }} />
                                </div>
                            ))}
                            <button className="btn-outline" onClick={handleAddMedicationRow} style={{ marginTop: '0.5rem', fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}>+ Add Medication Row</button>
                        </div>

                        <div style={{ marginBottom: '1.5rem' }}>
                            <label className="form-label">Clinical Notes</label>
                            <textarea className="form-input" rows="3" placeholder="Additional instructions..." value={prescriptionForm.notes} onChange={e => setPrescriptionForm(p => ({ ...p, notes: e.target.value }))}></textarea>
                        </div>

                        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                            <button className="btn-outline" onClick={() => setShowPrescribeModal(false)}>Cancel</button>
                            <button className="btn-primary" onClick={submitPrescription} disabled={prescribeLoading}>{prescribeLoading ? 'Submitting...' : 'Submit Prescription'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// ─── Hospital Dashboard ────────────────────────────────────────────────────

export const HospitalDashboard = () => {
    const { currentUser, logout } = useAuth();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeTab, setActiveTab] = useState('overview');

    const [stats, setStats] = useState(null);
    const [doctors, setDoctors] = useState([]);
    const [patients, setPatients] = useState([]);

    // We can also let the hospital perform unrestricted lookups if they want
    const [searchId, setSearchId] = useState('');
    const [searchResult, setSearchResult] = useState(null);
    const [profileImage, setProfileImage] = useState(null);
    const [profile, setProfile] = useState(null);

    useEffect(() => {
        const fetchProfile = async () => {
            if (!currentUser) return;
            try {
                const token = await currentUser.getIdToken();
                const res = await fetch(`${API_BASE_URL}/user/me`, { headers: { 'Authorization': `Bearer ${token}` } });
                if (res.ok) {
                    const data = await res.json();
                    setProfileImage(data.profileImage || null);
                    setProfile(data);
                }
            } catch (err) { console.error('Failed to fetch profile:', err); }
        };
        fetchProfile();
    }, [currentUser]);

    useEffect(() => {
        const fetchHospitalData = async () => {
            if (!currentUser) return;
            setLoading(true);
            try {
                const token = await currentUser.getIdToken();
                const headers = { 'Authorization': `Bearer ${token}` };

                const [statsRes, docsRes, patientsRes] = await Promise.all([
                    fetch(`${API_BASE_URL}/hospital/stats`, { headers }),
                    fetch(`${API_BASE_URL}/hospital/doctors`, { headers }),
                    fetch(`${API_BASE_URL}/hospital/patients`, { headers })
                ]);

                if (!statsRes.ok) throw new Error((await statsRes.json()).detail || 'Failed to fetch stats');
                setStats(await statsRes.json());

                if (docsRes.ok) setDoctors((await docsRes.json()).doctors || []);
                if (patientsRes.ok) setPatients((await patientsRes.json()).patients || []);

            } catch (err) {
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };
        fetchHospitalData();
    }, [currentUser]);

    const handleSearch = async () => {
        if (!searchId.trim()) return;
        setSearchError(''); setSearchResult(null);
        try {
            const token = await currentUser.getIdToken();
            const res = await fetch(`${API_BASE_URL}/patient/lookup?health_id=${searchId.trim()}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Not found');
            setSearchResult(data);
        } catch (err) { setSearchError(err.message); }
    };

    const tabs = [
        { id: 'overview', label: '📊 Overview' },
        { id: 'doctors', label: '🩺 Our Doctors' },
        { id: 'patients', label: '👥 Our Patients' },
        { id: 'lookup', label: '🔍 Patient Lookup' },
        { id: 'profile', label: '👤 Profile' }
    ];

    const cardStyle = {
        background: 'rgba(255,255,255,0.05)', padding: '1.5rem', borderRadius: '12px',
        border: '1px solid var(--border-color)', textAlign: 'center'
    };
    const statValue = { fontSize: '2.5rem', fontWeight: 700, color: 'var(--primary)', marginBottom: '0.25rem' };

    return (
        <div className="dashboard">
            <div className="dashboard-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: profileImage ? 'none' : 'var(--gradient-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        {profileImage ? <img src={profileImage} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Building2 size={20} color="white" />}
                    </div>
                    <div>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{profile?.name || currentUser?.displayName || 'Hospital Admin'}</h2>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{currentUser?.email}</span>
                        {profile?.hospitalId && (
                            <div style={{ marginTop: '0.2rem' }}>
                                <span style={{ fontSize: '0.75rem', background: 'rgba(236,72,153,0.1)', color: '#ec4899', padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace' }}>
                                    🏥 {profile.hospitalId}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span className="badge" style={{ background: 'rgba(236,72,153,0.15)', color: '#ec4899' }}>Hospital</span>
                    <button onClick={logout} className="btn-outline" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}><LogOut size={14} /> Sign Out</button>
                </div>
            </div>

            <div className="tab-list">
                {tabs.map(tab => (
                    <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}>{tab.label}</button>
                ))}
            </div>

            {error && <div className="error-msg"><AlertCircle size={16} /> {error}</div>}

            {loading ? (
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>Loading hospital data...</p>
            ) : (
                <>
                    {/* Overview */}
                    {activeTab === 'overview' && stats && (
                        <div className="glass-panel" style={{ padding: '2rem' }}>
                            <h3 style={{ marginBottom: '1.5rem' }}>Hospital Scope Data</h3>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
                                <div style={cardStyle}><div style={statValue}>{stats.total_doctors}</div><div style={{ color: 'var(--text-muted)' }}>Affiliated Doctors</div></div>
                                <div style={cardStyle}><div style={{ ...statValue, color: '#ec4899' }}>{stats.total_patients}</div><div style={{ color: 'var(--text-muted)' }}>Active Patients</div></div>
                                <div style={cardStyle}><div style={{ ...statValue, color: stats.high_risk_alerts > 0 ? '#ef4444' : '#10b981' }}>{stats.high_risk_alerts}</div><div style={{ color: 'var(--text-muted)' }}>High-Risk Alerts</div></div>
                            </div>
                        </div>
                    )}

                    {/* Doctors */}
                    {activeTab === 'doctors' && (
                        <div className="glass-panel" style={{ padding: '1.5rem' }}>
                            <h3 style={{ marginBottom: '1rem', color: '#10b981' }}>Affiliated Doctors ({doctors.length})</h3>
                            {doctors.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No doctors currently affiliated.</p> : (
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <th style={{ padding: '0.75rem', color: 'var(--text-muted)', width: '50px' }}>Profile</th>
                                                <th style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>Name</th>
                                                <th style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>Specialization</th>
                                                <th style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>Doctor ID</th>
                                                <th style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>Emp ID</th>
                                                <th style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>Active Patients</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {doctors.map(d => (
                                                <tr key={d.uid} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                                    <td style={{ padding: '0.75rem' }}>
                                                        <div style={{ width: 36, height: 36, borderRadius: '50%', background: d.profileImage ? 'none' : 'var(--input-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                                                            {d.profileImage ? <img src={d.profileImage} alt={d.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <User size={16} color="var(--text-dim)" />}
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '0.75rem' }}>
                                                        <div style={{ fontWeight: 500 }}>{d.name || '—'}</div>
                                                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{d.email}</div>
                                                    </td>
                                                    <td style={{ padding: '0.75rem' }}>
                                                        {d.specialization ? <span style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}>{d.specialization}</span> : <span style={{ color: 'var(--text-dim)' }}>—</span>}
                                                    </td>
                                                    <td style={{ padding: '0.75rem' }}><span style={{ fontFamily: 'monospace', color: '#60a5fa' }}>{d.doctorId || '—'}</span></td>
                                                    <td style={{ padding: '0.75rem' }}><span style={{ fontFamily: 'monospace', color: '#f472b6' }}>{d.employeeId || '—'}</span></td>
                                                    <td style={{ padding: '0.75rem', fontWeight: 600, color: '#10b981' }}>{d.patient_count}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Patients */}
                    {activeTab === 'patients' && (
                        <div className="glass-panel" style={{ padding: '1.5rem' }}>
                            <h3 style={{ marginBottom: '1rem', color: '#ec4899' }}>Patients Under Care ({patients.length})</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>Only basic profile information is accessible here. Direct access to clinical reports is restricted.</p>
                            {patients.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No active patients found for your doctors.</p> : (
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <th style={{ textAlign: 'left', padding: '0.75rem', color: 'var(--text-muted)' }}>Name</th>
                                                <th style={{ textAlign: 'left', padding: '0.75rem', color: 'var(--text-muted)' }}>Email</th>
                                                <th style={{ textAlign: 'left', padding: '0.75rem', color: 'var(--text-muted)' }}>Health ID</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {patients.map(p => (
                                                <tr key={p.uid} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                                    <td style={{ padding: '0.75rem' }}>{p.name || '—'}</td>
                                                    <td style={{ padding: '0.75rem', color: 'var(--text-muted)' }}>{p.email}</td>
                                                    <td style={{ padding: '0.75rem' }}><span style={{ fontFamily: 'monospace', color: '#ec4899', background: 'rgba(236,72,153,0.1)', padding: '2px 6px', borderRadius: '4px' }}>{p.healthId || '—'}</span></td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Patient Lookup */}
                    {activeTab === 'lookup' && (
                        <div className="glass-panel">
                            <h3 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Search size={20} /> Patient Lookup</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>Search any patient by their Health ID. Hospitals have unrestricted lookup capabilities.</p>
                            <div className="search-bar" style={{ marginBottom: '1rem' }}>
                                <input type="text" className="form-input" placeholder="e.g. PAT-A1B2C3" value={searchId} onChange={e => setSearchId(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} style={{ margin: 0, flex: 1 }} />
                                <button className="btn-primary" style={{ margin: 0, width: 'auto' }} onClick={handleSearch}>Search</button>
                            </div>
                            {searchError && <div style={{ color: 'var(--danger)', fontSize: '0.85rem', marginBottom: '1rem' }}>{searchError}</div>}
                            {searchResult && (
                                <div className="report-card">
                                    <h4 style={{ color: 'var(--success)', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><CheckCircle size={16} /> Patient Found</h4>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '0.5rem', marginBottom: '1rem' }}>
                                        {[['Name', searchResult.patient.name], ['Health ID', searchResult.patient.healthId], ['Email', searchResult.patient.email], ['BMI', searchResult.patient.bmi || '—']].map(([l, v], i) => (
                                            <div key={i} style={{ padding: '0.5rem', background: 'var(--input-bg)', borderRadius: 'var(--radius-sm)' }}>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>{l}</div>
                                                <div style={{ fontSize: '0.85rem', fontWeight: 500 }}>{v}</div>
                                            </div>
                                        ))}
                                    </div>
                                    {searchResult.reports.length > 0 && <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{searchResult.reports.length} report(s) on file</div>}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Profile */}
                    {activeTab === 'profile' && (
                        <div className="glass-panel" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', maxWidth: '400px', margin: '0 auto' }}>
                            <ProfileImageUpload
                                currentImage={profileImage}
                                onImageUpdate={url => setProfileImage(url)}
                            />
                            <h3 style={{ marginTop: '1.5rem', marginBottom: '0.25rem' }}>{currentUser?.displayName || 'Hospital Admin'}</h3>
                            <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{currentUser?.email}</span>
                        </div>
                    )}
                </>
            )}
        </div>
    );
};

