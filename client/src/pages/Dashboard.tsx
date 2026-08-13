import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Globe, Package, ArrowRight } from 'lucide-react';
import { MENU_LABELS, STATE_LABELS, STATE_NEXT_ACTION } from '@shared/constants';
import { api } from '@/api/client';
import { clsx } from 'clsx';
import { Badge, Card, focusRing } from '@/components/ui';
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
          {active.data?.length === 0 && <FirstRunGuide />}
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

          {/* 메뉴 타일 — 어느 쪽을 골라야 하는지 판단할 수 있게 재료와 결과를 함께 적는다 */}
          <div className="grid gap-3 pt-2 sm:grid-cols-2">
            <Link to="/menu-a" className={clsx('block rounded-xl', focusRing)}>
              <Card className="flex h-full items-start gap-3 transition-all hover:border-slate-300 hover:shadow-md">
                <div className="shrink-0 rounded-lg bg-blue-100 p-2.5 text-blue-600"><Globe size={22} /></div>
                <div className="min-w-0">
                  <p className="font-semibold">해외영상 짜집기</p>
                  <p className="mt-0.5 break-keep text-xs text-slate-600">
                    이미 있는 해외 영상을 재료로 씁니다. 자막·워터마크를 지우고 필요한 구간만
                    이어붙여 만듭니다.
                  </p>
                  <p className="mt-1.5 text-xs text-slate-500">필요한 것 · 영상 주소 또는 영상 파일</p>
                </div>
              </Card>
            </Link>
            <Link to="/menu-b" className={clsx('block rounded-xl', focusRing)}>
              <Card className="flex h-full items-start gap-3 transition-all hover:border-slate-300 hover:shadow-md">
                <div className="shrink-0 rounded-lg bg-violet-100 p-2.5 text-violet-600"><Package size={22} /></div>
                <div className="min-w-0">
                  <p className="font-semibold">제품정보리뷰</p>
                  <p className="mt-0.5 break-keep text-xs text-slate-600">
                    영상 없이 제품 정보만으로 만듭니다. 채널 고유 포맷을 한 번 정해두고
                    같은 틀로 반복 생산합니다.
                  </p>
                  <p className="mt-1.5 text-xs text-slate-500">필요한 것 · 쿠팡 상세페이지 자료</p>
                </div>
              </Card>
            </Link>
          </div>
        </div>

        {/* AI에게 맡긴 일 */}
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">AI에게 맡긴 일</h2>
          {inbox.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
              AI에게 맡긴 일이 없습니다
            </p>
          )}
          {inbox.map((p) => <PacketCard key={p.id} packet={p} compact />)}
        </div>
      </div>
    </div>
  );
}

/**
 * 처음 켰을 때 보이는 안내. 진행 중인 작업이 없으면 빈 목록 대신 이걸 띄운다.
 *
 * 이 앱은 카테고리 > 영상 작업 > 단계로 두 겹 들어가는 구조라, 그 구조를 모르면
 * "새 카테고리"라는 버튼이 무엇을 만드는 버튼인지 알 수 없다. 그래서 구조부터 알린다.
 */
function FirstRunGuide() {
  const steps = [
    ['카테고리를 만듭니다', '생활용품·주방처럼 제품군으로 묶는 폴더입니다. 지침과 제품 자료가 여기 붙습니다.'],
    ['그 안에 영상 작업을 만듭니다', '영상 작업 하나가 완성 영상 한 편입니다.'],
    ['화면이 시키는 대로 단계를 밟습니다', '단계마다 무엇을 할지, 언제 다음으로 넘어가는지 화면 위에 적혀 있습니다.'],
  ];
  return (
    <Card className="border-dashed">
      <p className="font-semibold">처음이시라면 — 이렇게 시작합니다</p>
      <ol className="mt-3 space-y-2.5">
        {steps.map(([title, desc], i) => (
          <li key={title} className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium break-keep">{title}</p>
              <p className="break-keep text-xs text-slate-600">{desc}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 break-keep text-xs text-slate-600">
        아래에서 만들 종류를 고르세요. 눌러볼 것이 필요하면 카테고리를 만든 뒤
        새 영상 작업 창의 <b className="text-slate-800">샘플 사용하기</b>로 실제 영상이 든 작업을 만들 수 있습니다.
      </p>
    </Card>
  );
}
