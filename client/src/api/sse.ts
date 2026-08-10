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
    es.addEventListener('source', () => invalidate('job'));
    es.addEventListener('source.progress', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      qc.setQueryData(['source-progress', data.jobId, data.sourceId], data.progress);
    });
    es.addEventListener('download.finished', () => invalidate('job', 'clips', 'active-jobs'));
    es.addEventListener('clip', () => invalidate('clips'));
    es.addEventListener('clean.done', () => invalidate('clips'));
    es.addEventListener('clean.failed', (e) => {
      const data = JSON.parse((e as MessageEvent).data);
      alert(`정리 실패 (${data.clipId}): ${data.error}`);
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
