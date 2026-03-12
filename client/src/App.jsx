// 메인 앱 - 라우팅 설정 (BrowserRouter 사용으로 file:// 프로토콜 지원)
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppLayout from './components/layout/AppLayout';
import Dashboard from './pages/Dashboard';
import NewJob from './pages/NewJob';
import JobDetailPage from './pages/JobDetailPage';
import ResearchPage from './pages/ResearchPage';
import ScriptPage from './pages/ScriptPage';
import ImagesPage from './pages/ImagesPage';
import VideoPage from './pages/VideoPage';
import QCPage from './pages/QCPage';
import ExportPage from './pages/ExportPage';
import UsedVideosPage from './pages/UsedVideosPage';
import SettingsPage from './pages/SettingsPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 2, staleTime: 30000 },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            {/* 기본 리다이렉트 */}
            <Route index element={<Navigate to="/dashboard" replace />} />

            {/* 대시보드 */}
            <Route path="dashboard" element={<Dashboard />} />

            {/* 새 작업 */}
            <Route path="jobs/new" element={<NewJob />} />

            {/* Job 상세 (서브페이지로 리다이렉트) */}
            <Route path="jobs/:jobId" element={<JobDetailPage />} />

            {/* 7단계 워크플로우 */}
            <Route path="jobs/:jobId/research" element={<ResearchPage />} />
            <Route path="jobs/:jobId/script" element={<ScriptPage />} />
            <Route path="jobs/:jobId/images" element={<ImagesPage />} />
            <Route path="jobs/:jobId/video" element={<VideoPage />} />
            <Route path="jobs/:jobId/qc" element={<QCPage />} />
            <Route path="jobs/:jobId/export" element={<ExportPage />} />

            {/* 관리 페이지 */}
            <Route path="admin/used-videos" element={<UsedVideosPage />} />
            <Route path="settings" element={<SettingsPage />} />

            {/* 404 */}
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
