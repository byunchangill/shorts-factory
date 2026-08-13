import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { FolderPlus, Folder, Trash2 } from 'lucide-react';
import { MENU_LABELS, type Menu } from '@shared/constants';
import { api } from '@/api/client';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, IconButton, Input, Modal, PageHeader, focusRing,
} from '@/components/ui';

interface ProjectWithCounts {
  id: string;
  title: string;
  menu: Menu;
  formatId?: string;
  jobCounts: { total: number; done: number; active: number };
}

interface FormatSummary { id: string; name: string }

export default function MenuPage({ menu }: { menu: Menu }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [formatId, setFormatId] = useState('');
  const [target, setTarget] = useState<ProjectWithCounts | null>(null);

  const projects = useQuery({
    queryKey: ['projects', menu],
    queryFn: () => api.get<ProjectWithCounts[]>(`/projects?menu=${menu}`),
  });
  const formats = useQuery({
    queryKey: ['formats'],
    queryFn: () => api.get<FormatSummary[]>('/formats'),
    enabled: menu === 'menu-b',
  });

  const create = useMutation({
    mutationFn: () =>
      api.post<ProjectWithCounts>('/projects', {
        menu,
        title,
        formatId: menu === 'menu-b' && formatId ? formatId : undefined,
      }),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      setOpen(false);
      setTitle('');
      navigate(`/project/${menu}/${p.id}`);
    },
  });

  const remove = useMutation({
    mutationFn: (p: ProjectWithCounts) => api.del(`/projects/${menu}/${p.id}`),
    onSuccess: () => {
      // 카테고리가 사라지면 그 안의 잡도 함께 사라진다 — 대시보드의 "지금 할 일"까지 갱신
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      void qc.invalidateQueries({ queryKey: ['active-jobs'] });
      setTarget(null);
    },
  });

  // 이전 실패 메시지가 남은 채로 모달이 다시 열리지 않게 한다
  const openModal = () => {
    create.reset();
    setOpen(true);
  };

  const openDelete = (p: ProjectWithCounts) => {
    remove.reset();
    setTarget(p);
  };

  // menu-b 최초 진입: 포맷이 하나도 없으면 포맷 만들기로 유도
  const noFormats = menu === 'menu-b' && formats.data && formats.data.length === 0;

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow={MENU_LABELS[menu]}
        title="카테고리"
        actions={
          <>
            {menu === 'menu-b' && (
              <Link to="/formats" className={clsx('rounded-lg', focusRing)}>
                <Button variant="secondary" tabIndex={-1}>고유 포맷 관리</Button>
              </Link>
            )}
            <Button onClick={openModal} disabled={!!noFormats}>
              <FolderPlus size={16} /> 새 카테고리
            </Button>
          </>
        }
      />

      {noFormats && (
        <Card className="border-violet-200 bg-violet-50">
          <p className="font-medium text-violet-900">먼저 고유 포맷을 만들어야 합니다</p>
          <p className="mt-1 text-sm text-violet-700">
            제품정보리뷰는 채널 고유 포맷(구조·톤·씬 템플릿·브랜딩)을 정한 뒤, 그 포맷으로 반복 생산하는 메뉴입니다.
          </p>
          <Link to="/formats"><Button className="mt-3">고유 포맷 만들기</Button></Link>
        </Card>
      )}

      {projects.data?.length === 0 && !noFormats && (
        <EmptyState
          message="카테고리가 없습니다. 생활용품·주방·수납처럼 묶어서 만들고, 그 안에 영상 작업을 하나씩 만드세요."
          action={<Button onClick={openModal}><FolderPlus size={16} /> 새 카테고리</Button>}
        />
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {(projects.data ?? []).map((p) => (
          // 삭제 버튼은 링크 밖에 둔다 — 안에 넣으면 눌렀을 때 카테고리로 들어가 버린다
          <div key={p.id} className="group relative">
            <Link to={`/project/${menu}/${p.id}`} className={clsx('block rounded-xl', focusRing)}>
              <Card className="h-full transition-all hover:border-slate-300 hover:shadow-md">
                <div className="flex items-center gap-2.5 pr-8">
                  <Folder size={18} className="shrink-0 text-slate-500" />
                  <span className="min-w-0 truncate font-medium">{p.title}</span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {p.jobCounts.active > 0 && <Badge color="blue">진행 {p.jobCounts.active}</Badge>}
                  {p.jobCounts.done > 0 && <Badge color="green">완료 {p.jobCounts.done}</Badge>}
                  {p.jobCounts.total === 0 && <Badge>작업 없음</Badge>}
                  {p.formatId && <Badge color="violet">{p.formatId}</Badge>}
                </div>
              </Card>
            </Link>
            <IconButton
              tone="danger"
              label={`${p.title} 카테고리 삭제`}
              className="absolute right-1.5 top-1.5"
              onClick={() => openDelete(p)}
            >
              <Trash2 size={15} />
            </IconButton>
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={!!target}
        title="카테고리 삭제"
        confirmWord={target && target.jobCounts.total > 0 ? target.title : undefined}
        pending={remove.isPending}
        error={remove.isError ? `삭제하지 못했습니다 — ${remove.error.message}` : undefined}
        onConfirm={() => target && remove.mutate(target)}
        onClose={() => setTarget(null)}
        description={
          <>
            <p>
              <b className="text-slate-800">{target?.title}</b> 카테고리와 그 안의 지침·제품자료
              {target && target.jobCounts.total > 0 && (
                <>, 영상 작업 <b className="text-slate-800">{target.jobCounts.total}개</b>
                  {target.jobCounts.active > 0 && ` (진행 중 ${target.jobCounts.active}개)`}</>
              )}
              가 함께 사라집니다.
            </p>
            <p className="text-xs text-slate-500">
              완전히 지우지 않고 <code>workspace/.trash/</code> 로 옮깁니다 — 되돌리려면 그 폴더를
              원래 자리로 옮기면 됩니다. 이미 내보낸 결과물 폴더는 그대로 남습니다.
            </p>
          </>
        }
      />

      <Modal open={open} onClose={() => setOpen(false)} title="새 카테고리">
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium">카테고리 이름</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 생활용품" autoFocus />
          </div>
          {menu === 'menu-b' && (
            <div>
              <label className="mb-1 block text-sm font-medium">사용할 고유 포맷</label>
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={formatId}
                onChange={(e) => setFormatId(e.target.value)}
              >
                <option value="">선택하세요</option>
                {(formats.data ?? []).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          )}
          {create.isError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              카테고리를 만들지 못했습니다 — {create.error.message}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>취소</Button>
            <Button
              onClick={() => create.mutate()}
              disabled={!title.trim() || (menu === 'menu-b' && !formatId) || create.isPending}
            >
              만들기
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
