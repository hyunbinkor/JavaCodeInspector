import path from 'path';
import dotenv from 'dotenv';
import logger from '../utils/loggerUtils.js';
import { PatternDatasetGenerator } from '../core/patternGenerator.js';
import { getJsonFiles, loadData, saveJsonData } from '../utils/fileUtils.js';

dotenv.config();

/**
 * 단일 이슈 분석 및 패턴 데이터셋 생성
 * 
 * 내부 흐름:
 * 1. 입력 JSON 파일에서 이슈 정보 로드
 * 2. IssueCodeAnalyzer로 이슈 코드 분석
 * 3. PatternDatasetGenerator로 패턴 데이터셋 생성
 * 4. CodeEmbeddingGenerator로 벡터 생성
 * 5. 생성된 패턴을 JSON 파일로 저장
 */
export async function processSingleIssue(options) {
  if (!options.input) {
    logger.error('입력 파일을 지정해주세요: -i <file>');
    return;
  }

  logger.info('단일 이슈 분석 시작');
  logger.info(`입력 파일: ${options.input}`);

  const issueData = await loadData(options.input, 'issueRaw');
  const generator = new PatternDatasetGenerator();
  await generator.initialize();

  // 문제 코드와 권장 패턴의 임베딩 생성 및 메타데이터 구성
  const patternDataset = await generator.generatePatternDataset(issueData);

  if (options.output) {
    await saveJsonData(patternDataset, options.output, 'issuePattern');
    logger.info(`결과 저장: ${options.output}`);
  } else {
    logger.info('\n생성된 패턴 데이터셋:');
    logger.info(JSON.stringify(patternDataset, null, 2));
  }

  logger.info(`분석 완료: ${patternDataset.issue_record_id}`);
  logger.info(`품질 점수: ${patternDataset.validation_info.quality_score.toFixed(2)}`);
}

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
  logger.info(`입력 디렉토리: ${process.env.ISSUE_RAW_DIRECTORY}`);

  const issueFiles = await getJsonFiles(process.env.ISSUE_RAW_DIRECTORY);
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

      const issueData = await loadData(fileName, 'issueRaw');
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