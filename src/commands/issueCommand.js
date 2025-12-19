/**
 * 이슈 배치 처리 명령어 핸들러
 * 
 * @module commands/issueCommand
 * @version 3.0.0
 */

import path from 'path';
import dotenv from 'dotenv';
import { PatternDatasetGenerator } from '../core/patternGenerator.js';
import { VectorClient } from '../clients/vectorClient.js';
import { getJsonFiles, loadData, saveJsonData } from '../utils/fileUtils.js';
import logger from '../utils/loggerUtils.js';

dotenv.config();

/**
 * 이슈 데이터를 배치 처리하여 VectorDB에 저장
 * 
 * @param {Object} options - CLI 옵션
 * @param {string} [options.input] - 입력 디렉토리
 * @param {string} [options.output] - 패턴 JSON 저장 디렉토리
 * @param {boolean} [options.clear] - DB 초기화 여부
 */
export async function processBatchIssues(options) {
  const inputDir = options.input || process.env.ISSUE_RAW_DIRECTORY;

  logger.info('=== 배치 처리 시작 ===');
  logger.info(`입력: ${inputDir}`);
  if (options.output) logger.info(`출력: ${options.output}`);

  const files = await getJsonFiles(inputDir);
  logger.info(`파일 수: ${files.length}개`);

  if (files.length === 0) {
    logger.info('처리할 파일 없음');
    return;
  }

  const generator = new PatternDatasetGenerator();
  await generator.initialize();

  const vectorClient = new VectorClient();

  // DB 초기화 (옵션)
  if (options.clear) {
    logger.info('VectorDB 초기화 중...');
    await vectorClient.clearAllPatterns();
  }

  const results = [];
  const errors = [];

  for (let i = 0; i < files.length; i++) {
    const fileName = path.basename(files[i]);
    logger.info(`처리 중 (${i + 1}/${files.length}): ${fileName}`);

    try {
      const issueData = await loadData(fileName, 'issueRaw');
      const pattern = await generator.generatePatternDataset(issueData);
      results.push(pattern);

      if (options.output) {
        await saveJsonData(pattern, `pattern_${pattern.issue_record_id}.json`, 'issuePattern');
      }

      await vectorClient.storePattern(pattern);
      logger.info(`  ✅ ${pattern.issue_record_id}`);
    } catch (error) {
      logger.error(`  ❌ ${fileName}: ${error.message}`);
      errors.push({ file: fileName, error: error.message });
    }
  }

  logger.info('\n=== 결과 ===');
  logger.info(`성공: ${results.length}개`);
  logger.info(`실패: ${errors.length}개`);

  logger.info('=== 배치 처리 완료 ===');
}