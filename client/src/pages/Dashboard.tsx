import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Globe, Package, ArrowRight } from 'lucide-react';
import { MENU_LABELS, STATE_LABELS, STATE_NEXT_ACTION } from '@shared/constants';
import { api } from '@/api/client';
import { clsx } from 'clsx';
import { Badge, Card, EmptyState, focusRing } from '@/components/ui';
import { StepIndicator } from '@/components/pipeline';
import { PacketCard, type PacketInfo } from '@/components/PacketCard';

interface ActiveJob {
  id: string;
  projectId: string;
  menu: 'menu-a' | 'menu-b';
  title: string;
  state: string;
  progress: number;
  pipeline: string[];
}

interface DoctorTool {
  name: string;
  required: boolean;
  available: boolean;
  version?: string;
  installHint: string;
}

export default function Dashboard() {
  const doctor = useQuery({
    queryKey: ['doctor'],
    queryFn: () => api.get<{ tools: DoctorTool[]; ok: boolean }>('/system/doctor'),
    staleTime: 60_000,
  });
  const active = useQuery({
    queryKey: ['active-jobs'],
    queryFn: () => api.get<ActiveJob[]>('/jobs/active'),
  });
  const packets = useQuery({
    queryKey: ['packets'],
    queryFn: () => api.get<PacketInfo[]>('/packets'),
  });

  const inbox = (packets.data ?? []).filter((p) => p.status === 'waiting' || p.status === 'received');

  return (
    <div className="space-y-6">
      {/* 도구 상태 */}
      {doctor.data && (
        <div className="flex flex-wrap items-center gap-2">
          {doctor.data.tools.map((t) => (
            <span key={t.name} title={t.available ? t.version : t.installHint}>
              <Badge color={t.available ? 'green' : t.required ? 'red' : 'amber'}>
                {t.available ? '●' : '○'} {t.name}
              </Badge>
            </span>
          ))}
          {!doctor.data.ok && (
            <span className="text-xs text-red-600">필수 도구 미설치 — 설정에서 확인하세요</span>
          )}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* 지금 할 일 */}
        <div className="space-y-3 lg:col-span-2">
          <h2 className="text-lg font-semibold">지금 할 일</h2>
          {active.data?.length === 0 && (
            <EmptyState message="진행 중인 작업이 없습니다. 아래 메뉴에서 시작하세요." />
          )}
          {(active.data ?? []).map((job) => (
            <Link key={job.id} to={`/job/${job.id}`} className={clsx('block rounded-xl', focusRing)}>
              <Card className="transition-all hover:border-slate-300 hover:shadow-md">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge color={job.menu === 'menu-a' ? 'blue' : 'violet'}>{MENU_LABELS[job.menu]}</Badge>
                    <span className="font-medium">{job.title}</span>
                  </div>
                  <span className="text-xs text-slate-500">{job.projectId}</span>
                </div>
                <StepIndicator pipeline={job.pipeline} state={job.state} />
                <div className="mt-2.5 flex items-center justify-between">
                  <span className="text-sm text-slate-500">
                    현재: <b className="text-slate-700">{STATE_LABELS[job.state] ?? job.state}</b>
                  </span>
                  <span className="flex items-center gap-1 text-sm font-medium text-brand-600">
                    {STATE_NEXT_ACTION[job.state] ?? '계속하기'} <ArrowRight size={14} />
                  </span>
                </div>
              </Card>
            </Link>
          ))}

          {/* 메뉴 타일 */}
          <div className="grid grid-cols-2 gap-3 pt-2">
            <Link to="/menu-a">
              <Card className="flex items-center gap-3 transition-all hover:border-slate-300 hover:shadow-md">
                <div className="rounded-lg bg-blue-100 p-2.5 text-blue-600"><Globe size={22} /></div>
                <div>
                  <p className="font-semibold">해외영상 짜집기</p>
                  <p className="text-xs text-slate-500">영상 URL → 다운로드 → 정리 → 대본</p>
                </div>
              </Card>
            </Link>
            <Link to="/menu-b">
              <Card className="flex items-center gap-3 transition-all hover:border-slate-300 hover:shadow-md">
                <div className="rounded-lg bg-violet-100 p-2.5 text-violet-600"><Package size={22} /></div>
                <div>
                  <p className="font-semibold">제품정보리뷰</p>
                  <p className="text-xs text-slate-500">고유 포맷 기반 수익화 콘텐츠</p>
                </div>
              </Card>
            </Link>
          </div>
        </div>

        {/* Claude 요청서 인박스 */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Claude 요청서</h2>
          {inbox.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
              대기 중인 요청서가 없습니다
            </p>
          )}
          {inbox.map((p) => <PacketCard key={p.id} packet={p} compact />)}
        </div>
      </div>
    </div>
  );
}
