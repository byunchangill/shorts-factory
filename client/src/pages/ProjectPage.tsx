import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { Plus, Upload, Save, FolderOpen, Trash2, Sparkles, ArrowRight } from 'lucide-react';
import {
  GUIDELINE_FILES, GUIDELINE_LABELS, MENU_LABELS, STATE_LABELS, stateNextAction,
  type GuidelineFile, type Menu,
} from '@shared/constants';
import { api, ApiBootingError } from '@/api/client';
import {
  Badge, Button, Card, ConfirmDialog, EmptyState, IconButton, Input, Modal, PageHeader, Textarea, focusRing,
} from '@/components/ui';
import { StepIndicator } from '@/components/pipeline';

interface JobSummary {
  id: string; title: string; state: string; progress: number; pipeline: string[]; createdAt: string;
}
interface ProductData {
  product: { name: string; price: string; features: string[]; sellingPoints: string[] };
  files: Array<{ name: string; url: string }>;
}

export default function ProjectPage() {
  const { menu, pid } = useParams() as { menu: Menu; pid: string };
  const [tab, setTab] = useState<'jobs' | 'guidelines' | 'product'>('jobs');

  return (
    <div className="space-y-4">
      <PageHeader
        backTo={`/${menu}`}
        backLabel={`${MENU_LABELS[menu]} 카테고리 목록으로`}
        eyebrow={MENU_LABELS[menu]}
        title={pid}
        actions={
          <nav className="flex gap-1 rounded-lg bg-slate-100 p-1">
            {([['jobs', '작업'], ['guidelines', '지침'], ['product', '제품자료']] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                aria-current={tab === k ? 'page' : undefined}
                className={clsx(
                  'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
                  focusRing,
                  tab === k
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900',
                )}
              >
                {label}
              </button>
            ))}
          </nav>
        }
      />

      {tab === 'jobs' && <JobsTab menu={menu} pid={pid} />}
      {tab === 'guidelines' && <GuidelinesTab menu={menu} pid={pid} />}
      {tab === 'product' && <ProductTab menu={menu} pid={pid} />}
    </div>
  );
}

function JobsTab({ menu, pid }: { menu: Menu; pid: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState<JobSummary | null>(null);
  const jobs = useQuery({
    queryKey: ['jobs', menu, pid],
    queryFn: () => api.get<JobSummary[]>(`/projects/${menu}/${pid}/jobs`),
  });
  const create = useMutation({
    mutationFn: () => api.post<JobSummary>(`/projects/${menu}/${pid}/jobs`, { title }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      void qc.invalidateQueries({ queryKey: ['active-jobs'] });
      setOpen(false);
      setTitle('');
    },
  });

  const remove = useMutation({
    mutationFn: (j: JobSummary) => api.del(`/jobs/${j.id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      void qc.invalidateQueries({ queryKey: ['active-jobs'] });
      void qc.invalidateQueries({ queryKey: ['packets'] });
      setTarget(null);
    },
  });

  // 샘플 소재는 해외영상 짜집기 흐름(다운로드 → 분석 → 정리)용이라 menu-a에서만 쓴다
  const sample = useQuery({
    queryKey: ['sample'],
    queryFn: () => api.get<{ available: boolean; jobTitle: string }>('/projects/sample'),
    enabled: menu === 'menu-a',
  });

  const createSample = useMutation({
    mutationFn: () => api.post<{ job: { id: string } }>(
      `/projects/${menu}/${pid}/jobs/sample`, { title: title.trim() || undefined }),
    // 개발 서버는 코드가 바뀌면 재시작한다 (git pull 직후가 특히 그렇다).
    // 그 몇 초를 사용자가 실패로 겪지 않도록 부팅 중이면 조용히 다시 시도한다
    retry: (count, err) => err instanceof ApiBootingError && count < 5,
    retryDelay: 2000,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['jobs'] });
      void qc.invalidateQueries({ queryKey: ['active-jobs'] });
      setOpen(false);
      setTitle('');
      navigate(`/job/${r.job.id}`);
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}><Plus size={16} /> 새 영상 작업</Button>
      </div>
      {jobs.data?.length === 0 && <EmptyState message="아직 작업이 없습니다." />}
      {(jobs.data ?? []).map((j) => (
        // 삭제 버튼은 링크 밖에 둔다 — 안에 넣으면 눌렀을 때 작업 화면으로 넘어가 버린다
        <div key={j.id} className="group relative">
          <Link to={`/job/${j.id}`} className={clsx('block rounded-xl', focusRing)}>
            <Card className="transition-all hover:border-slate-300 hover:shadow-md">
              <div className="mb-2.5 flex items-center justify-between gap-3">
                <span className="min-w-0 truncate font-medium">{j.title}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge color={j.state === 'done' ? 'green' : j.state === 'failed' ? 'red' : 'brand'}>
                    {STATE_LABELS[j.state] ?? j.state}
                  </Badge>
                  {/* 삭제 버튼이 겹쳐 앉는 자리를 미리 비워둔다 */}
                  <span className="w-7" />
                </div>
              </div>
              <StepIndicator pipeline={j.pipeline} state={j.state} />
              {/* 목록에서도 다음에 뭘 해야 하는지 보이게 — 열어봐야 아는 것을 줄인다.
                  현재 단계는 위 배지에 이미 있으므로 여기서는 할 일만 적는다 */}
              <p className="mt-2.5 flex items-center justify-end gap-1 text-sm font-medium text-brand-700">
                {stateNextAction(menu, j.state)} <ArrowRight size={14} />
              </p>
            </Card>
          </Link>
          <IconButton
            tone="danger"
            label="이 영상 작업 삭제"
            className="absolute right-2.5 top-2.5"
            onClick={() => { remove.reset(); setTarget(j); }}
          >
            <Trash2 size={15} />
          </IconButton>
        </div>
      ))}

      <ConfirmDialog
        open={!!target}
        title="영상 작업 삭제"
        pending={remove.isPending}
        error={remove.isError ? `삭제하지 못했습니다 — ${remove.error.message}` : undefined}
        onConfirm={() => target && remove.mutate(target)}
        onClose={() => setTarget(null)}
        description={
          <>
            <p>
              <b className="text-slate-800">{target?.title}</b> 작업의 소재·클립·대본·요청서·산출물이
              모두 사라집니다.
            </p>
            <p className="text-xs text-slate-500">
              완전히 지우지 않고 <code>workspace/.trash/</code> 로 옮깁니다 — 되돌리려면 그 폴더를
              원래 자리로 옮기면 됩니다. 이미 내보낸 결과물 폴더는 그대로 남습니다.
            </p>
          </>
        }
      />
      <Modal open={open} onClose={() => setOpen(false)} title="새 영상 작업">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: 1편 - 흡입력 비교" autoFocus />

        {(create.isError || createSample.isError) && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            만들지 못했습니다 — {(create.error ?? createSample.error)?.message}
          </p>
        )}

        {/*
          리포에 들어 있는 실제 영상으로 바로 시작 — 새 PC에서 눌러볼 것을 만든다.
          샘플은 소스 영상 4개라 해외영상 짜집기에서만 쓸 수 있다 —
          제품정보리뷰에는 영상을 모으는 단계 자체가 없어 눌러도 서버가 400으로 막는다
        */}
        {menu === 'menu-a' && sample.data?.available && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-medium">샘플 소재로 시작</p>
            <p className="mt-1 text-xs text-slate-500">
              리포에 들어 있는 주방 선반 영상 4개를 넣고 <b>영상 분석</b>부터 시작합니다.
              제목을 비워두면 "{sample.data.jobTitle}"로 만듭니다. 원본 샘플은 그대로 보존됩니다.
            </p>
            <Button
              variant="secondary"
              className="mt-2"
              onClick={() => createSample.mutate()}
              disabled={createSample.isPending}
            >
              <Sparkles size={15} /> {createSample.isPending ? '만드는 중…' : '샘플 사용하기'}
            </Button>
          </div>
        )}

        <div className="mt-3 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>취소</Button>
          <Button onClick={() => create.mutate()} disabled={!title.trim() || create.isPending}>만들기</Button>
        </div>
      </Modal>
    </div>
  );
}

function GuidelinesTab({ menu, pid }: { menu: Menu; pid: string }) {
  const [file, setFile] = useState<GuidelineFile>('script.md');
  const [content, setContent] = useState('');
  const qc = useQueryClient();
  const guideline = useQuery({
    queryKey: ['guideline', menu, pid, file],
    queryFn: () => api.get<{ content: string }>(`/projects/${menu}/${pid}/guidelines/${file}`),
  });
  useEffect(() => {
    if (guideline.data) setContent(guideline.data.content);
  }, [guideline.data]);
  const save = useMutation({
    mutationFn: () => api.put(`/projects/${menu}/${pid}/guidelines/${file}`, { content }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['guideline'] }),
  });

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex gap-1">
          {GUIDELINE_FILES.map((f) => (
            <button
              key={f}
              onClick={() => setFile(f)}
              className={clsx(
                'rounded-md px-3 py-1.5 text-sm',
                file === f ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-500 hover:bg-slate-100',
              )}
            >
              {GUIDELINE_LABELS[f]}
            </button>
          ))}
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          <Save size={14} /> 저장
        </Button>
      </div>
      <Textarea rows={18} value={content} onChange={(e) => setContent(e.target.value)} />
      <p className="mt-2 text-xs text-slate-500">
        이 지침은 이 폴더에서 발행되는 모든 Claude 요청서에 자동으로 포함되어, 대본·영상이 지침대로 만들어집니다.
      </p>
    </Card>
  );
}

/**
 * 드래그로 떨어뜨린 항목에서 파일을 모은다.
 * 폴더를 끌어다 놓으면 항목 자체는 파일이 아니라 디렉터리 엔트리라, 안을 훑어야 한다.
 */
async function collectDropped(items: DataTransferItemList): Promise<Array<{ file: File; path: string }>> {
  const out: Array<{ file: File; path: string }> = [];

  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject));
      out.push({ file, path: prefix ? `${prefix}/${file.name}` : file.name });
      return;
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries는 한 번에 일부만 준다 — 빈 배열이 올 때까지 반복해야 전부 읽힌다
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await walk(child, prefix ? `${prefix}/${entry.name}` : entry.name);
    }
  };

  const entries = Array.from(items)
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);
  for (const e of entries) await walk(e, '');
  return out;
}

function ProductTab({ menu, pid }: { menu: Menu; pid: string }) {
  const qc = useQueryClient();
  const [dragging, setDragging] = useState(false);
  const data = useQuery({
    queryKey: ['product', menu, pid],
    queryFn: () => api.get<ProductData>(`/projects/${menu}/${pid}/product`),
  });
  const upload = useMutation({
    // 파일 선택·폴더 선택·드래그 모두 같은 경로로 보낸다.
    // 세 번째 인자의 파일명에 상대경로를 넣으면 서버가 폴더 구조를 살려 저장한다
    mutationFn: (files: Array<{ file: File; path: string }>) => {
      const fd = new FormData();
      for (const { file, path } of files) fd.append('files', file, path);
      return api.upload<{ uploaded: string[]; errors: string[] }>(
        `/projects/${menu}/${pid}/product/files`, fd);
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['product'] }),
  });
  const removeFile = useMutation({
    mutationFn: (name: string) =>
      api.del(`/projects/${menu}/${pid}/product/files?file=${encodeURIComponent(name)}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['product'] }),
  });

  /** input[type=file]에서 온 목록 — 폴더 선택이면 webkitRelativePath에 경로가 담긴다 */
  const fromInput = (list: FileList) =>
    Array.from(list).map((file) => ({
      file,
      path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    }));

  const product = data.data?.product;

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="mb-2 font-medium">쿠팡 상세페이지 첨부</h3>
        <p className="mb-3 text-sm text-slate-500">
          상세페이지 캡처·텍스트를 올리면 "제품정보 추출" 요청서로 AI가 product.json을 만듭니다.
          <br />
          <span className="text-slate-500">
            압축파일(zip)은 자동으로 풀고, 폴더는 구조를 그대로 살려 저장합니다. 끌어다 놓아도 됩니다.
          </span>
        </p>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void collectDropped(e.dataTransfer.items).then((files) => {
              if (files.length) upload.mutate(files);
            });
          }}
          className={clsx(
            'rounded-lg border-2 border-dashed py-6 text-center text-sm',
            dragging ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-slate-300 text-slate-500',
          )}
        >
          <p className="mb-3">여기로 파일·폴더·압축파일을 끌어다 놓으세요</p>
          <div className="flex justify-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Upload size={15} /> 파일 선택
              <input
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) upload.mutate(fromInput(e.target.files));
                  e.target.value = '';
                }}
              />
            </label>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
              <FolderOpen size={15} /> 폴더 선택
              <input
                type="file"
                multiple
                className="hidden"
                // 리액트 타입에 없는 비표준 속성 — 폴더 선택을 여는 유일한 방법이다
                {...{ webkitdirectory: '', directory: '' }}
                onChange={(e) => {
                  if (e.target.files?.length) upload.mutate(fromInput(e.target.files));
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </div>
        {upload.isPending && <p className="mt-2 text-sm text-slate-500">올리는 중…</p>}
        {upload.error && <p className="mt-2 text-sm text-red-600">{upload.error.message}</p>}
        {(upload.data?.errors ?? []).length > 0 && (
          <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {upload.data!.errors.map((e) => <p key={e}>압축을 풀지 못했습니다 — {e}</p>)}
          </div>
        )}
        {(data.data?.files ?? []).length > 0 && (
          <>
            <p className="mt-3 text-xs text-slate-500">첨부 {data.data!.files.length}개</p>
            <ul className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {data.data!.files.map((f) => (
                <li key={f.name} className="group relative rounded-lg border border-slate-200 p-1.5 text-xs">
                  {/\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name) ? (
                    <img src={f.url} alt={f.name} className="mb-1 h-24 w-full rounded object-cover" />
                  ) : null}
                  <p className="truncate text-slate-600" title={f.name}>{f.name}</p>
                  <button
                    className="absolute right-1 top-1 rounded bg-white/90 p-1 text-slate-500 opacity-0 hover:text-red-500 group-hover:opacity-100"
                    title="이 자료 삭제"
                    disabled={removeFile.isPending}
                    onClick={() => removeFile.mutate(f.name)}
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card>
        <h3 className="mb-2 font-medium">추출된 제품 정보 (product.json)</h3>
        {product?.name ? (
          <dl className="space-y-1.5 text-sm">
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">제품명</dt><dd className="font-medium">{product.name}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">가격</dt><dd>{product.price}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">핵심 기능</dt><dd>{product.features.join(', ')}</dd></div>
            <div className="flex gap-2"><dt className="w-24 shrink-0 text-slate-500">구매 포인트</dt><dd>{product.sellingPoints.join(', ')}</dd></div>
          </dl>
        ) : (
          <p className="text-sm text-slate-500">아직 추출되지 않았습니다. 작업 화면에서 "제품정보 추출" 요청서를 발행하세요.</p>
        )}
      </Card>
    </div>
  );
}
