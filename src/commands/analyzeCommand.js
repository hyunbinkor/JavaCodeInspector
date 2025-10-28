import { PatternDatasetGenerator } from '../core/patternGenerator.js';
import { loadData, saveJsonData } from '../utils/fileUtils.js';
import logger from '../utils/loggerUtils.js';

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