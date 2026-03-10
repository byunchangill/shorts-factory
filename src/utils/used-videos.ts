/**
 * 사용 영상 배제 관리
 * config/used_videos.json CRUD
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { UsedVideoEntry, UsedVideosStore, UsedVideoStatus } from '../types/job.js';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;

export class UsedVideosManager {
  private store: UsedVideosStore;
  private filePath: string;

  constructor(projectDir: string) {
    this.filePath = join(projectDir, 'config', 'used_videos.json');
    this.store = this.load();
  }

  private load(): UsedVideosStore {
    if (!existsSync(this.filePath)) {
      return { videos: {}, stats: { totalSelected: 0, totalPresented: 0, lastCleanupAt: null } };
    }
    return JSON.parse(readFileSync(this.filePath, 'utf-8'));
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.store, null, 2), 'utf-8');
  }

  /**
   * 배제 대상 videoId 목록 추출
   * - selected_for_homage: 영구 배제
   * - presented_not_selected: 7일 미만만 배제
   */
  getExcludedVideoIds(): string[] {
    const now = Date.now();
    const excluded: string[] = [];

    for (const [videoId, entry] of Object.entries(this.store.videos)) {
      if (entry.usageType === 'selected_for_homage') {
        excluded.push(videoId);
      } else if (entry.usageType === 'presented_not_selected') {
        if (entry.expiresAt && new Date(entry.expiresAt).getTime() > now) {
          excluded.push(videoId);
        }
      }
    }

    return excluded;
  }

  /**
   * 영상 기록 upsert
   * - videoId가 unique key
   * - selected_for_homage로 이미 등록된 건 다운그레이드 안 함
   */
  upsertVideo(
    videoId: string,
    title: string,
    channelName: string,
    jobId: string,
    usageType: UsedVideoStatus,
  ): void {
    const existing = this.store.videos[videoId];

    // 이미 selected_for_homage인 경우 presented_not_selected로 다운그레이드 방지
    if (existing?.usageType === 'selected_for_homage' && usageType === 'presented_not_selected') {
      return;
    }

    const now = new Date().toISOString();
    const entry: UsedVideoEntry = {
      videoId,
      title,
      channelName,
      usageType,
      jobId,
      presentedAt: existing?.presentedAt ?? now,
      selectedAt: usageType === 'selected_for_homage' ? now : existing?.selectedAt,
      expiresAt: usageType === 'presented_not_selected'
        ? new Date(Date.now() + SEVEN_DAYS_MS).toISOString()
        : undefined,
    };

    this.store.videos[videoId] = entry;

    // stats 업데이트
    if (usageType === 'selected_for_homage' && existing?.usageType !== 'selected_for_homage') {
      this.store.stats.totalSelected++;
    }
    if (!existing) {
      this.store.stats.totalPresented++;
    }

    this.save();
  }

  /**
   * 선택 확정 시 영구 배제로 승격
   */
  markAsSelected(videoId: string, jobId: string): void {
    const entry = this.store.videos[videoId];
    if (!entry) {
      throw new Error(`Video not found in used_videos: ${videoId}`);
    }

    entry.usageType = 'selected_for_homage';
    entry.selectedAt = new Date().toISOString();
    entry.expiresAt = undefined; // 영구
    entry.jobId = jobId;

    if (entry.usageType !== 'selected_for_homage') {
      this.store.stats.totalSelected++;
    }

    this.save();
  }

  /**
   * 오래된 presented_not_selected 자동 정리 (6개월+)
   */
  cleanup(): number {
    const now = Date.now();
    let removed = 0;

    for (const [videoId, entry] of Object.entries(this.store.videos)) {
      if (entry.usageType === 'presented_not_selected') {
        const presentedAt = new Date(entry.presentedAt).getTime();
        if (now - presentedAt > SIX_MONTHS_MS) {
          delete this.store.videos[videoId];
          removed++;
        }
      }
    }

    this.store.stats.lastCleanupAt = new Date().toISOString();
    this.save();
    return removed;
  }

  /**
   * 현재 배제 목록 조회
   */
  getExcludedList(): UsedVideoEntry[] {
    const excludedIds = this.getExcludedVideoIds();
    return excludedIds.map(id => this.store.videos[id]).filter(Boolean);
  }

  /**
   * 전체 리셋
   */
  reset(): void {
    this.store = { videos: {}, stats: { totalSelected: 0, totalPresented: 0, lastCleanupAt: null } };
    this.save();
  }

  getStats() {
    return { ...this.store.stats };
  }
}
