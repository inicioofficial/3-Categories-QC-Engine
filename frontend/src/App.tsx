import { useEffect, type ReactNode } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";

import { AuthProvider, ProtectedRoute, RoleRoute, WorkspaceRoute, useAuth, type WorkspaceModule } from "@/app/auth";
import { AudioListeningPage } from "@/pages/AudioListeningPage";
import { AudioListeningDetailPage } from "@/pages/AudioListeningDetailPage";
import { AnalysisBreakdownPage } from "@/pages/AnalysisBreakdownPage";
import { CallbackDetailPage } from "@/pages/CallbackDetailPage";
import { CallbackManagementPage } from "@/pages/CallbackManagementPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ListingPhotoValidationImagesPage } from "@/pages/ListingPhotoValidationImagesPage";
import { ListingPictureCheckPage } from "@/pages/ListingPictureCheckPage";
import { ListingPictureCheckDetailPage } from "@/pages/ListingPictureCheckDetailPage";
import { EnumeratorAnalysisPage } from "@/pages/EnumeratorAnalysisPage";
import { ExportsPage } from "@/pages/ExportsPage";
import { ListingCaseDetailPage } from "@/pages/ListingCaseDetailPage";
import { ListingCasesPage } from "@/pages/ListingCasesPage";
import { LoginPage } from "@/pages/LoginPage";
import { MainCaseDetailPage } from "@/pages/MainCaseDetailPage";
import { MainCasesPage } from "@/pages/MainCasesPage";
import { MainQcProductivityPage } from "@/pages/MainQcProductivityPage";
import { MainSurveyCustomTablesPage } from "@/pages/MainSurveyCustomTablesPage";
import { MainSurveyOverviewPage } from "@/pages/MainSurveyOverviewPage";
import { MainSurveyVerbatimsPage } from "@/pages/MainSurveyVerbatimsPage";
import { MapVisualizationPage } from "@/pages/MapVisualizationPage";
import { UserManagementPage } from "@/pages/UserManagementPage";
import { WorkspaceSelectPage } from "@/pages/WorkspaceSelectPage";

function LegacyAccompanimentRedirect({ suffix }: { suffix: "photos" | "detail" }) {
  const { submissionKey } = useParams<{ submissionKey: string }>();
  return <Navigate to={`/main/accompaniment/${submissionKey ?? ""}/${suffix}`} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <AppRoutes />
      </HashRouter>
    </AuthProvider>
  );
}

const CATEGORY_ROUTES = new Set<WorkspaceModule>(["spread", "edible-oil", "breakfast-cereal"]);

function CategoryGate({ children }: { children: ReactNode }) {
  const { workspace } = useParams<{ workspace: string }>();
  const { selectedWorkspace, selectWorkspace } = useAuth();
  const validWorkspace = CATEGORY_ROUTES.has(workspace as WorkspaceModule) ? workspace as WorkspaceModule : null;

  useEffect(() => {
    if (validWorkspace && selectedWorkspace !== validWorkspace) selectWorkspace(validWorkspace);
  }, [selectedWorkspace, selectWorkspace, validWorkspace]);

  if (!validWorkspace) return <Navigate to="/workspace-select" replace />;
  if (selectedWorkspace !== validWorkspace) return null;
  return <WorkspaceRoute>{children}</WorkspaceRoute>;
}

function AppRoutes() {
  const location = useLocation();

  return (
    <Routes location={location} key={location.pathname}>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/workspace-select" element={<ProtectedRoute><WorkspaceSelectPage /></ProtectedRoute>} />
      <Route path="/:workspace" element={<CategoryGate><DashboardPage module="main" /></CategoryGate>} />
      <Route path="/:workspace/overview-demographics" element={<CategoryGate><DashboardPage module="main" /></CategoryGate>} />
      <Route path="/:workspace/geospatial-view" element={<CategoryGate><MapVisualizationPage module="main" /></CategoryGate>} />
      <Route path="/:workspace/listing-data-explorer" element={<CategoryGate><ListingCasesPage module="main" /></CategoryGate>} />
      <Route path="/:workspace/listing-cases/:submissionKey" element={<CategoryGate><ListingCaseDetailPage module="main" /></CategoryGate>} />
      <Route path="/:workspace/accompaniment" element={<CategoryGate><ListingPictureCheckPage module="main" /></CategoryGate>} />
      <Route path="/:workspace/accompaniment/:submissionKey/photos" element={<CategoryGate><ListingPictureCheckDetailPage module="main" /></CategoryGate>} />
      <Route path="/:workspace/accompaniment/:submissionKey/detail" element={<CategoryGate><ListingPictureCheckDetailPage module="main" /></CategoryGate>} />
      <Route path="/:workspace/cases" element={<CategoryGate><MainCasesPage /></CategoryGate>} />
      <Route path="/:workspace/cases/:submissionKey" element={<CategoryGate><MainCaseDetailPage /></CategoryGate>} />
      <Route path="/:workspace/verbatims" element={<CategoryGate><MainSurveyVerbatimsPage /></CategoryGate>} />
      <Route path="/:workspace/custom-tables" element={<CategoryGate><MainSurveyCustomTablesPage /></CategoryGate>} />
      <Route path="/:workspace/callbacks" element={<CategoryGate><CallbackManagementPage /></CategoryGate>} />
      <Route path="/:workspace/callbacks/:caseId/detail" element={<CategoryGate><CallbackDetailPage /></CategoryGate>} />
      <Route path="/:workspace/audio-listening" element={<CategoryGate><AudioListeningPage /></CategoryGate>} />
      <Route path="/:workspace/audio-listening/:caseId/detail" element={<CategoryGate><AudioListeningDetailPage /></CategoryGate>} />
      <Route path="/:workspace/enumerator-analysis" element={<CategoryGate><EnumeratorAnalysisPage /></CategoryGate>} />
      <Route path="/:workspace/qc-productivity" element={<CategoryGate><MainQcProductivityPage /></CategoryGate>} />
      <Route path="/:workspace/analysis-breakdown" element={<CategoryGate><AnalysisBreakdownPage /></CategoryGate>} />
      <Route path="/:workspace/*" element={<Navigate to="/workspace-select" replace />} />
          <Route
            path="/dashboard"
            element={<Navigate to="/main" replace />}
          />
          <Route
            path="/main"
            element={
              <WorkspaceRoute workspace="main">
                <DashboardPage module="main" />
              </WorkspaceRoute>
            }
          />
          <Route
            path="/main/overview-demographics"
            element={
              <WorkspaceRoute workspace="main">
                <DashboardPage module="main" />
              </WorkspaceRoute>
            }
          />
          <Route
            path="/main/geospatial-view"
            element={
              <WorkspaceRoute workspace="main">
                <RoleRoute allowedRoles={["admin", "data_engineer", "qc_reviewer", "supervisor", "client"]}>
                  <MapVisualizationPage module="main" />
                </RoleRoute>
              </WorkspaceRoute>
            }
          />
          <Route
            path="/main/listing-data-explorer"
            element={
              <WorkspaceRoute workspace="main">
                <RoleRoute allowedRoles={["admin", "data_engineer", "qc_reviewer", "supervisor", "client"]}>
                  <ListingCasesPage module="main" />
                </RoleRoute>
              </WorkspaceRoute>
            }
          />
          <Route
            path="/main/listing-cases/:submissionKey"
            element={
              <WorkspaceRoute workspace="main">
                <RoleRoute allowedRoles={["admin", "data_engineer", "qc_reviewer", "supervisor", "client"]}>
                  <ListingCaseDetailPage module="main" />
                </RoleRoute>
              </WorkspaceRoute>
            }
          />
          <Route
            path="/main/accompaniment"
            element={
              <WorkspaceRoute workspace="main">
                <RoleRoute allowedRoles={["admin", "data_engineer", "qc_reviewer", "client"]}>
                  <ListingPictureCheckPage module="main" />
                </RoleRoute>
              </WorkspaceRoute>
            }
          />
          <Route
            path="/main/accompaniment/:submissionKey/photos"
            element={
              <WorkspaceRoute workspace="main">
                <RoleRoute allowedRoles={["admin", "data_engineer", "qc_reviewer", "client"]}>
                  <ListingPictureCheckDetailPage module="main" />
                </RoleRoute>
              </WorkspaceRoute>
            }
          />
          <Route
            path="/main/accompaniment/:submissionKey/detail"
            element={
              <WorkspaceRoute workspace="main">
                <RoleRoute allowedRoles={["admin", "data_engineer", "qc_reviewer", "client"]}>
                  <ListingPictureCheckDetailPage module="main" />
                </RoleRoute>
              </WorkspaceRoute>
            }
          />
          <Route path="/main/incidence-hh-photo" element={<Navigate to="/main/accompaniment" replace />} />
          <Route path="/main/incidence-hh-photo/:submissionKey/photos" element={<LegacyAccompanimentRedirect suffix="photos" />} />
          <Route path="/main/incidence-hh-photo/:submissionKey/detail" element={<LegacyAccompanimentRedirect suffix="detail" />} />
          <Route
            path="/main/cases"
            element={
              <WorkspaceRoute workspace="main">
                <RoleRoute allowedRoles={["admin", "data_engineer", "qc_reviewer", "supervisor", "client"]}>
                  <MainCasesPage />
                </RoleRoute>
              </WorkspaceRoute>
            }
          />
          <Route
            path="/main/cases/:submissionKey"
            element={
              <WorkspaceRoute workspace="main">
                <RoleRoute allowedRoles={["admin", "data_engineer", "qc_reviewer", "supervisor", "client"]}>
                  <MainCaseDetailPage />
                </RoleRoute>
              </WorkspaceRoute>
            }
          />
          <Route
            path="/main/verbatims"
            element={
              <WorkspaceRoute workspace="main">
                <RoleRoute allowedRoles={["admin", "data_engineer", "qc_reviewer", "supervisor", "client"]}>
                  <MainSurveyVerbatimsPage />
                </RoleRoute>
              </WorkspaceRoute>
            }
          />
          <Route
            path="/main/custom-tables"
            element={
              <WorkspaceRoute workspace="main">
                <RoleRoute allowedRoles={["admin", "data_engineer", "qc_reviewer", "client"]}>
                  <MainSurveyCustomTablesPage />
                </RoleRoute>
              </WorkspaceRoute>
            }
          />
          <Route
            path="/main/callbacks/:caseId/detail"
            element={
              <WorkspaceRoute workspace="main">
                <RoleRoute allowedRoles={["SUPERADMIN", "INICIO-ADMIN", "PDM-ADMIN", "PDM-QC"]}>
                  <CallbackDetailPage />
                </RoleRoute>
              </WorkspaceRoute>
            }
          />
          <Route
            path="/main/callbacks"
            element={
              <WorkspaceRoute workspace="main">
                <RoleRoute allowedRoles={["SUPERADMIN", "INICIO-ADMIN", "PDM-ADMIN", "PDM-QC"]}>
                  <CallbackManagementPage />
                </RoleRoute>
              </WorkspaceRoute>
            }
          />
          <Route
            path="/main/audio-listening"
            element={
              <WorkspaceRoute workspace="main">
                <RoleRoute allowedRoles={["SUPERADMIN", "INICIO-ADMIN", "PDM-ADMIN", "PDM-QC"]}>
                  <AudioListeningPage />
                </RoleRoute>
              </WorkspaceRoute>
            }
          />
          <Route
            path="/main/audio-listening/:caseId/detail"
            element={
              <WorkspaceRoute workspace="main">
                <RoleRoute allowedRoles={["SUPERADMIN", "INICIO-ADMIN", "PDM-ADMIN", "PDM-QC"]}>
                  <AudioListeningDetailPage />
                </RoleRoute>
              </WorkspaceRoute>
            }
          />
          <Route
            path="/main/enumerator-analysis"
            element={
              <WorkspaceRoute workspace="main">
                <RoleRoute allowedRoles={["admin", "data_engineer", "qc_reviewer", "supervisor", "client"]}>
                  <EnumeratorAnalysisPage />
                </RoleRoute>
              </WorkspaceRoute>
            }
          />
          <Route
            path="/main/qc-productivity"
            element={
              <WorkspaceRoute workspace="main">
                <RoleRoute allowedRoles={["SUPERADMIN", "INICIO-ADMIN", "PDM-ADMIN", "PDM-QC"]}>
                  <MainQcProductivityPage />
                </RoleRoute>
              </WorkspaceRoute>
            }
          />
          <Route
            path="/main/analysis-breakdown"
            element={
              <WorkspaceRoute workspace="main">
                <RoleRoute allowedRoles={["admin", "data_engineer", "qc_reviewer", "supervisor", "client"]}>
                  <AnalysisBreakdownPage />
                </RoleRoute>
              </WorkspaceRoute>
            }
          />
          <Route path="/main/respondent-profile" element={<Navigate to="/main" replace />} />
          <Route path="/main/remittance-sources" element={<Navigate to="/main" replace />} />
          <Route path="/main/transfer-channels" element={<Navigate to="/main" replace />} />
          <Route path="/main/value-and-frequency" element={<Navigate to="/main" replace />} />
          <Route path="/main/use-of-remittance" element={<Navigate to="/main" replace />} />
          <Route path="/main/trust-fees-and-experience" element={<Navigate to="/main" replace />} />
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute>
                <RoleRoute allowedRoles={["SUPERADMIN", "PDM-ADMIN"]} requireWorkspace={false}>
                  <UserManagementPage />
                </RoleRoute>
              </ProtectedRoute>
            }
          />
          <Route path="/listing" element={<Navigate to="/main" replace />} />
          <Route path="/listing/*" element={<Navigate to="/main" replace />} />
          <Route path="/map" element={<Navigate to="/main/geospatial-view" replace />} />
          <Route path="/exports" element={<Navigate to="/main" replace />} />
          <Route path="/main/exports" element={<Navigate to="/main" replace />} />
          <Route path="/main/detail" element={<Navigate to="/main" replace />} />
          <Route path="/main/roster" element={<Navigate to="/main" replace />} />
    </Routes>
  );
}
