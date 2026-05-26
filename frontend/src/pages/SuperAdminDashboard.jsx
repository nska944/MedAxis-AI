import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { Shield, Users, FileText, Activity, LogOut, Search, Trash2, PlusCircle, X } from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// ─── Small reusable modal ────────────────────────────────────────────────────
const Modal = ({ title, onClose, children }) => (
    <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem'
    }}>
        <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '14px',
            padding: '2rem', width: '100%', maxWidth: '420px', position: 'relative'
        }}>
            <button onClick={onClose} style={{ position: 'absolute', top: '1rem', right: '1rem', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>
                <X size={20} />
            </button>
            <h3 style={{ marginBottom: '1.5rem', fontSize: '1.1rem' }}>{title}</h3>
            {children}
        </div>
    </div>
);

// ─── Create User Form ─────────────────────────────────────────────────────────
const CreateUserForm = ({ role, onClose, onCreated, getToken }) => {
    const [form, setForm] = useState({ name: '', email: '', password: '' });
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true); setErr('');
        try {
            const token = await getToken();
            const res = await fetch(`${API_BASE_URL}/superadmin/create-user`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ ...form, role })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to create user');
            onCreated(data.user, role);
            onClose();
        } catch (e) { setErr(e.message); }
        finally { setLoading(false); }
    };

    const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
    return (
        <form onSubmit={handleSubmit}>
            <div className="form-group">
                <label className="form-label">Full Name</label>
                <input className="form-input" placeholder={`${roleLabel} name`} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required />
            </div>
            <div className="form-group">
                <label className="form-label">Email</label>
                <input className="form-input" type="email" placeholder="email@example.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required />
            </div>
            <div className="form-group">
                <label className="form-label">Password</label>
                <input className="form-input" type="password" placeholder="Min 6 characters" minLength={6} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} required />
            </div>
            {err && <div style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '1rem' }}>{err}</div>}
            <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={loading}>
                {loading ? 'Creating...' : `Create ${roleLabel}`}
            </button>
        </form>
    );
};

// ─── Edit Password Form ────────────────────────────────────────────────────────
const EditPasswordForm = ({ uid, onClose, getToken }) => {
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');
    const [success, setSuccess] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true); setErr(''); setSuccess('');
        try {
            const token = await getToken();
            const res = await fetch(`${API_BASE_URL}/superadmin/edit-password/${uid}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ new_password: password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to update password');
            setSuccess('Password updated successfully!');
            setTimeout(onClose, 1500);
        } catch (e) { setErr(e.message); }
        finally { setLoading(false); }
    };

    return (
        <form onSubmit={handleSubmit}>
            <div className="form-group">
                <label className="form-label">New Password</label>
                <input className="form-input" type="password" placeholder="Min 6 characters" minLength={6} value={password} onChange={e => setPassword(e.target.value)} required />
            </div>
            {err && <div style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '1rem' }}>{err}</div>}
            {success && <div style={{ color: '#10b981', fontSize: '0.85rem', marginBottom: '1rem' }}>{success}</div>}
            <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={loading}>
                {loading ? 'Updating...' : `Update Password`}
            </button>
        </form>
    );
};

// ─── Main Dashboard ────────────────────────────────────────────────────────────
const SuperAdminDashboard = () => {
    const { currentUser, logout } = useAuth();
    const [activeTab, setActiveTab] = useState('stats');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [stats, setStats] = useState(null);
    const [users, setUsers] = useState({ patients: [], doctors: [], hospitals: [], superadmins: [] });
    const [reports, setReports] = useState([]);
    const [searchId, setSearchId] = useState('');
    const [searchResult, setSearchResult] = useState(null);
    const [searchError, setSearchError] = useState('');

    // Create modal state
    const [createModal, setCreateModal] = useState(null); // null | 'patient' | 'doctor' | 'hospital'
    // Edit password modal state
    const [editPasswordModal, setEditPasswordModal] = useState(null); // null | { uid, name }
    // Delete confirmation state
    const [deleteConfirm, setDeleteConfirm] = useState(null); // null | { uid, name, role }
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [deleteError, setDeleteError] = useState('');

    useEffect(() => { fetchData(); }, [currentUser]);

    const fetchData = async () => {
        if (!currentUser) return;
        setLoading(true);
        try {
            const token = await currentUser.getIdToken();
            const headers = { 'Authorization': `Bearer ${token}` };

            const [statsRes, usersRes, reportsRes] = await Promise.all([
                fetch(`${API_BASE_URL}/superadmin/platform-stats`, { headers }),
                fetch(`${API_BASE_URL}/superadmin/all-users`, { headers }),
                fetch(`${API_BASE_URL}/superadmin/all-reports`, { headers })
            ]);

            if (statsRes.ok) setStats(await statsRes.json());
            if (usersRes.ok) setUsers(await usersRes.json());
            if (reportsRes.ok) {
                const rd = await reportsRes.json();
                setReports(rd.reports || []);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = async () => {
        if (!searchId.trim()) return;
        setSearchError(''); setSearchResult(null);
        try {
            const token = await currentUser.getIdToken();
            const res = await fetch(`${API_BASE_URL}/patient/lookup?health_id=${encodeURIComponent(searchId.trim())}`, {
                headers: { 'Authorization': `Bearer ${token}` },
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Patient not found');
            setSearchResult(data);
        } catch (err) { setSearchError(err.message); }
    };

    // Append newly created user to local state immediately
    const handleUserCreated = (newUser, role) => {
        setUsers(prev => {
            const key = role === 'hospital' ? 'hospitals' : `${role}s`;
            return { ...prev, [key]: [...prev[key], newUser] };
        });
    };

    // Delete user
    const handleDeleteConfirm = async () => {
        if (!deleteConfirm) return;
        setDeleteLoading(true); setDeleteError('');
        try {
            const token = await currentUser.getIdToken();
            const res = await fetch(`${API_BASE_URL}/superadmin/delete-user/${deleteConfirm.uid}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.detail || 'Failed to delete user');

            // Remove from local state
            setUsers(prev => {
                const key = deleteConfirm.role === 'hospital' ? 'hospitals' : `${deleteConfirm.role}s`;
                return { ...prev, [key]: prev[key].filter(u => (u.uid || u.id) !== deleteConfirm.uid) };
            });
            setDeleteConfirm(null);
        } catch (e) { setDeleteError(e.message); }
        finally { setDeleteLoading(false); }
    };

    const tabs = ['stats', 'users', 'reports', 'lookup', 'guide'];

    const cardStyle = {
        background: 'rgba(255,255,255,0.05)', padding: '1.5rem', borderRadius: '12px',
        border: '1px solid var(--border-color)', textAlign: 'center'
    };
    const statValue = { fontSize: '2.5rem', fontWeight: 700, color: 'var(--primary)', marginBottom: '0.25rem' };

    const UserTable = ({ group }) => {
        const roleKey = group.title === 'Hospitals' ? 'hospital' : group.title === 'Doctors' ? 'doctor' : 'patient';
        return (
            <div key={group.title} className="glass-panel" style={{ padding: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <h3 style={{ color: group.color, display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                        {group.icon} {group.title} ({group.data.length})
                    </h3>
                    <button
                        onClick={() => setCreateModal(roleKey)}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(255,255,255,0.07)', border: '1px solid var(--border-color)', borderRadius: '8px', color: group.color, padding: '0.4rem 0.9rem', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600 }}
                    >
                        <PlusCircle size={15} /> Add {group.title.slice(0, -1)}
                    </button>
                </div>

                {group.data.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No {group.title.toLowerCase()} registered yet.</p> : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Name</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Email</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>ID</th>
                                    <th style={{ textAlign: 'left', padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {group.data.map((u, i) => (
                                    <tr key={i} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                        <td style={{ padding: '0.75rem', color: 'var(--text-main)' }}>{u.name || '—'}</td>
                                        <td style={{ padding: '0.75rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>{u.email}</td>
                                        <td style={{ padding: '0.75rem' }}>
                                            <span style={{ background: 'rgba(96,165,250,0.15)', color: '#60a5fa', padding: '2px 8px', borderRadius: '4px', fontSize: '0.8rem', fontFamily: 'monospace' }}>
                                                {u.healthId || u.doctorId || u.employeeId || (u.uid || u.id)?.substring(0, 8)}
                                            </span>
                                        </td>
                                        <td style={{ padding: '0.75rem' }}>
                                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                <button
                                                    onClick={() => setEditPasswordModal({ uid: u.uid || u.id, name: u.name || u.email })}
                                                    style={{ background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.3)', borderRadius: '6px', color: '#34d399', padding: '0.3rem 0.6rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem' }}
                                                >
                                                    <Shield size={13} /> Edit Password
                                                </button>
                                                <button
                                                    onClick={() => setDeleteConfirm({ uid: u.uid || u.id, name: u.name || u.email, role: roleKey })}
                                                    style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', color: '#ef4444', padding: '0.3rem 0.6rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.3rem', fontSize: '0.8rem' }}
                                                >
                                                    <Trash2 size={13} /> Delete
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto', width: '100%' }}>
            {/* Header */}
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <Shield size={32} color="#f59e0b" />
                    <h2>Super Admin Console</h2>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{currentUser?.email}</span>
                    <span style={{ background: 'rgba(245,158,11,0.2)', color: '#f59e0b', padding: '0.25rem 0.75rem', borderRadius: '20px', fontSize: '0.8rem', fontWeight: 600 }}>SUPER ADMIN</span>
                    <button onClick={logout} className="btn-primary" style={{ padding: '0.5rem 1rem', width: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
                        <LogOut size={16} /> Sign Out
                    </button>
                </div>
            </header>

            {/* Tabs */}
            <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border-color)', marginBottom: '2rem', overflowX: 'auto' }}>
                {tabs.map(tab => (
                    <button key={tab} onClick={() => setActiveTab(tab)}
                        style={{
                            background: 'none', border: 'none', padding: '0.75rem 1.5rem',
                            color: activeTab === tab ? 'var(--primary)' : 'var(--text-muted)',
                            borderBottom: activeTab === tab ? '2px solid var(--primary)' : '2px solid transparent',
                            cursor: 'pointer', fontWeight: 600, textTransform: 'capitalize', whiteSpace: 'nowrap'
                        }}
                    >{tab === 'lookup' ? '🔍 Patient Lookup' : tab === 'stats' ? '📊 Platform Stats' : tab === 'users' ? '👥 All Users' : tab === 'reports' ? '📋 All Reports' : '🎓 Project Guide'}</button>
                ))}
            </div>

            {error && <div style={{ color: '#ef4444', marginBottom: '1rem', padding: '1rem', background: 'rgba(239,68,68,0.1)', borderRadius: '8px' }}>{error}</div>}
            {loading ? <p style={{ color: 'var(--text-muted)' }}>Loading platform data...</p> : (
                <>
                    {/* Stats Tab */}
                    {activeTab === 'stats' && stats && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1.5rem' }}>
                            <div style={cardStyle}><div style={statValue}>{stats.total_patients}</div><div style={{ color: 'var(--text-muted)' }}>Patients</div></div>
                            <div style={cardStyle}><div style={statValue}>{stats.total_doctors}</div><div style={{ color: 'var(--text-muted)' }}>Doctors</div></div>
                            <div style={cardStyle}><div style={statValue}>{stats.total_hospitals}</div><div style={{ color: 'var(--text-muted)' }}>Hospitals</div></div>
                            <div style={cardStyle}><div style={statValue}>{stats.total_reports}</div><div style={{ color: 'var(--text-muted)' }}>Reports</div></div>
                            <div style={cardStyle}><div style={{ ...statValue, color: stats.unresolved_alerts > 0 ? '#ef4444' : '#10b981' }}>{stats.unresolved_alerts}</div><div style={{ color: 'var(--text-muted)' }}>Unresolved Alerts</div></div>
                            <div style={cardStyle}><div style={statValue}>{stats.total_users}</div><div style={{ color: 'var(--text-muted)' }}>Total Users</div></div>
                        </div>
                    )}

                    {/* Users Tab */}
                    {activeTab === 'users' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                            {[
                                { title: 'Patients', data: users.patients, color: '#60a5fa', icon: <Users size={20} /> },
                                { title: 'Doctors', data: users.doctors, color: '#34d399', icon: <Activity size={20} /> },
                                { title: 'Hospitals', data: users.hospitals, color: '#f472b6', icon: <Shield size={20} /> }
                            ].map(group => <UserTable key={group.title} group={group} />)}
                        </div>
                    )}

                    {/* Reports Tab */}
                    {activeTab === 'reports' && (
                        <div className="glass-panel" style={{ padding: '1.5rem' }}>
                            <h3 style={{ marginBottom: '1rem' }}><FileText size={20} style={{ display: 'inline', marginRight: '0.5rem' }} /> All Diagnostic Reports ({reports.length})</h3>
                            {reports.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No reports in the system yet.</p> : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                                    {reports.map((r, i) => (
                                        <div key={i} style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                                <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{r.patient_name} ({r.patient_email})</span>
                                                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Report: {r.id}</span>
                                            </div>
                                            {r.presentedForm?.[0]?.url && (
                                                <a href={r.presentedForm[0].url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontSize: '0.9rem' }}>→ View PDF</a>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Lookup Tab */}
                    {activeTab === 'lookup' && (
                        <div className="glass-panel" style={{ padding: '1.5rem' }}>
                            <h3 style={{ marginBottom: '1rem' }}><Search size={20} style={{ display: 'inline', marginRight: '0.5rem' }} /> Search Patient by Health ID</h3>
                            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
                                <input type="text" className="form-input" placeholder="e.g. PAT-A1B2C3" value={searchId} onChange={e => setSearchId(e.target.value)} style={{ margin: 0, flex: 1 }} />
                                <button onClick={handleSearch} className="btn-primary" style={{ margin: 0, width: 'auto' }}>Search</button>
                            </div>
                            {searchError && <div style={{ color: '#ef4444', marginBottom: '1rem' }}>{searchError}</div>}
                            {searchResult && (
                                <div style={{ background: 'rgba(255,255,255,0.03)', padding: '1.5rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                                    <h4 style={{ color: '#34d399', marginBottom: '1rem' }}>✓ Patient Found</h4>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1rem', fontSize: '0.9rem' }}>
                                        <span style={{ color: 'var(--text-muted)' }}>Name:</span><span>{searchResult.patient.name}</span>
                                        <span style={{ color: 'var(--text-muted)' }}>Email:</span><span>{searchResult.patient.email}</span>
                                        <span style={{ color: 'var(--text-muted)' }}>Health ID:</span><span style={{ fontFamily: 'monospace', color: '#60a5fa' }}>{searchResult.patient.healthId}</span>
                                        <span style={{ color: 'var(--text-muted)' }}>Height:</span><span>{searchResult.patient.height || '—'} cm</span>
                                        <span style={{ color: 'var(--text-muted)' }}>Weight:</span><span>{searchResult.patient.weight || '—'} kg</span>
                                        <span style={{ color: 'var(--text-muted)' }}>BMI:</span><span>{searchResult.patient.bmi || '—'}</span>
                                    </div>
                                    <h4 style={{ marginBottom: '0.5rem' }}>Reports ({searchResult.reports.length})</h4>
                                    {searchResult.reports.length === 0 ? <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>No reports found for this patient.</p> : (
                                        searchResult.reports.map((r, i) => (
                                            <div key={i} style={{ background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '6px', marginBottom: '0.5rem', border: '1px solid rgba(255,255,255,0.05)' }}>
                                                <span style={{ fontSize: '0.85rem', color: 'var(--text-main)' }}>Report: {r.id}</span>
                                                {r.presentedForm?.[0]?.url && (
                                                    <a href={r.presentedForm[0].url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontSize: '0.85rem', marginLeft: '1rem' }}>View PDF →</a>
                                                )}
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Guide Tab */}
                    {activeTab === 'guide' && (
                        <div className="glass-panel" style={{ padding: '2rem', lineHeight: '1.6' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
                                <Shield size={28} color="var(--primary)" />
                                <div>
                                    <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Platform Guide</h3>
                                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Project Workflow and Access Role Documentation</p>
                                </div>
                            </div>

                            <p style={{ marginBottom: '2rem', color: 'var(--text-main)', fontSize: '0.95rem' }}>
                                This system provides role-based access to manage hospitals, doctors, and patient diagnostic reports using AI analysis.
                                Below is the intended user workflow.
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '10px', borderLeft: '4px solid #f59e0b' }}>
                                    <h4 style={{ color: '#f59e0b', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <Shield size={18} /> 1. Superadmin Role
                                    </h4>
                                    <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                                        Superadmins oversee the platform. They can create <strong>Hospital</strong> accounts via the "All Users" tab.
                                    </p>
                                </div>

                                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '10px', borderLeft: '4px solid #f472b6' }}>
                                    <h4 style={{ color: '#f472b6', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <Users size={18} /> 2. Hospital Admin Role
                                    </h4>
                                    <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                                        Hospitals manage clinical staff. Hospital admins can create <strong>Doctor</strong> accounts
                                        and assign registered patients to specific doctors.
                                    </p>
                                </div>

                                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '10px', borderLeft: '4px solid #60a5fa' }}>
                                    <h4 style={{ color: '#60a5fa', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <User size={18} /> 3. Patient Workflow
                                    </h4>
                                    <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                                        Patients register dynamically. They can track vitals, upload blood report PDFs, and the AI will auto-analyze risk factors.
                                        Crucially, patients must explicitly manage doctor access via the <strong>Consent & Access</strong> tab to share their reports.
                                    </p>
                                </div>

                                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1.5rem', borderRadius: '10px', borderLeft: '4px solid #34d399' }}>
                                    <h4 style={{ color: '#34d399', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <Activity size={18} /> 4. Doctor Role
                                    </h4>
                                    <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                                        Doctors only see reports for patients who are assigned to them AND have explicitly granted consent.
                                        They can review AI summaries, resolve alerts, and create prescriptions.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* Create User Modal */}
            {createModal && (
                <Modal title={`Create New ${createModal.charAt(0).toUpperCase() + createModal.slice(1)}`} onClose={() => setCreateModal(null)}>
                    <CreateUserForm
                        role={createModal}
                        onClose={() => setCreateModal(null)}
                        onCreated={handleUserCreated}
                        getToken={() => currentUser.getIdToken()}
                    />
                </Modal>
            )}

            {/* Edit Password Modal */}
            {editPasswordModal && (
                <Modal title={`Edit Password for ${editPasswordModal.name}`} onClose={() => setEditPasswordModal(null)}>
                    <EditPasswordForm
                        uid={editPasswordModal.uid}
                        onClose={() => setEditPasswordModal(null)}
                        getToken={() => currentUser.getIdToken()}
                    />
                </Modal>
            )}

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <Modal title="Confirm Delete" onClose={() => { setDeleteConfirm(null); setDeleteError(''); }}>
                    <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem', fontSize: '0.95rem' }}>
                        Are you sure you want to permanently delete <strong style={{ color: 'var(--text-main)' }}>{deleteConfirm.name}</strong>?
                        This will remove their account and all associated medical records. This action cannot be undone.
                    </p>
                    {deleteError && <div style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '1rem' }}>{deleteError}</div>}
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <button onClick={() => { setDeleteConfirm(null); setDeleteError(''); }} className="btn-outline" style={{ flex: 1 }}>Cancel</button>
                        <button onClick={handleDeleteConfirm} disabled={deleteLoading}
                            style={{ flex: 1, background: '#ef4444', color: '#fff', border: 'none', borderRadius: '8px', padding: '0.65rem', fontWeight: 600, cursor: 'pointer', opacity: deleteLoading ? 0.7 : 1 }}>
                            {deleteLoading ? 'Deleting...' : 'Yes, Delete'}
                        </button>
                    </div>
                </Modal>
            )}
        </div>
    );
};

export default SuperAdminDashboard;
