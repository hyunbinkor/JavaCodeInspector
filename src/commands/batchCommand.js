import path from 'path';
import { PatternDatasetGenerator } from '../core/patternGenerator.js';
import { getJsonFiles, loadData, saveJsonData } from '../utils/fileUtils.js';
import logger from '../utils/loggerUtils.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * 배치 이슈 처리
 * 
 * 내부 흐름:
 * 1. 입력 디렉토리의 모든 JSON 파일 스캔
 * 2. 각 파일에 대해 processSingleIssue() 로직 반복 실행
 * 3. PatternDatasetGenerator로 배치 패턴 생성
 * 4. 생성된 패턴들을 출력 디렉토리에 저장
 */
export async function processBatchIssues(options) {

  logger.info('배치 처리 시작');
  logger.info(`입력 디렉토리: ${process.env.SAMPLE_CODE_DIRECTORY}`);

  const issueFiles = await getJsonFiles(process.env.SAMPLE_CODE_DIRECTORY);
  logger.info(`발견된 이슈 파일: ${issueFiles.length}개`);

  if (issueFiles.length === 0) {
    logger.info('처리할 이슈 파일이 없습니다.');
    return;
  }

  const generator = new PatternDatasetGenerator();
  await generator.initialize();

  const results = [];
  const errors = [];

  // 각 JSON 파일을 순회하며 패턴 데이터셋 생성
  for (let i = 0; i < issueFiles.length; i++) {
    const filePath = issueFiles[i];
    const fileName = path.basename(filePath);

    try {
      logger.info(`\n처리 중 (${i + 1}/${issueFiles.length}): ${fileName}`);

      const issueData = await loadData(filePath, 'issueRaw');
      const patternDataset = await generator.generatePatternDataset(issueData);

      results.push(patternDataset);

      if (options.output) {
        const outputPath = path.join(options.output, `pattern_${patternDataset.issue_record_id}.json`);
        await saveJsonData(patternDataset, outputPath, 'issuePattern');
      }

      logger.info(`  완료: ${patternDataset.issue_record_id} (품질: ${patternDataset.validation_info.quality_score.toFixed(2)})`);

    } catch (error) {
      logger.error(`  실패: ${fileName} - ${error.message}`);
      errors.push({ file: fileName, error: error.message });
    }
  }

  // 배치 처리 결과 통계 출력
  logger.info('\n배치 처리 결과 요약:');
  logger.info(`성공: ${results.length}개`);
  logger.info(`실패: ${errors.length}개`);

  if (results.length > 0) {
    const avgQuality = results.reduce((sum, r) => sum + r.validation_info.quality_score, 0) / results.length;
    logger.info(`평균 품질 점수: ${avgQuality.toFixed(2)}`);
  }

  if (errors.length > 0) {
    logger.info('\n실패한 파일들:');
    errors.forEach(({ file, error }) => {
      logger.info(`  - ${file}: ${error}`);
    });
  }
}