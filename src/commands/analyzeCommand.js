/**
 * 단일 이슈 분석 및 패턴 데이터셋 생성 명령어
 */

import { PatternDatasetGenerator } from '../core/patternGenerator.js';
import { loadIssueData, savePatternDataset } from '../utils/fileUtils.js';

/**
 * 단일 이슈 분석 및 패턴 데이터셋 생성
 * 1. JSON 파일에서 이슈 데이터 로드
 * 2. PatternDatasetGenerator로 코드 임베딩 생성
 * 3. 품질 검증 수행
 * 4. 패턴 데이터셋 JSON으로 저장
 */
export async function processSingleIssue(options) {
  if (!options.input) {
    console.error('입력 파일을 지정해주세요: -i <file>');
    return;
  }

  console.log('단일 이슈 분석 시작');
  console.log(`입력 파일: ${options.input}`);

  const issueData = await loadIssueData(options.input);
  const generator = new PatternDatasetGenerator();
  await generator.initialize();

  // 문제 코드와 권장 패턴의 임베딩 생성 및 메타데이터 구성
  const patternDataset = await generator.generatePatternDataset(issueData);

  if (options.output) {
    await savePatternDataset(patternDataset, options.output);
    console.log(`결과 저장: ${options.output}`);
  } else {
    console.log('\n생성된 패턴 데이터셋:');
    console.log(JSON.stringify(patternDataset, null, 2));
  }

  console.log(`분석 완료: ${patternDataset.issue_record_id}`);
  console.log(`품질 점수: ${patternDataset.validation_info.quality_score.toFixed(2)}`);
}