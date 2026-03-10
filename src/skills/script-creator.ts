/**
 * Script Creator Skill — Step 3: 대본 생성
 * Reference video 분석 기반 카테고리별 대본 생성, 유사도 검증, 건강 규정 준수
 */

import { writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  GeneratedScript,
  Scene,
  ScriptMeta,
  SimilarityCheck,
  HealthComplianceAudit,
  ContentType,
  ReferenceVideo,
  ComplianceViolation,
  AutoFix,
} from '../types/index.js';
import { JobManager } from '../core/job-manager.js';
import { emitEvent } from '../core/event-emitter.js';
import { checkSimilarity } from '../utils/similarity-check.js';
import {
  checkScript,
  getDisclaimers,
  type ComplianceResult,
} from '../utils/health-compliance.js';

/**
 * 카테고리별 대본 템플릿 구조
 * 각 카테고리는 씬 구조 템플릿과 시간 분배 규칙을 정의
 */
interface ScriptTemplate {
  contentType: ContentType;
  sceneCount: number;
  totalDurationSec: number;
  sections: ScriptSection[];
}

interface ScriptSection {
  name: string;
  sceneCount: number;
  durationSec: number;
  emotionalTone: string;
  description: string;
}

/**
 * 카테고리별 스크립트 템플릿 반환
 * @param contentType - 콘텐츠 타입 (dog, sseoltoon, health)
 * @returns ScriptTemplate 객체
 */
export function getScriptTemplate(contentType: ContentType): ScriptTemplate {
  const templates: Record<ContentType, ScriptTemplate> = {
    dog: {
      contentType: 'dog',
      sceneCount: 6,
      totalDurationSec: 46,
      sections: [
        {
          name: '훅(Hook)',
          sceneCount: 1,
          durationSec: 3,
          emotionalTone: 'shocking, attention-grabbing',
          description: '강아지의 감정적 충격 또는 뜻밖의 상황 제시',
        },
        {
          name: '일상(Daily Life)',
          sceneCount: 1,
          durationSec: 7,
          emotionalTone: 'calm, relatable',
          description: '강아지의 일상적 생활, 배경 설정',
        },
        {
          name: '시련(Challenge/Conflict)',
          sceneCount: 2,
          durationSec: 12,
          emotionalTone: 'tense, dramatic',
          description: '어려움이나 위기 상황 전개',
        },
        {
          name: '클라이맥스(Climax)',
          sceneCount: 1,
          durationSec: 13,
          emotionalTone: 'intense, hopeful',
          description: '사건의 절정 또는 반전',
        },
        {
          name: '감동결말(Emotional Ending)',
          sceneCount: 1,
          durationSec: 8,
          emotionalTone: 'heartwarming, satisfying',
          description: '감동적이고 해결되는 결말',
        },
        {
          name: 'CTA(Call-To-Action)',
          sceneCount: 1,
          durationSec: 3,
          emotionalTone: 'optimistic, engaging',
          description: '구독, 좋아요, 댓글 유도',
        },
      ],
    },
    sseoltoon: {
      contentType: 'sseoltoon',
      sceneCount: 7,
      totalDurationSec: 52,
      sections: [
        {
          name: '훅(Hook)',
          sceneCount: 1,
          durationSec: 4,
          emotionalTone: 'shocking, intriguing',
          description: '이야기의 훅: 반전이나 충격 예고',
        },
        {
          name: '상황설정(Situation Setup)',
          sceneCount: 2,
          durationSec: 8,
          emotionalTone: 'neutral, narrative',
          description: '등장인물과 상황 소개',
        },
        {
          name: '전개(Development)',
          sceneCount: 2,
          durationSec: 16,
          emotionalTone: 'building tension',
          description: '사건의 전개 및 상황 심화',
        },
        {
          name: '반전(Plot Twist)',
          sceneCount: 1,
          durationSec: 10,
          emotionalTone: 'shocking, surprising',
          description: '예상치 못한 반전 장면',
        },
        {
          name: '엔딩(Ending)',
          sceneCount: 1,
          durationSec: 8,
          emotionalTone: 'resolved, satisfying',
          description: '이야기의 결말',
        },
      ],
    },
    health: {
      contentType: 'health',
      sceneCount: 5,
      totalDurationSec: 50,
      sections: [
        {
          name: '충격사실(Shocking Fact)',
          sceneCount: 1,
          durationSec: 3,
          emotionalTone: 'alarming, attention-grabbing',
          description: '건강과 관련된 놀라운 사실 제시',
        },
        {
          name: '원인설명(Explanation)',
          sceneCount: 1,
          durationSec: 10,
          emotionalTone: 'educational, informative',
          description: '원인과 메커니즘 설명',
        },
        {
          name: '해결법(Solution)',
          sceneCount: 2,
          durationSec: 20,
          emotionalTone: 'helpful, optimistic',
          description: '해결 방법 및 팁 제시',
        },
        {
          name: '요약+면책+CTA(Summary + Disclaimer + CTA)',
          sceneCount: 1,
          durationSec: 7,
          emotionalTone: 'professional, trustworthy',
          description: '핵심 요약, 법적 면책, 행동 유도',
        },
      ],
    },
  };

  return templates[contentType];
}

/**
 * Claude LLM용 프롬프트 빌드
 * Reference video 분석을 기반으로 카테고리별 대본 생성 지시
 * @param reference - 분석된 reference video
 * @param contentType - 콘텐츠 타입
 * @returns 프롬프트 문자열
 */
export function buildScriptPrompt(
  reference: ReferenceVideo,
  contentType: ContentType,
): string {
  const template = getScriptTemplate(contentType);

  const basePrompt = `
당신은 ${contentType === 'dog' ? '감정 기반 강아지 쇼츠' : contentType === 'sseoltoon' ? '웹툰 스타일 썰 쇼츠' : '신뢰 기반 건강 쇼츠'} 대본 작성 전문가입니다.

## 참고 영상 분석
- 제목: ${reference.title}
- 채널: ${reference.channelName}
- 구조: ${reference.analysis.structure.join(' → ')}
- 감정 흐름: ${reference.analysis.emotionalCurve}
- 페이싱: ${reference.analysis.pacing}
- 바이럴 포인트: ${reference.analysis.viralPoints.join(', ')}

## 생성할 대본 구조 (${contentType} 카테고리)
총 ${template.totalDurationSec}초, ${template.sceneCount}개 씬:
${template.sections
  .map(
    (s) => `
- **${s.name}** (${s.durationSec}초, 약 ${Math.round(s.durationSec * 0.16)}단어)
  톤: ${s.emotionalTone}
  설명: ${s.description}
`,
  )
  .join('')}

## 핵심 제약
1. **원본 문장 재사용 금지**: 제공된 구조와 감정 흐름만 참고, 구체적 문장은 완전히 새로 작성
2. **사건 순서 변경 가능**: 원본과 정확히 같은 순서로 하지 마세요
3. **구체적 세부 변경**: 원본과 다른 설정, 이름, 상황으로 재창작
4. **캐릭터 보존 금지**: 원본의 실제 인물/캐릭터를 그대로 사용하지 마세요
5. ${contentType === 'health' ? '**건강 표현 신중**: "완치", "무조건", "기적" 같은 절대적 표현 금지. "도움이 될 수 있다", "일반적으로" 등 조건부 표현 사용' : '**시각적 명확성**: 각 씬의 비주얼 의도를 명확히 지시'}

## 요청 형식 (JSON)
다음 JSON을 생성하세요:
\`\`\`json
{
  "hook": "훅 문구 (최대 50자)",
  "cta": "행동 유도 문구 (최대 50자)",
  "scenes": [
    {
      "sceneId": "scene_01",
      "order": 1,
      "narration": "나레이션 텍스트 (약 30-50자)",
      "visualIntent": "이미지/영상에서 표현할 비주얼 (예: 강아지가 밤새 기다리는 모습, 창밖 보며 슬픈 표정)",
      "emotion": "씬의 감정 (예: sad, hopeful, shocking)",
      "camera": "카메라 각도 (예: close-up, wide, overhead)",
      "durationSec": 3
    },
    ...
  ],
  "titleCandidates": ["제목 후보 1", "제목 후보 2", "제목 후보 3"],
  "thumbnailHookCandidates": ["썸네일 훅 1", "썸네일 훅 2"]
}
\`\`\`

지금 대본을 생성해주세요.
`;

  return basePrompt;
}

/**
 * 유사도 검증 실행
 * Reference video와 생성된 script를 비교하여 저작권 리스크 평가
 * @param reference - 원본 reference video
 * @param script - 생성된 script
 * @returns SimilarityCheck 객체
 */
export function runSimilarityCheck(
  reference: ReferenceVideo,
  script: GeneratedScript,
): SimilarityCheck {
  // 원본 구조를 문자열 배열로 추출
  const originalStructure = reference.analysis.structure;

  // 생성 대본의 구조를 시각적 의도 기반으로 추출
  const newStructure = script.scenes.map((s) => s.visualIntent);

  // 나레이션 텍스트 수집
  const originalText = reference.description || reference.title;
  const newText = script.scenes.map((s) => s.narration).join(' ');

  // 유사도 검증 실행
  const result = checkSimilarity({
    originalText,
    newText,
    originalStructure,
    newStructure,
    originalTitle: reference.title,
    newTitle: script.meta.titleCandidates[0] || '(제목 미정)',
  });

  return result;
}

/**
 * 건강 규정 검사 실행 (health 콘텐츠만)
 * @param script - 생성된 script
 * @param projectDir - 프로젝트 디렉토리
 * @returns ComplianceResult 또는 null (non-health는 스킵)
 */
export function runHealthCheck(
  script: GeneratedScript,
  projectDir: string,
): ComplianceResult | null {
  if (script.meta.titleCandidates[0]?.contentType !== 'health') {
    return null;
  }

  // Scene 배열을 checkScript에 필요한 형식으로 변환
  const scenes = script.scenes.map((s) => ({
    sceneId: s.sceneId,
    narration: s.narration,
  }));

  const result = checkScript(scenes, projectDir);
  return result;
}

/**
 * 자동 수정 적용
 * Health compliance에서 제안한 AutoFix를 script에 반영
 * @param script - 생성된 script
 * @param fixes - 자동 수정 목록
 * @returns 수정된 script
 */
export function applyAutoFixes(
  script: GeneratedScript,
  fixes: AutoFix[],
): GeneratedScript {
  const updated = structuredClone(script);

  for (const fix of fixes) {
    const scene = updated.scenes.find((s) => s.sceneId === fix.sceneId);
    if (scene) {
      scene.narration = scene.narration.replace(fix.original, fix.rewritten);
    }
  }

  return updated;
}

/**
 * 사용자 표시용 대본 포맷팅
 * @param script - 생성된 script
 * @returns 포맷된 문자열
 */
export function formatScriptForUser(script: GeneratedScript): string {
  const lines: string[] = [];

  lines.push(`# 대본 (버전 ${script.version})`);
  lines.push('');
  lines.push(`**훅**: ${script.hook}`);
  lines.push('');

  for (const scene of script.scenes) {
    lines.push(
      `## [${scene.order}] ${scene.emotion} (${scene.durationSec}초)`,
    );
    lines.push(`**나레이션**: ${scene.narration}`);
    lines.push(`**비주얼**: ${scene.visualIntent}`);
    lines.push(`**카메라**: ${scene.camera}`);
    lines.push('');
  }

  lines.push(`**CTA**: ${script.cta}`);
  lines.push('');

  if (script.healthCompliance && script.healthCompliance.violations.length > 0) {
    lines.push('## 건강 규정 이슈');
    for (const violation of script.healthCompliance.violations) {
      lines.push(
        `- [${violation.severity}] ${violation.sentence} (규칙: ${violation.ruleId})`,
      );
    }
    lines.push('');
  }

  if (script.similarityCheck.overallRisk !== 'low') {
    lines.push('## 유사도 검증 결과');
    lines.push(`**위험 수준**: ${script.similarityCheck.overallRisk}`);
    if (script.similarityCheck.details) {
      for (const detail of script.similarityCheck.details) {
        lines.push(`- ${detail}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 메인 대본 생성 오케스트레이터
 * Reference video 분석을 기반으로 카테고리별 대본 생성 및 검증
 * @param jobId - Job ID
 * @param reference - 분석된 reference video
 * @param projectDir - 프로젝트 디렉토리
 * @returns 생성된 GeneratedScript 객체
 */
export async function generateScript(
  jobId: string,
  reference: ReferenceVideo,
  projectDir: string,
): Promise<GeneratedScript> {
  const jobManager = new JobManager(projectDir);
  const job = jobManager.getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  try {
    // 1. 생성 시작 이벤트
    emitEvent({
      jobId,
      eventType: 'SCRIPT_GENERATION_STARTED',
      actor: 'system',
      fromStatus: job.status,
      toStatus: 'scripting',
    });

    jobManager.transitionJob(jobId, 'scripting', {
      eventType: 'SCRIPT_GENERATION_STARTED',
      actor: 'system',
    });

    // 2. 프롬프트 빌드
    const prompt = buildScriptPrompt(reference, job.contentType);

    // NOTE: 실제 Claude 호출은 Claude Code 자연 대화 처리로 진행됨
    // 여기서는 구조와 프롬프트만 제공
    // 결과 script는 이후 onScriptGenerated 호출 시 수신
    console.log('Script prompt prepared for Claude generation:');
    console.log(prompt);

    // 3. 임시 script 객체 생성 (placeholder)
    const scriptId = `script_${jobId}_001`;
    const template = getScriptTemplate(job.contentType);

    const placeholderScript: GeneratedScript = {
      scriptId,
      jobId,
      version: 1,
      inspiredBy: reference.videoId,
      meta: {
        titleCandidates: ['제목 후보 1', '제목 후보 2', '제목 후보 3'],
        thumbnailHookCandidates: ['썸네일 훅 1', '썸네일 훅 2'],
        tags: ['tag1', 'tag2', 'tag3'],
        totalDurationSec: template.totalDurationSec,
      },
      similarityCheck: {
        phraseOverlapScore: 0,
        structureOverlapScore: 0,
        titleSimilarityScore: 0,
        overallRisk: 'low',
      },
      hook: '(생성 대기 중)',
      cta: '(생성 대기 중)',
      scenes: [],
    };

    // 4. Placeholder 저장
    const scriptPath = jobManager.getTempPath(
      jobId,
      `${scriptId}.json`,
    );
    writeFileSync(scriptPath, JSON.stringify(placeholderScript, null, 2));

    return placeholderScript;
  } catch (err) {
    // 실패 이벤트 발행
    emitEvent({
      jobId,
      eventType: 'SCRIPT_FAILED',
      actor: 'system',
      fromStatus: 'scripting',
      toStatus: 'script_failed',
      reasonCode: 'generation_error',
      reasonDetail: err instanceof Error ? err.message : 'Unknown error',
    });

    jobManager.transitionJob(jobId, 'script_failed', {
      eventType: 'SCRIPT_FAILED',
      actor: 'system',
      reasonCode: 'generation_error',
      reasonDetail:
        err instanceof Error ? err.message : 'Unknown error in script generation',
    });

    throw err;
  }
}

/**
 * 대본 생성 완료 처리
 * Claude에서 생성한 대본을 수신, 유사도/건강 검증 실행
 * @param jobId - Job ID
 * @param scriptData - Claude에서 생성한 script 데이터 (JSON)
 * @param projectDir - 프로젝트 디렉토리
 * @returns 검증 완료된 GeneratedScript
 */
export async function onScriptGenerated(
  jobId: string,
  scriptData: unknown,
  projectDir: string,
): Promise<GeneratedScript> {
  const jobManager = new JobManager(projectDir);
  const job = jobManager.getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);

  // scriptData를 GeneratedScript로 변환
  const script = scriptData as GeneratedScript;
  script.jobId = jobId;
  script.version = 1;

  try {
    // 1. 선택된 reference 조회 (임시: 파일에서 읽기)
    const refPath = jobManager.getTempPath(jobId, 'reference.json');
    const reference: ReferenceVideo = JSON.parse(
      readFileSync(refPath, 'utf-8'),
    );

    // 2. 유사도 검증
    const similarityCheck = runSimilarityCheck(reference, script);
    script.similarityCheck = similarityCheck;

    emitEvent({
      jobId,
      eventType: 'SIMILARITY_CHECK_COMPLETED',
      actor: 'system',
      fromStatus: null,
      toStatus: null,
      metadata: { risk: similarityCheck.overallRisk },
    });

    // 3. 건강 규정 검사 (health 콘텐츠만)
    if (job.contentType === 'health') {
      const complianceResult = runHealthCheck(script, projectDir);
      if (complianceResult) {
        // HealthComplianceAudit 구성
        const audit: HealthComplianceAudit = {
          totalSentences: complianceResult.violations.reduce(
            (acc, v) => acc + 1,
            0,
          ),
          levelCounts: {},
          violations: complianceResult.violations,
          autoFixes: complianceResult.autoFixes,
          disclaimerInserted: false,
        };

        // 자동 수정 적용
        if (complianceResult.autoFixes.length > 0) {
          const fixedScript = applyAutoFixes(script, complianceResult.autoFixes);
          Object.assign(script, fixedScript);

          emitEvent({
            jobId,
            eventType: 'HEALTH_COMPLIANCE_AUTOFIX',
            actor: 'system',
            fromStatus: null,
            toStatus: null,
            metadata: { fixCount: complianceResult.autoFixes.length },
          });
        }

        script.healthCompliance = audit;

        // 면책 문구 추가 (필요시)
        if (complianceResult.violations.length > 0) {
          const disclaimers = getDisclaimers(projectDir);
          audit.disclaimerInserted = true;
          // 마지막 씬에 면책 문구 추가
          if (script.scenes.length > 0) {
            const lastScene = script.scenes[script.scenes.length - 1];
            lastScene.narration += ` ${disclaimers.medical?.narration || ''}`;
          }
        }
      }
    }

    // 4. 대본 저장
    const scriptPath = jobManager.getTempPath(jobId, `${script.scriptId}.json`);
    writeFileSync(scriptPath, JSON.stringify(script, null, 2));

    // 5. 상태 전이 + 이벤트
    jobManager.transitionJob(jobId, 'script_pending_approval', {
      eventType: 'SCRIPT_GENERATED',
      actor: 'system',
      targetId: script.scriptId,
    });

    return script;
  } catch (err) {
    emitEvent({
      jobId,
      eventType: 'SCRIPT_FAILED',
      actor: 'system',
      fromStatus: 'scripting',
      toStatus: 'script_failed',
      reasonCode: 'validation_error',
      reasonDetail: err instanceof Error ? err.message : 'Unknown error',
    });

    jobManager.transitionJob(jobId, 'script_failed', {
      eventType: 'SCRIPT_FAILED',
      actor: 'system',
      reasonCode: 'validation_error',
      reasonDetail:
        err instanceof Error ? err.message : 'Unknown error in validation',
    });

    throw err;
  }
}

/**
 * 대본 승인 처리
 * 사용자가 대본을 승인하면 script_approved 상태로 전이
 * @param jobId - Job ID
 * @param projectDir - 프로젝트 디렉토리
 */
export function onScriptApproved(
  jobId: string,
  projectDir: string,
): void {
  const jobManager = new JobManager(projectDir);

  try {
    jobManager.transitionJob(jobId, 'script_approved', {
      eventType: 'SCRIPT_APPROVED',
      actor: 'user',
      fromStatus: 'script_pending_approval',
      toStatus: 'script_approved',
    });
  } catch (err) {
    console.error(`Failed to approve script for job ${jobId}:`, err);
    throw err;
  }
}

/**
 * 대본 수정 요청 처리
 * 사용자가 수정을 요청하면 scripting 상태로 돌아감
 * @param jobId - Job ID
 * @param feedback - 사용자 피드백 (수정 요청 사항)
 * @param projectDir - 프로젝트 디렉토리
 */
export function onScriptRevisionRequested(
  jobId: string,
  feedback: string,
  projectDir: string,
): void {
  const jobManager = new JobManager(projectDir);

  try {
    jobManager.transitionJob(jobId, 'scripting', {
      eventType: 'SCRIPT_REVISION_REQUESTED',
      actor: 'user',
      fromStatus: 'script_pending_approval',
      toStatus: 'scripting',
      reasonDetail: feedback,
    });

    // 피드백 저장
    const feedbackPath = jobManager.getTempPath(jobId, 'revision_feedback.txt');
    writeFileSync(
      feedbackPath,
      `[${new Date().toISOString()}]\n${feedback}`,
      'utf-8',
    );
  } catch (err) {
    console.error(`Failed to request revision for job ${jobId}:`, err);
    throw err;
  }
}

/**
 * 저장된 script 조회
 * @param jobId - Job ID
 * @param scriptId - Script ID
 * @param projectDir - 프로젝트 디렉토리
 * @returns GeneratedScript 또는 null
 */
export function getScript(
  jobId: string,
  scriptId: string,
  projectDir: string,
): GeneratedScript | null {
  const jobManager = new JobManager(projectDir);
  const scriptPath = jobManager.getTempPath(jobId, `${scriptId}.json`);

  try {
    const data = readFileSync(scriptPath, 'utf-8');
    return JSON.parse(data) as GeneratedScript;
  } catch {
    return null;
  }
}
