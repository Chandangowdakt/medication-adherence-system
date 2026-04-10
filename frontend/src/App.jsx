import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute.jsx';
import { ProtectedDoctorRoute } from './components/ProtectedDoctorRoute.jsx';
import { RoleRedirect } from './components/RoleRedirect.jsx';
import { AppShell } from './components/AppShell.jsx';
import { Login } from './pages/Login.jsx';
import { Register } from './pages/Register.jsx';
import { Dashboard } from './pages/Dashboard.jsx';
import { MedicationsPage } from './pages/MedicationsPage.jsx';
import { SideEffectsPage } from './pages/SideEffectsPage.jsx';
import { DoctorDashboard } from './pages/DoctorDashboard.jsx';
import { DoctorPatientDetail } from './pages/DoctorPatientDetail.jsx';
import { PatientOnlyRoute } from './components/PatientOnlyRoute.jsx';

/**
 * Public auth routes + JWT layout for app sections.
 */
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route index element={<RoleRedirect />} />
          <Route
            path="dashboard"
            element={
              <PatientOnlyRoute>
                <Dashboard />
              </PatientOnlyRoute>
            }
          />
          <Route
            path="medications"
            element={
              <PatientOnlyRoute>
                <MedicationsPage />
              </PatientOnlyRoute>
            }
          />
          <Route
            path="side-effects"
            element={
              <PatientOnlyRoute>
                <SideEffectsPage />
              </PatientOnlyRoute>
            }
          />
          <Route
            path="doctor"
            element={
              <ProtectedDoctorRoute>
                <DoctorDashboard />
              </ProtectedDoctorRoute>
            }
          />
          <Route
            path="doctor/patient/:patientId"
            element={
              <ProtectedDoctorRoute>
                <DoctorPatientDetail />
              </ProtectedDoctorRoute>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
