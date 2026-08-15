import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * 서버 SSE 구독 — 이벤트 종류에 따라 관련 쿼리를 무효화해 화면을 자동 갱신한다.
 */
export function useServerEvents(): void {
  const qc = useQueryClient();

  useEffect(() => {
    const es = new EventSource('/api/events');

    const invalidate = (...keys: string[]) => {
      for (const key of keys) void qc.invalidateQueries({ queryKey: [key] });
    };

    es.addEventListener('job', () => invalidate('jobs', 'job', 'active-jobs'));
    // 카테고리 삭제 — 다른 탭에서 지웠어도 목록에서 사라져야 한다
    es.addEventListener('project', () => invalidate('projects', 'jobs', 'active-jobs'));
    es.addEventListener('source', () => invalidate('job'));
    es.addEventListener('source.progress', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      qc.setQueryData(['source-progress', data.jobId, data.sourceId], data.progress);
    });
    es.addEventListener('download.finished', () => invalidate('job', 'clips', 'active-jobs'));
    es.addEventListener('download.failed', (e) => {
      alert(`다운로드 실패: ${JSON.parse((e as MessageEvent).data).error}`);
      invalidate('job', 'active-jobs');
    });
    es.addEventListener('clip', () => invalidate('clips'));

    /**
     * 정리(1차·2차)가 끝났음을 화면에 알린다.
     * 성공이든 실패든 이걸 안 남기면 "처리 중…"이 영원히 안 꺼진다 — 실제로 그랬다.
     */
    const endClean = (data: { jobId: string; clipId: string }, error?: string) => {
      qc.setQueryData(['clean-end', data.jobId, data.clipId], { at: Date.now(), error });
      invalidate('clips');
    };
    es.addEventListener('clean.done', (e) => endClean(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('frames.failed', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      alert(`프레임 추출 실패 (${data.clipId}): ${data.error}`);
      invalidate('clips');
    });
    es.addEventListener('clean.failed', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      alert(`정리 실패 (${data.clipId}): ${data.error}`);
      endClean(data, data.error);
    });
    /**
     * 영상 재생성 — 클립 수만큼 오래 걸린다. 몇 개째인지 캐시에 적어 화면이 읽게 한다.
     * 끝나면 잡 상태가 대본 작성으로 넘어가므로 job도 함께 갱신한다.
     */
    es.addEventListener('regenerate.progress', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      if (data.phase) qc.setQueryData(['regenerate', data.jobId], data);
    });
    es.addEventListener('regenerate.finished', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      qc.setQueryData(['regenerate', data.jobId], undefined);
      invalidate('clips', 'job', 'active-jobs');
    });
    es.addEventListener('regenerate.failed', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      qc.setQueryData(['regenerate', data.jobId], undefined);
      alert(`영상 재생성 실패: ${data.error}`);
      invalidate('clips', 'job');
    });
    es.addEventListener('packet', () => invalidate('packets', 'packet'));
    es.addEventListener('packet.received', () => invalidate('packets', 'packet', 'job', 'script'));
    es.addEventListener('packet.failed', (e) => {
      alert(`요청서 실행 실패: ${JSON.parse((e as MessageEvent).data).error}`);
      invalidate('packets');
    });
    es.addEventListener('export.done', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      alert(`내보내기 완료 (${data.count}개 파일)\n${data.dir}`);
      invalidate('job', 'export');
    });
    es.addEventListener('export.failed', (e) => {
      alert(`내보내기 실패: ${JSON.parse((e as MessageEvent).data).error}`);
    });
    es.addEventListener('format.saved', () => invalidate('formats'));
    es.addEventListener('tts.done', () => invalidate('job'));
    es.addEventListener('tts.failed', (e) => {
      alert(`TTS 실패: ${JSON.parse((e as MessageEvent).data).error}`);
    });
    es.addEventListener('assemble.done', () => invalidate('job', 'output', 'active-jobs'));
    es.addEventListener('assemble.failed', (e) => {
      alert(`조립 실패: ${JSON.parse((e as MessageEvent).data).error}`);
    });

    return () => es.close();
  }, [qc]);
}
