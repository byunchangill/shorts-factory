import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { pingApi, subscribeApiHealth, type ApiHealth } from '@/api/client';

const RETRY_INTERVAL_MS = 3_000;

/**
 * API 서버가 죽어 있으면 모든 화면이 "아무 반응 없음"으로 보인다.
 * 원인을 화면에 띄우고, 서버가 살아나면 자동으로 배너를 걷고 화면을 갱신한다.
 */
export default function ApiHealthBanner() {
  const qc = useQueryClient();
  const [health, setHealth] = useState<ApiHealth>({ online: true });

  useEffect(() => subscribeApiHealth(setHealth), []);

  useEffect(() => {
    if (health.online) return;
    const timer = setInterval(() => {
      void pingApi().then((ok) => {
        if (ok) void qc.invalidateQueries();
      });
    }, RETRY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [health.online, qc]);

  if (health.online) return null;

  return (
    <div className="flex items-start gap-2.5 border-b border-amber-300 bg-amber-50 px-6 py-3 text-sm text-amber-900">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <div>
        <p className="font-medium">{health.reason}</p>
        <p className="mt-0.5 text-xs text-amber-700">
          연결되면 자동으로 복구됩니다. 계속 실패하면 터미널의 <code>[api]</code> 출력에서 오류를 확인하세요.
        </p>
      </div>
    </div>
  );
}
