/**
 * 가이드라인 관련 명령어 핸들러
 * 
 * @module commands/guidelineCommand
 * @version 3.0.0
 */

import path from 'path';
import { GuidelineExtractor } from '../core/guidelineExtractor.js';
import { VectorClient } from '../clients/vectorClient.js';
import { loadData, saveJsonData } from '../utils/fileUtils.js';
import logger from '../utils/loggerUtils.js';

/**
 * PDF/DOCX에서 가이드라인 규칙 추출
 * 
 * @param {Object} options - CLI 옵션
 * @param {string} options.input - 입력 파일 (PDF/DOCX)
 * @param {string} options.output - 출력 JSON 파일
 */
export async function extractGuidelines(options) {
  logger.info('=== 가이드라인 추출 ===');
  logger.info(`입력: ${options.input}`);
  logger.info(`출력: ${options.output}`);

  const ext = path.extname(options.input).toLowerCase();
  if (!['.pdf', '.docx'].includes(ext)) {
    logger.error('PDF 또는 DOCX만 지원합니다.');
    return;
  }

  const extractor = new GuidelineExtractor();
  await extractor.initialize();

  const documentPath = path.resolve('document', 'development_guide', options.input);
  const guidelines = await extractor.extractFromFile(documentPath);
  logger.info(`추출 완료: ${guidelines.length}개 규칙`);

  // 통계
  const stats = {};
  guidelines.contextRules.forEach(g => {
    stats[g.category] = (stats[g.category] || 0) + 1;
  });
  guidelines.guidelines.forEach(g => {
    stats[g.category] = (stats[g.category] || 0) + 1;
  });
  
  logger.info('\n카테고리별:');
  Object.entries(stats).forEach(([k, v]) => logger.info(`  - ${k}: ${v}개`));

  await saveJsonData({
    source: options.input,
    extractedAt: new Date().toISOString(),
    guidelines
  }, options.output, 'rule');

  logger.info(`저장 완료: ${options.output}`);
  logger.info('=== 추출 완료 ===');
}

/**
 * 가이드라인 JSON을 VectorDB에 저장
 * 
 * @param {Object} options - CLI 옵션
 * @param {string} options.input - 가이드라인 JSON 파일
 * @param {boolean} [options.dryRun] - 미리보기 모드
 */
export async function importGuidelines(options) {
  logger.info('=== 가이드라인 Import ===');
  logger.info(`입력: ${options.input}`);

  const data = await loadData(options.input, 'rule');
  const guidelines = Array.isArray(data) ? data : data.guidelines || [];

  logger.info(`로드 완료: ${guidelines.length}개`);

  // 통계
  const stats = {};
  guidelines.forEach(g => {
    stats[g.category] = (stats[g.category] || 0) + 1;
  });

  logger.info('\n카테고리별:');
  Object.entries(stats).forEach(([k, v]) => logger.info(`  - ${k}: ${v}개`));

  if (options.dryRun) {
    logger.info('\nDry-run 모드: 저장 건너뜀');
    return;
  }

  const vectorClient = new VectorClient();
  await vectorClient.checkConnection();

  let success = 0;
  for (const guideline of guidelines) {
    try {
      await vectorClient.upsertGuideline(guideline);
      success++;
    } catch (error) {
      logger.warn(`저장 실패 (${guideline.ruleId}): ${error.message}`);
    }
  }

  logger.info(`\n저장 완료: ${success}/${guidelines.length}개`);
  logger.info('=== Import 완료 ===');
}