



import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../supabase/supabaseClient';
import { User, Activity, FileText, CheckCircle, AlertCircle, TrendingUp, Upload, Footprints, RefreshCw, Shield, Pill, DownloadCloud, Bell } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { ProfileImageUpload } from '../components/ProfileImageUpload';
import MedicineReminders from '../components/MedicineReminders';
import FamilyHealthTab from '../components/FamilyHealthTab';
import CheckupTracker from '../components/CheckupTracker';

const FASTAPI_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

const PatientDashboard = () => {
    const { currentUser, logout } = useAuth();
    const [activeTab, setActiveTab] = useState('my reports');

    const [profile, setProfile] = useState({ firstName: '', lastName: '', gender: '', birthDate: '' });
    const [vitals, setVitals] = useState({ height_cm: '', weight_kg: '', heartRate: '', oxygen: '' });
    const [reportFile, setReportFile] = useState(null);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [results, setResults] = useState({ profile: null, vitals: null, labs: null, reportAnalysis: null });

    const [fetchedReports, setFetchedReports] = useState([]);
    const [fetchingReports, setFetchingReports] = useState(false);

    // Prescriptions State
    const [fetchedPrescriptions, setFetchedPrescriptions] = useState([]);
    const [fetchingPrescriptions, setFetchingPrescriptions] = useState(false);
    const [prescriptionFile, setPrescriptionFile] = useState(null);

    const [bmiData, setBmiData] = useState([]);
    const [fetchingTrends, setFetchingTrends] = useState(false);

    const [stepInput, setStepInput] = useState('');
    const [stepRewards, setStepRewards] = useState({ daily_steps: {}, total_points: 0 });
    const [stepLoading, setStepLoading] = useState(false);
    const [stepMsg, setStepMsg] = useState(null);
    const [syncLoading, setSyncLoading] = useState(false);
    const [healthId, setHealthId] = useState('');
    const [profileImage, setProfileImage] = useState(null);

    const [doctors, setDoctors] = useState([]);
    const [consents, setConsents] = useState([]);
    const [fetchingDoctors, setFetchingDoctors] = useState(false);
    const [idToken, setIdToken] = useState('');
    const [lastCheckupDate, setLastCheckupDate] = useState('');

    useEffect(() => {
        const fetchDashboardData = async () => {
            if (!currentUser) return;
            const token = await currentUser.getIdToken();
            setIdToken(token);
            setFetchingReports(true);
            setFetchingPrescriptions(true);
            setFetchingTrends(true);
            try {
                const token = await currentUser.getIdToken();
                const headers = { 'Authorization': `Bearer ${token}` };
                const [reportsRes, vitalsRes, stepsRes, rxRes] = await Promise.all([
                    fetch(`${FASTAPI_URL}/patient/reports`, { headers }),
                    fetch(`${FASTAPI_URL}/patient/vitals`, { headers }),
                    fetch(`${FASTAPI_URL}/patient/step-rewards`, { headers }),
                    fetch(`${FASTAPI_URL}/patient/prescriptions`, { headers })
                ]);
                const reportsData = await reportsRes.json();
                if (reportsRes.ok) setFetchedReports(reportsData.reports || []);

                if (rxRes.ok) {
                    const rxData = await rxRes.json();
                    setFetchedPrescriptions(rxData.prescriptions || []);
                }

                const vitalsData = await vitalsRes.json();
                if (vitalsRes.ok && vitalsData.vitals) {
                    const mappedData = {};
                    vitalsData.vitals.forEach(obs => {
                        const dateStr = new Date(obs.effectiveDateTime).toLocaleDateString();
                        const timeMs = new Date(obs.effectiveDateTime).getTime();
                        if (!mappedData[dateStr]) mappedData[dateStr] = { date: dateStr, timestamp: timeMs };

                        const code = obs?.code?.coding?.[0]?.code;
                        const val = obs?.valueQuantity?.value;
                        if (code === "39156-5") mappedData[dateStr].BMI = val;
                        if (code === "8867-4") mappedData[dateStr].heartRate = val;
                        if (code === "2708-6") mappedData[dateStr].oxygen = val;
                    });
                    const trendArray = Object.values(mappedData).sort((a, b) => a.timestamp - b.timestamp);
                    setBmiData(trendArray);
                }

                const stepsData = await stepsRes.json();
                if (stepsRes.ok) setStepRewards(stepsData);
            } catch (err) { console.error("Error fetching:", err); }
            finally { setFetchingReports(false); setFetchingTrends(false); setFetchingPrescriptions(false); }
        };
        fetchDashboardData();

        const fetchProfile = async () => {
            if (!currentUser) return;
            try {
                const token = await currentUser.getIdToken();
                const res = await fetch(`${FASTAPI_URL}/patient/me`, { headers: { 'Authorization': `Bearer ${token}` } });
                if (res.ok) {
                    const data = await res.json();
                    setHealthId(data.healthId || '');
                    setProfileImage(data.profileImage || null);
                    setLastCheckupDate(data.lastCheckupDate || '');
                    setProfile({
                        firstName: data.firstName || data.name?.split(' ')[0] || '',
                        lastName: data.lastName || (data.name?.includes(' ') ? data.name.split(' ').slice(1).join(' ') : ''),
                        gender: data.gender || '',
                        birthDate: data.birthDate || ''
                    });
                }
            } catch (err) { console.error('Failed to fetch patient profile:', err); }
        };
        fetchProfile();

        const fetchDoctorsAndConsents = async () => {
            if (!currentUser) return;
            setFetchingDoctors(true);
            try {
                const token = await currentUser.getIdToken();
                const headers = { 'Authorization': `Bearer ${token}` };
                const [docRes, conRes] = await Promise.all([
                    fetch(`${FASTAPI_URL}/patient/doctors`, { headers }),
                    fetch(`${FASTAPI_URL}/patient/consents`, { headers })
                ]);
                if (docRes.ok) {
                    const data = await docRes.json();
                    setDoctors(data.doctors || []);
                }
                if (conRes.ok) {
                    const data = await conRes.json();
                    setConsents(data.consents || []);
                }
            } catch (e) { console.error("Error fetching doctors", e); }
            finally { setFetchingDoctors(false); }
        };
        fetchDoctorsAndConsents();
    }, [currentUser]);

    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return "Good morning";
        if (hour < 18) return "Good afternoon";
        return "Good evening";
    };

    const handleLogout = async () => { try { await logout(); } catch (e) { console.error(e); } };

    const toggleConsent = async (doctorUid, currentlyGranted) => {
        try {
            const token = await currentUser.getIdToken();
            const endpoint = currentlyGranted ? "revoke-consent" : "grant-consent";
            const res = await fetch(`${FASTAPI_URL}/patient/${endpoint}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
                body: JSON.stringify({ doctor_uid: doctorUid })
            });
            if (res.ok) {
                if (currentlyGranted) {
                    setConsents(prev => prev.filter(uid => uid !== doctorUid));
                } else {
                    setConsents(prev => [...prev, doctorUid]);
                }
            }
        } catch (e) { console.error("Error toggling consent:", e); }
    };

    const submitProfile = async (e) => {
        e.preventDefault(); setLoading(true); setError(null);
        try {
            const res = await fetch(`${FASTAPI_URL}/fhir/patient`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid: currentUser.uid, ...profile }) });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed');
            setResults(p => ({ ...p, profile: data.data }));
        } catch (err) { setError(err.message); } finally { setLoading(false); }
    };

    const submitVitals = async (e) => {
        e.preventDefault(); setLoading(true); setError(null);
        try {
            const payload = {
                uid: currentUser.uid,
                height_cm: vitals.height_cm ? parseFloat(vitals.height_cm) : null,
                weight_kg: vitals.weight_kg ? parseFloat(vitals.weight_kg) : null,
                heartRate: vitals.heartRate ? parseFloat(vitals.heartRate) : null,
                oxygen: vitals.oxygen ? parseFloat(vitals.oxygen) : null
            };
            const res = await fetch(`${FASTAPI_URL}/fhir/observation/vitals`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed');
            setResults(p => ({ ...p, vitals: data.data }));
        } catch (err) { setError(err.message); } finally { setLoading(false); }
    };


    const handleGoogleFitSync = async () => {
        setSyncLoading(true);
        setStepMsg(null);
        try {
            let googleAccessToken = localStorage.getItem('googleAccessToken');

            if (!googleAccessToken) {
                // Prompt re-authentication via Supabase Google OAuth to get a Google access token
                const { data: oauthData, error: oauthError } = await supabase.auth.signInWithOAuth({
                    provider: 'google',
                    options: {
                        redirectTo: window.location.href,
                        scopes: 'https://www.googleapis.com/auth/fitness.activity.read',
                        queryParams: { access_type: 'offline', prompt: 'consent' },
                    },
                });
                if (oauthError) throw new Error(oauthError.message);
                // After redirect the provider_token is available in the session
                const { data: { session } } = await supabase.auth.getSession();
                googleAccessToken = session?.provider_token || null;
                if (!googleAccessToken) throw new Error('Failed to retrieve Google Fitness token. Please try again after signing in with Google.');
                localStorage.setItem('googleAccessToken', googleAccessToken);
            }

            const token = await currentUser.getIdToken();
            const res = await fetch(`${FASTAPI_URL}/patient/sync-steps`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ google_access_token: googleAccessToken })
            });

            const data = await res.json();
            if (!res.ok) {
                if (res.status === 401 && data.detail && data.detail.includes('Google Access Token expired')) {
                    // Clear the token so next click triggers a re-auth
                    localStorage.removeItem('googleAccessToken');
                    throw new Error('Google Auth Expired. Please click sync again to re-authenticate.');
                }
                throw new Error(data.detail || 'Google Fit sync failed');
            }

            setStepMsg({ type: 'success', text: `Successfully synced ${data.steps_synced} steps from Google Fit! Total Points: ${data.total_points}` });
            setStepRewards(prev => ({
                ...prev,
                total_points: data.total_points,
                daily_steps: {
                    ...prev.daily_steps,
                    [new Date().toISOString().split('T')[0]]: data.steps_synced
                }
            }));
        } catch (err) {
            setStepMsg({ type: 'error', text: err.message });
        } finally {
            setSyncLoading(false);
        }
    };

    const uploadReport = async (e) => {
        e.preventDefault();
        if (!reportFile) return;
        setLoading(true); setError(null);
        const formData = new FormData();
        formData.append("uid", currentUser.uid);
        formData.append("file", reportFile);
        try {
            const res = await fetch(`${FASTAPI_URL}/upload/blood-report`, { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to upload report');
            setResults(p => ({ ...p, reportAnalysis: data }));
            // Auto-switch to My Reports and refresh
            const token = await currentUser.getIdToken();
            const reportsRes = await fetch(`${FASTAPI_URL}/patient/reports`, { headers: { 'Authorization': `Bearer ${token}` } });
            const reportsData = await reportsRes.json();
            if (reportsRes.ok) setFetchedReports(reportsData.reports || []);
            setActiveTab('my reports');
        } catch (err) { setError(err.message); } finally { setLoading(false); setReportFile(null); }
    };

    const uploadPrescription = async (e) => {
        e.preventDefault();
        if (!prescriptionFile) return;
        setLoading(true); setError(null);
        const formData = new FormData();
        formData.append("uid", currentUser.uid);
        formData.append("file", prescriptionFile);
        try {
            const res = await fetch(`${FASTAPI_URL}/upload/prescription`, { method: 'POST', body: formData });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to analyze prescription');

            // Auto-switch to Prescriptions and refresh
            const token = await currentUser.getIdToken();
            const rxRes = await fetch(`${FASTAPI_URL}/patient/prescriptions`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (rxRes.ok) {
                const rxData = await rxRes.json();
                setFetchedPrescriptions(rxData.prescriptions || []);
            }
            setActiveTab('rx');
        } catch (err) { setError(err.message); } finally { setLoading(false); setPrescriptionFile(null); }
    };

    const tabs = [
        { id: 'my reports', label: '📋 Reports', icon: <FileText size={14} /> },
        { id: 'rx', label: '💊 Prescriptions', icon: <Pill size={14} /> },
        { id: 'reminders', label: '🔔 Reminders', icon: <Bell size={14} /> },
        { id: 'family', label: '👨‍👩‍👧 Family', icon: null },
        { id: 'upload pdf', label: '📄 Upload', icon: <Upload size={14} /> },
        { id: 'steps', label: '🏃 Steps', icon: <Footprints size={14} /> },
        { id: 'trends', label: '📈 Trends', icon: <TrendingUp size={14} /> },
        { id: 'profile', label: '👤 Profile', icon: <User size={14} /> },
        { id: 'vitals', label: '💓 Vitals', icon: <Activity size={14} /> },
        { id: 'consent', label: '👨‍⚕️ Access', icon: <Shield size={14} /> }
    ];

    return (
        <div className="dashboard">
            {/* Header */}
            <div className="dashboard-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: profileImage ? 'none' : 'var(--gradient-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                        {profileImage ? <img src={profileImage} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <User size={20} color="white" />}
                    </div>
                    <div>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{getGreeting()}!</h2>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{currentUser?.email}</span>
                        {healthId && (
                            <div style={{ marginTop: '0.2rem' }}>
                                <span style={{ fontSize: '0.75rem', background: 'rgba(96,165,250,0.15)', color: '#60a5fa', padding: '2px 8px', borderRadius: '4px', fontFamily: 'monospace', letterSpacing: '0.03em' }}>
                                    🪪 {healthId}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
                <button onClick={handleLogout} className="btn-outline" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    Sign Out
                </button>
            </div>

            {/* Main Grid */}
            <div className="dashboard-grid">

                {/* Checkup Reminder Banner — shown above sidebar on mobile, before grid on desktop */}
                <div style={{ gridColumn: '1/-1', marginBottom: '-0.25rem' }}>
                    <CheckupTracker
                        uid={currentUser?.uid}
                        token={idToken}
                        initialDate={lastCheckupDate}
                        onDateSaved={async (d) => {
                            setLastCheckupDate(d);
                        }}
                    />
                </div>
                {/* Sidebar */}
                <div className="sidebar">
                    <div className="glass-panel" style={{ padding: '1rem' }}>
                        <div className="tab-list" style={{ flexDirection: 'column', borderBottom: 'none' }}>
                            {tabs.map(tab => (
                                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                                    className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                                    style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', justifyContent: 'flex-start' }}
                                >{tab.label}</button>
                            ))}
                        </div>

                        {/* Quick Stats */}
                        <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--gradient-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>Step Points</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--warning)' }}>{stepRewards.total_points || 0} pts</div>
                        </div>
                    </div>
                </div>

                {/* Main Content */}
                <div className="glass-panel" style={{ overflow: 'auto', maxHeight: '85vh' }}>

                    {/* Mobile tab bar */}
                    <div className="tab-list" style={{ display: 'none' }}>
                        {tabs.map(tab => (
                            <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`tab-btn ${activeTab === tab.id ? 'active' : ''}`}>{tab.label}</button>
                        ))}
                    </div>

                    {error && <div className="error-msg"><AlertCircle size={16} /> {error}</div>}

                    {/* MY REPORTS */}
                    {activeTab === 'my reports' && (
                        <div>
                            <h3 style={{ fontSize: '1.15rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <FileText size={20} /> My Diagnostic Reports
                            </h3>
                            {fetchingReports ? (
                                <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
                                    <span className="loader" style={{ marginBottom: '1rem', display: 'block', marginLeft: 'auto', marginRight: 'auto' }}></span>
                                    Loading reports...
                                </div>
                            ) : fetchedReports.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
                                    <Activity size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
                                    <p>No diagnostic reports found.</p>
                                    <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>Upload a PDF or Image in the &quot;Upload&quot; tab to get your first AI analysis.</p>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                    {fetchedReports.map((report, idx) => {
                                        let riskLevel = "Unknown", clinicalSummary = "No AI summary available.", recommendations = [];
                                        const aiNote = report.note?.find(n => !n.type || n.type !== 'doctor_comment');
                                        if (aiNote) {
                                            const text = aiNote.text || "";
                                            const riskMatch = text.match(/AI Risk Level:\s*(.+)/);
                                            if (riskMatch) riskLevel = riskMatch[1].trim();
                                            const parts = text.split("Recommendations:");
                                            if (parts.length > 0) clinicalSummary = parts[0].replace(/AI Risk Level:.*\n*/, '').replace(/Clinical Summary:\s*/, '').trim();
                                            if (parts.length > 1) recommendations = parts[1].split('\n').filter(r => r.trim().startsWith('-')).map(r => r.replace('-', '').trim());
                                        }
                                        const doctorComments = report.note?.filter(n => n.type === 'doctor_comment') || [];
                                        const pdfUrl = report.presentedForm?.[0]?.url || null;
                                        const badgeClass = riskLevel === 'High' ? 'badge-risk-high' : riskLevel === 'Moderate' ? 'badge-risk-moderate' : riskLevel === 'Low' ? 'badge-risk-low' : 'badge-role';

                                        return (
                                            <div key={report.id || idx} className="report-card">
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                    <div>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>ID: {report.id}</span>
                                                        {report.issued && <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginLeft: '1rem' }}>📅 {new Date(report.issued).toLocaleString()}</span>}
                                                        <h4 style={{ margin: '0.25rem 0 0', fontSize: '1rem' }}>Blood Work Analysis</h4>
                                                    </div>
                                                    <span className={`badge ${badgeClass}`}>Risk: {riskLevel}</span>
                                                </div>

                                                <p style={{ fontSize: '0.9rem', lineHeight: 1.7, color: 'var(--text-main)', marginBottom: '1rem' }}>{clinicalSummary}</p>

                                                {recommendations.length > 0 && (
                                                    <div style={{ background: 'rgba(16,185,129,0.05)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', borderLeft: '3px solid var(--success)' }}>
                                                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--success)', marginBottom: '0.4rem' }}>Recommendations</div>
                                                        {recommendations.map((r, i) => <div key={i} style={{ fontSize: '0.85rem', color: 'var(--text-main)', paddingLeft: '0.5rem', marginBottom: '0.2rem' }}>• {r}</div>)}
                                                    </div>
                                                )}

                                                {pdfUrl && <a href={pdfUrl} target="_blank" rel="noreferrer" className="link" style={{ fontSize: '0.85rem' }}>→ View Original Document</a>}

                                                {doctorComments.length > 0 && (
                                                    <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
                                                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--accent)', marginBottom: '0.5rem' }}>Doctor Comments</div>
                                                        {doctorComments.map((c, i) => (
                                                            <div key={i} style={{ padding: '0.5rem 0.75rem', marginBottom: '0.4rem', borderLeft: '2px solid var(--accent)', fontSize: '0.85rem', color: 'var(--text-main)' }}>
                                                                {c.text}
                                                                <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '0.25rem' }}>{c.timestamp ? new Date(c.timestamp).toLocaleString() : ''}</div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* PRESCRIPTIONS */}
                    {activeTab === 'rx' && (
                        <div>
                            <h3 style={{ fontSize: '1.15rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Pill size={20} /> Prescriptions & Medications
                            </h3>
                            {fetchingPrescriptions ? (
                                <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
                                    <span className="loader" style={{ marginBottom: '1rem', display: 'block', marginLeft: 'auto', marginRight: 'auto' }}></span>
                                    Loading prescriptions...
                                </div>
                            ) : fetchedPrescriptions.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
                                    <Pill size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
                                    <p>No prescriptions found.</p>
                                    <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>Upload a prescription in the &quot;Upload&quot; tab.</p>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                                    {fetchedPrescriptions.map((px, idx) => {
                                        const severity = px.ai_analysis?.severity || 'Unknown';
                                        const summary = px.ai_analysis?.summary || 'No summary available.';
                                        const comparison = px.ai_analysis?.comparison || '';
                                        const recommendations = px.ai_analysis?.recommendations || [];

                                        const badgeClass = severity === 'High' ? 'badge-risk-high' : severity === 'Moderate' ? 'badge-risk-moderate' : severity === 'Low' ? 'badge-risk-low' : 'badge-role';

                                        return (
                                            <div key={px.id || idx} className="report-card">
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                                                    <div>
                                                        <h4 style={{ margin: '0 0 0.25rem', fontSize: '1.1rem' }}>Prescription Details</h4>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{px.filename}</span>
                                                        {px.uploaded_at && <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginLeft: '1rem' }}>📅 {new Date(px.uploaded_at).toLocaleString()}</span>}
                                                    </div>
                                                    <span className={`badge ${badgeClass}`}>Severity: {severity}</span>
                                                </div>

                                                <p style={{ fontSize: '0.95rem', lineHeight: 1.6, color: 'var(--text-main)', marginBottom: '0.75rem' }}>
                                                    {summary}
                                                </p>

                                                {comparison && (
                                                    <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)', fontStyle: 'italic', marginBottom: '1rem' }}>
                                                        &quot;{comparison}&quot;
                                                    </p>
                                                )}

                                                {recommendations.length > 0 && (
                                                    <div style={{ background: 'rgba(99, 102, 241, 0.08)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1rem', borderLeft: '3px solid var(--primary)' }}>
                                                        <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--primary)', marginBottom: '0.4rem' }}>Recommendations</div>
                                                        {recommendations.map((r, i) => <div key={i} style={{ fontSize: '0.85rem', color: 'var(--text-main)', paddingLeft: '0.5rem', marginBottom: '0.2rem' }}>• {r}</div>)}
                                                    </div>
                                                )}

                                                {px.file_url && <a href={px.file_url} target="_blank" rel="noreferrer" className="link" style={{ fontSize: '0.85rem' }}>→ View Original Document</a>}

                                                {/* Medicine Reminders — rendered per prescription */}
                                                {px.ai_analysis?.medicines?.length > 0 && (
                                                    <MedicineReminders
                                                        medicines={px.ai_analysis.medicines}
                                                        uid={currentUser.uid}
                                                    />
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* REMINDERS TAB */}
                    {activeTab === 'reminders' && (
                        <div>
                            <h3 style={{ fontSize: '1.15rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Bell size={20} /> Medicine Reminders
                            </h3>
                            {fetchedPrescriptions.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
                                    <Bell size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
                                    <p>No prescriptions uploaded yet.</p>
                                    <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>Upload a prescription first to set reminders.</p>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                    {fetchedPrescriptions.map((px, idx) => {
                                        const medicines = px.ai_analysis?.medicines || [];
                                        if (medicines.length === 0) return null;
                                        return (
                                            <div key={px.id || idx} style={{ background: 'var(--gradient-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1.25rem' }}>
                                                <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', marginBottom: '0.75rem' }}>
                                                    📄 {px.filename}
                                                </div>
                                                <MedicineReminders medicines={medicines} uid={currentUser.uid} />
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* FAMILY HEALTH TRACKING */}
                    {activeTab === 'family' && (
                        <FamilyHealthTab uid={currentUser.uid} token={idToken} />
                    )}

                    {/* UPLOAD PDF/IMAGE/TXT */}
                    {activeTab === 'upload pdf' && (
                        <div>
                            <h3 style={{ fontSize: '1.15rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Upload size={20} /> Upload Documents</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                                Securely upload your medical documents. Our AI will extract the text and provide simple, actionable clinical insights.
                            </p>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>

                                {/* Upload Blood Report */}
                                <div style={{ background: 'var(--gradient-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1.5rem' }}>
                                    <h4 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Activity size={18} color="var(--accent)" /> Blood Work & Labs</h4>
                                    <form onSubmit={uploadReport}>
                                        <div style={{ border: '2px dashed var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '1.5rem', textAlign: 'center', marginBottom: '1rem', background: 'var(--input-bg)' }}>
                                            <Upload size={24} style={{ color: 'var(--text-dim)', marginBottom: '0.5rem' }} />
                                            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '1rem' }}>{reportFile ? `📄 ${reportFile.name}` : 'PDF, PNG, JPEG'}</p>
                                            <input type="file" accept="application/pdf, image/png, image/jpeg, .pdf, .png, .jpg, .jpeg" onChange={e => setReportFile(e.target.files[0])} style={{ opacity: 0, position: 'absolute', width: 0 }} id="pdf-upload" />
                                            <label htmlFor="pdf-upload" className="btn-outline" style={{ cursor: 'pointer', display: 'inline-block', fontSize: '0.85rem' }}>Select Blood Report</label>
                                        </div>
                                        <button type="submit" className="btn-primary" disabled={loading || !reportFile} style={{ width: '100%', fontSize: '0.9rem' }}>
                                            {loading && reportFile ? '⏳ Analyzing...' : 'Upload Lab Report'}
                                        </button>
                                    </form>
                                </div>

                                {/* Upload Prescription */}
                                <div style={{ background: 'var(--gradient-card)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '1.5rem' }}>
                                    <h4 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Pill size={18} color="var(--primary)" /> Doctor Prescription</h4>
                                    <form onSubmit={uploadPrescription}>
                                        <div style={{ border: '2px dashed var(--border-color)', borderRadius: 'var(--radius-lg)', padding: '1.5rem', textAlign: 'center', marginBottom: '1rem', background: 'var(--input-bg)' }}>
                                            <DownloadCloud size={24} style={{ color: 'var(--text-dim)', marginBottom: '0.5rem' }} />
                                            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '1rem' }}>{prescriptionFile ? `📄 ${prescriptionFile.name}` : 'PDF, PNG, JPEG, TXT'}</p>
                                            <input type="file" accept="application/pdf, image/png, image/jpeg, text/plain, .pdf, .png, .jpg, .jpeg, .txt" onChange={e => setPrescriptionFile(e.target.files[0])} style={{ opacity: 0, position: 'absolute', width: 0 }} id="rx-upload" />
                                            <label htmlFor="rx-upload" className="btn-outline" style={{ cursor: 'pointer', display: 'inline-block', fontSize: '0.85rem' }}>Select Prescription</label>
                                        </div>
                                        <button type="submit" className="btn-primary" disabled={loading || !prescriptionFile} style={{ width: '100%', fontSize: '0.9rem', backgroundColor: 'var(--primary)' }}>
                                            {loading && prescriptionFile ? '⏳ Processing Rx...' : 'Upload Prescription'}
                                        </button>
                                    </form>
                                </div>

                            </div>
                        </div>
                    )}

                    {/* STEPS */}
                    {activeTab === 'steps' && (
                        <div>
                            <h3 style={{ fontSize: '1.15rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>🏃 Steps & Rewards</h3>
                            <div style={{ background: 'linear-gradient(135deg, rgba(245,158,11,0.12), rgba(139,92,246,0.08))', padding: '1.5rem', borderRadius: 'var(--radius-lg)', marginBottom: '1.5rem', textAlign: 'center', border: '1px solid rgba(245,158,11,0.15)' }}>
                                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Total Reward Points</div>
                                <div style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--warning)' }}>{stepRewards.total_points || 0}</div>
                            </div>

                            <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'center' }}>
                                <button
                                    onClick={handleGoogleFitSync}
                                    disabled={syncLoading}
                                    className="btn-outline"
                                    style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%', justifyContent: 'center', borderColor: '#4285F4', color: '#4285F4' }}
                                >
                                    {syncLoading ? <span className="loader"></span> : <RefreshCw size={18} />}
                                    {syncLoading ? "Syncing with Google Fit..." : "Sync Daily Steps with Google Fit"}
                                </button>
                            </div>

                            <div className="search-bar" style={{ marginBottom: '1rem' }}>
                                <input type="number" className="form-input" placeholder="Enter today's steps" value={stepInput} onChange={e => setStepInput(e.target.value)} style={{ margin: 0, flex: 1 }} />
                                <button className="btn-primary" style={{ margin: 0, width: 'auto' }} disabled={stepLoading || !stepInput}
                                    onClick={async () => {
                                        setStepLoading(true); setStepMsg(null);
                                        try {
                                            const token = await currentUser.getIdToken();
                                            const res = await fetch(`${FASTAPI_URL}/patient/log-steps`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ steps: parseInt(stepInput) }) });
                                            const data = await res.json(); if (!res.ok) throw new Error(data.detail);
                                            setStepMsg({ type: 'success', text: `+${data.points_earned} pts! Total: ${data.total_points}` });
                                            setStepRewards(prev => ({ ...prev, total_points: data.total_points, daily_steps: { ...prev.daily_steps, [new Date().toISOString().split('T')[0]]: parseInt(stepInput) } }));
                                            setStepInput('');
                                        } catch (err) { setStepMsg({ type: 'error', text: err.message }); } finally { setStepLoading(false); }
                                    }}>{stepLoading ? '...' : 'Log Steps'}</button>
                            </div>
                            {stepMsg && <div style={{ color: stepMsg.type === 'success' ? 'var(--success)' : 'var(--danger)', fontSize: '0.85rem', marginBottom: '1rem' }}>{stepMsg.text}</div>}

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1.5rem' }}>
                                {[['🥉 5K+', '10 pts'], ['🥈 10K+', '25 pts'], ['🥇 15K+', '50 pts']].map(([tier, pts], i) => (
                                    <div key={i} className="stat-card" style={{ padding: '0.75rem' }}>
                                        <div style={{ fontSize: '0.9rem' }}>{tier}</div>
                                        <div style={{ fontSize: '0.8rem', color: 'var(--warning)', fontWeight: 600 }}>{pts}</div>
                                    </div>
                                ))}
                            </div>

                            {stepRewards.daily_steps && Object.keys(stepRewards.daily_steps).length > 0 && (
                                <div>
                                    <h4 style={{ fontSize: '0.9rem', marginBottom: '0.75rem' }}>Recent History</h4>
                                    <ResponsiveContainer width="100%" height={200}>
                                        <BarChart data={Object.entries(stepRewards.daily_steps).sort((a, b) => a[0].localeCompare(b[0])).slice(-7).map(([date, steps]) => ({ date: date.substring(5), steps }))}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                            <XAxis dataKey="date" stroke="var(--text-dim)" fontSize={11} />
                                            <YAxis stroke="var(--text-dim)" fontSize={11} />
                                            <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.85rem' }} />
                                            <Bar dataKey="steps" fill="var(--warning)" radius={[4, 4, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </div>
                    )}

                    {/* TRENDS */}
                    {activeTab === 'trends' && (
                        <div>
                            <h3 style={{ fontSize: '1.15rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><TrendingUp size={20} /> Health Trends</h3>
                            {bmiData.length > 0 ? (
                                <div>
                                    <h4 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>BMI Over Time</h4>
                                    <ResponsiveContainer width="100%" height={300}>
                                        <LineChart data={bmiData}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                                            <XAxis dataKey="date" stroke="var(--text-dim)" fontSize={11} />
                                            <YAxis yAxisId="left" stroke="var(--text-dim)" fontSize={11} domain={['auto', 'auto']} />
                                            <YAxis yAxisId="right" orientation="right" stroke="var(--text-dim)" fontSize={11} domain={['auto', 'auto']} />
                                            <Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '8px' }} />
                                            <Line yAxisId="left" type="monotone" dataKey="BMI" stroke="var(--primary)" strokeWidth={2} dot={{ fill: 'var(--primary)', r: 4 }} name="BMI" />
                                            <Line yAxisId="left" type="monotone" dataKey="heartRate" stroke="var(--warning)" strokeWidth={2} dot={{ fill: 'var(--warning)', r: 4 }} name="Heart Rate (bpm)" />
                                            <Line yAxisId="right" type="monotone" dataKey="oxygen" stroke="var(--accent)" strokeWidth={2} dot={{ fill: 'var(--accent)', r: 4 }} name="Oxygen (%)" />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            ) : (
                                <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>
                                    <TrendingUp size={48} style={{ opacity: 0.2, marginBottom: '1rem' }} />
                                    <p>No vitals data yet. Submit your height &amp; weight in the &quot;Vitals&quot; tab to start tracking BMI.</p>
                                </div>
                            )}
                        </div>
                    )}

                    {/* PROFILE */}
                    {activeTab === 'profile' && (
                        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                            <div className="glass-panel" style={{ padding: '2rem', flex: '1 1 250px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                                <ProfileImageUpload
                                    currentImage={profileImage}
                                    onImageUpdate={url => setProfileImage(url)}
                                />
                                <h4 style={{ marginTop: '1rem', marginBottom: '0.25rem' }}>{profile.firstName} {profile.lastName}</h4>
                                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{currentUser?.email}</span>
                            </div>
                            <form onSubmit={submitProfile} className="glass-panel" style={{ flex: '2 1 400px' }}>
                                <h3 style={{ fontSize: '1.15rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><User size={20} /> Personal Information</h3>
                                <div className="form-group"><label className="form-label">First Name</label><input className="form-input" placeholder="Enter first name" value={profile.firstName} onChange={e => setProfile({ ...profile, firstName: e.target.value })} required /></div>
                                <div className="form-group"><label className="form-label">Last Name</label><input className="form-input" placeholder="Enter last name" value={profile.lastName} onChange={e => setProfile({ ...profile, lastName: e.target.value })} required /></div>
                                <div className="form-group"><label className="form-label">Gender</label>
                                    <select className="form-input" value={profile.gender} onChange={e => setProfile({ ...profile, gender: e.target.value })} required>
                                        <option value="" disabled>Select Gender</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option>
                                    </select>
                                </div>
                                <div className="form-group"><label className="form-label">Date of Birth</label><input className="form-input" type="date" value={profile.birthDate} onChange={e => setProfile({ ...profile, birthDate: e.target.value })} required /></div>
                                <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Saving...' : 'Save Profile'}</button>
                                {results.profile && <div style={{ marginTop: '1rem', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}><CheckCircle size={16} /> Saved Successfully</div>}
                            </form>
                        </div>
                    )}

                    {/* VITALS */}
                    {activeTab === 'vitals' && (
                        <form onSubmit={submitVitals}>
                            <h3 style={{ fontSize: '1.15rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Activity size={20} /> Submit Vitals</h3>
                            <div className="form-group"><label className="form-label">Height (cm)</label><input className="form-input" type="number" step="0.1" placeholder="e.g. 175.5" value={vitals.height_cm} onChange={e => setVitals({ ...vitals, height_cm: e.target.value })} /></div>
                            <div className="form-group"><label className="form-label">Weight (kg)</label><input className="form-input" type="number" step="0.1" placeholder="e.g. 70.2" value={vitals.weight_kg} onChange={e => setVitals({ ...vitals, weight_kg: e.target.value })} /></div>
                            <div className="form-group"><label className="form-label">Heart Rate (bpm)</label><input className="form-input" type="number" placeholder="e.g. 72" value={vitals.heartRate} onChange={e => setVitals({ ...vitals, heartRate: e.target.value })} /></div>
                            <div className="form-group"><label className="form-label">Oxygen SpO2 (%)</label><input className="form-input" type="number" placeholder="e.g. 98" value={vitals.oxygen} onChange={e => setVitals({ ...vitals, oxygen: e.target.value })} /></div>
                            <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Saving...' : 'Calculate & Save Vitals'}</button>
                            {results.vitals && <div style={{ marginTop: '1rem', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}><CheckCircle size={16} /> Saved Successfully</div>}
                        </form>
                    )}

                    {/* CONSENT & ACCESS */}
                    {activeTab === 'consent' && (
                        <div>
                            <h3 style={{ fontSize: '1.15rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><Shield size={20} /> Consent & Access</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                                Manage which doctors have access to your health records and diagnostic reports.
                            </p>

                            {fetchingDoctors ? (
                                <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}><span className="loader"></span> Loading doctors...</div>
                            ) : doctors.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '3rem 0', color: 'var(--text-muted)' }}>No doctors available right now.</div>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
                                    {doctors.map(doc => {
                                        const isGranted = consents.includes(doc.uid);
                                        return (
                                            <div key={doc.uid} style={{ background: 'rgba(255,255,255,0.03)', padding: '1.25rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                                                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'var(--gradient-card)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                                                        {doc.profileImage ? <img src={doc.profileImage} alt={doc.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <User size={20} />}
                                                    </div>
                                                    <div>
                                                        <h4 style={{ margin: '0 0 0.25rem', fontSize: '0.95rem' }}>{doc.name}</h4>
                                                        <div style={{ fontSize: '0.75rem', color: 'var(--primary)' }}>{doc.specialization || "General Medicine"}</div>
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => toggleConsent(doc.uid, isGranted)}
                                                    className={isGranted ? "btn-outline" : "btn-primary"}
                                                    style={{ width: '100%', padding: '0.5rem', fontSize: '0.85rem', borderColor: isGranted ? '#ef4444' : '', color: isGranted ? '#ef4444' : '' }}
                                                >
                                                    {isGranted ? "Revoke Access" : "Grant Access"}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PatientDashboard;
