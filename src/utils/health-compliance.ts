/**
 * Health Compliance — 금지 표현 검사 + 자동 재작성
 * data-models-v6.md Fix #3, Fix #4 기반
 * config/health_compliance.json 연동
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchExactKeyword, extractKoreanVerbStem } from './korean-utils.js';
import type { ComplianceViolation, AutoFix } from '../types/job.js';

// ── 타입 정의 ──
interface RewriteConfig {
  strategy: 'full_sentence_replace' | 'verb_stem_rewrite' | 'keyword_swap' | 'fallback';
  template?: string;
  fallback?: string | null;
  stemRule?: string;
  replacements?: Record<string, string>;
}

interface DetectConfig {
  templates: string[];
}

interface ProhibitedPhraseRule {
  matchType: 'exact_keyword' | 'contains_keyword' | 'template';
  keywords?: string[];
  detect?: DetectConfig;
  rewrite: RewriteConfig;
  severity: 'critical' | 'high' | 'medium';
  action: string;
}

interface HealthComplianceConfig {
  version: string;
  claimLevels: Record<string, unknown>;
  prohibitedPhrases: Record<string, ProhibitedPhraseRule>;
  matchTypeDefinitions: Record<string, unknown>;
  rewriteStrategies: Record<string, string>;
  sourceCredibility: Record<string, unknown>;
  disclaimers: Record<string, { narration?: string; text?: string; position: string }>;
  auditActions: Record<string, string>;
}

// ── 설정 로드 ──
let cachedConfig: HealthComplianceConfig | null = null;

export function loadComplianceConfig(projectDir: string): HealthComplianceConfig {
  if (cachedConfig) return cachedConfig;
  const filePath = join(projectDir, 'config', 'health_compliance.json');
  cachedConfig = JSON.parse(readFileSync(filePath, 'utf-8'));
  return cachedConfig!;
}

// ── Template 매칭 ──
interface TemplateMatchResult {
  matched: boolean;
  captures: Record<string, string>;
  templateUsed: string;
}

function matchTemplate(sentence: string, templates: string[]): TemplateMatchResult {
  for (const tpl of templates) {
    // ${var}을 non-greedy (.+?) 캡처 그룹으로 변환
    const varNames: string[] = [];
    let regexStr = tpl.replace(/\$\{(\w+)\}/g, (_match, varName) => {
      varNames.push(varName);
      return '(.+?)';
    });
    // 특수문자 이스케이프 ($ { } 이외)
    regexStr = regexStr.replace(/([.?+^$[\]\\(){}|])/g, '\\$1');
    // 다시 캡처 그룹 복원 (이스케이프된 것 원래대로)
    // 위에서 이미 replace 했으므로 원본 유지

    try {
      // 더 간단한 접근: 원본 템플릿에서 직접 regex 생성
      let pattern = '';
      let lastIdx = 0;
      const varRegex = /\$\{(\w+)\}/g;
      let match;
      const names: string[] = [];

      while ((match = varRegex.exec(tpl)) !== null) {
        // match 이전 텍스트를 이스케이프
        const before = tpl.slice(lastIdx, match.index);
        pattern += escapeRegex(before);
        pattern += '(.+?)';
        names.push(match[1]);
        lastIdx = match.index + match[0].length;
      }
      pattern += escapeRegex(tpl.slice(lastIdx));

      const regex = new RegExp(pattern);
      const result = regex.exec(sentence);
      if (result) {
        const captures: Record<string, string> = {};
        names.forEach((name, i) => {
          captures[name] = result[i + 1];
        });
        return { matched: true, captures, templateUsed: tpl };
      }
    } catch {
      continue;
    }
  }
  return { matched: false, captures: {}, templateUsed: '' };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── 문장 재작성 ──
export function rewriteSentence(
  sentence: string,
  violation: ComplianceViolation,
  rule: ProhibitedPhraseRule,
): string {
  const rewrite = rule.rewrite;

  switch (rewrite.strategy) {
    case 'full_sentence_replace': {
      let result = rewrite.template ?? '';
      if (violation.matchDetail?.captures) {
        for (const [key, val] of Object.entries(violation.matchDetail.captures)) {
          result = result.replace(`\${${key}}`, val);
        }
      }
      // 결과가 자연스러운지 간단 체크 (한글 2음절 이상 포함)
      const koreanCount = (result.match(/[가-힣]/g) || []).length;
      return koreanCount >= 4 ? result : (rewrite.fallback ?? sentence);
    }

    case 'verb_stem_rewrite': {
      const action = violation.matchDetail?.captures?.action;
      if (!action) return rewrite.fallback ?? sentence;

      const stem = extractKoreanVerbStem(action);
      if (!stem) return rewrite.fallback ?? sentence;

      const result = (rewrite.template ?? '').replace('${action_stem}', stem);
      // "먹하는 것을..." 같은 부자연스러운 결과 체크
      if (result.includes('먹하') || result.includes('먹는') === false && stem.length === 1) {
        return rewrite.fallback ?? sentence;
      }
      return result;
    }

    case 'keyword_swap': {
      const replacements = rewrite.replacements ?? {};
      let result = sentence;
      for (const [from, to] of Object.entries(replacements)) {
        if (sentence.includes(from)) {
          result = result.replace(from, to);
          break;
        }
      }
      return result;
    }

    default:
      return rewrite.fallback ?? sentence;
  }
}

// ── 메인 검사 함수 ──
export interface ComplianceResult {
  violations: ComplianceViolation[];
  autoFixes: AutoFix[];
  isClean: boolean;
}

export function checkSentence(
  sentence: string,
  sceneId: string,
  config: HealthComplianceConfig,
): ComplianceResult {
  const violations: ComplianceViolation[] = [];
  const autoFixes: AutoFix[] = [];

  for (const [ruleId, rule] of Object.entries(config.prohibitedPhrases)) {
    let matched = false;
    let matchDetail: ComplianceViolation['matchDetail'];

    switch (rule.matchType) {
      case 'contains_keyword': {
        for (const kw of rule.keywords ?? []) {
          if (sentence.includes(kw)) {
            matched = true;
            matchDetail = { matchType: 'contains_keyword', matched: kw };
            break;
          }
        }
        break;
      }

      case 'exact_keyword': {
        for (const kw of rule.keywords ?? []) {
          if (matchExactKeyword(sentence, kw)) {
            matched = true;
            matchDetail = { matchType: 'exact_keyword', matched: kw };
            break;
          }
        }
        break;
      }

      case 'template': {
        if (rule.detect?.templates) {
          const result = matchTemplate(sentence, rule.detect.templates);
          if (result.matched) {
            matched = true;
            matchDetail = {
              matchType: 'template',
              matched: result.templateUsed,
              captures: result.captures,
            };
          }
        }
        break;
      }
    }

    if (matched) {
      const violation: ComplianceViolation = {
        sceneId,
        sentence,
        ruleId,
        severity: rule.severity,
        matchDetail,
      };
      violations.push(violation);

      // 자동 재작성 시도
      if (rule.action !== 'block' || rule.rewrite.fallback !== null) {
        const rewritten = rewriteSentence(sentence, violation, rule);
        if (rewritten !== sentence) {
          autoFixes.push({
            sceneId,
            original: sentence,
            rewritten,
            ruleId,
            strategy: rule.rewrite.strategy,
          });
        }
      }
    }
  }

  return {
    violations,
    autoFixes,
    isClean: violations.length === 0,
  };
}

/**
 * 전체 대본 검사
 */
export function checkScript(
  scenes: Array<{ sceneId: string; narration: string }>,
  projectDir: string,
): ComplianceResult {
  const config = loadComplianceConfig(projectDir);
  const allViolations: ComplianceViolation[] = [];
  const allAutoFixes: AutoFix[] = [];

  for (const scene of scenes) {
    // 나레이션을 문장 단위로 분리
    const sentences = scene.narration.split(/(?<=[.!?。])\s*/).filter(s => s.trim());

    for (const sentence of sentences) {
      const result = checkSentence(sentence, scene.sceneId, config);
      allViolations.push(...result.violations);
      allAutoFixes.push(...result.autoFixes);
    }
  }

  return {
    violations: allViolations,
    autoFixes: allAutoFixes,
    isClean: allViolations.length === 0,
  };
}

/**
 * 면책 문구 조회
 */
export function getDisclaimers(projectDir: string) {
  const config = loadComplianceConfig(projectDir);
  return config.disclaimers;
}
