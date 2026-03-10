/**
 * Production Log 관리
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ContentType } from '../types/config.js';
import type { ProductionLog, ProductionLogEntry } from '../types/job.js';

export class ProductionLogger {
  private log: ProductionLog;
  private filePath: string;

  constructor(jobId: string, keyword: string, contentType: ContentType, outputDir: string) {
    this.filePath = join(outputDir, 'script', 'production_log.json');
    this.log = {
      jobId,
      keyword,
      contentType,
      timeline: [],
      stats: {
        totalScenes: 0,
        imageRegenerations: 0,
        videoRegenerations: 0,
        finalDurationSec: 0,
        fileCount: 0,
        packageSizeMb: 0,
      },
    };
  }

  addEntry(step: string, extra?: Record<string, unknown>): void {
    const entry: ProductionLogEntry = {
      step,
      at: new Date().toISOString(),
      ...extra,
    };
    this.log.timeline.push(entry);
    this.save();
  }

  updateStats(partial: Partial<ProductionLog['stats']>): void {
    Object.assign(this.log.stats, partial);
    this.save();
  }

  getLog(): ProductionLog {
    return { ...this.log };
  }

  private save(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.filePath, JSON.stringify(this.log, null, 2), 'utf-8');
  }

  static load(filePath: string): ProductionLog | null {
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  }
}
