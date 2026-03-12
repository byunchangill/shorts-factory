// Job 상세 페이지 (상태에 따라 적절한 서브페이지로 리다이렉트)
import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { mockJobs, STATUS_STEP } from '../data/mockData';

const STEP_ROUTES = {
  1: 'research',
  2: 'research',
  3: 'script',
  4: 'images',
  5: 'video',
  6: 'qc',
  7: 'export',
};

export default function JobDetailPage() {
  const { jobId } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const job = mockJobs.find(j => j.id === jobId);
    if (job) {
      const step = STATUS_STEP[job.status] || 1;
      const route = STEP_ROUTES[step] || 'research';
      navigate(`/jobs/${jobId}/${route}`, { replace: true });
    } else {
      navigate('/dashboard', { replace: true });
    }
  }, [jobId, navigate]);

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-gray-400 text-sm">불러오는 중...</div>
    </div>
  );
}
