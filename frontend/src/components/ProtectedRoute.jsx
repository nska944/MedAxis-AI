import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const ProtectedRoute = ({ children, allowedRoles }) => {
    const { currentUser, userRole, loading, patientAuthStep } = useAuth();

    if (loading) {
        return (
            <div className="auth-container">
                <div className="glass-panel" style={{ textAlign: 'center' }}>
                    <div className="loader" style={{ width: '40px', height: '40px', borderWidth: '4px' }}></div>
                    <p style={{ marginTop: '1rem' }}>Verifying Identity...</p>
                </div>
            </div>
        );
    }

    if (!currentUser) {
        return <Navigate to="/login" replace />;
    }

    // If roles are specified and user role doesn't match, redirect to their designated page or login
    if (allowedRoles && !allowedRoles.includes(userRole)) {
        if (userRole) {
            return <Navigate to={`/dashboard/${userRole}`} replace />;
        }
        return <Navigate to="/login" replace />;
    }

    // Layer 2 & 3 Enforcement for Patients
    if (userRole === 'patient' && patientAuthStep < 4) {
        console.warn("Blocking dashboard access: Patients must complete all 3 security layers.");
        return <Navigate to="/login" replace />;
    }

    return children;
};

export default ProtectedRoute;
