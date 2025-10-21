/**
 * 배치 이슈 처리 명령어
 */

import path from 'path';
import { PatternDatasetGenerator } from '../core/patternGenerator.js';
import { loadIssueData, savePatternDataset, getJsonFiles } from '../utils/fileUtils.js';

/**
 * 배치 이슈 처리
 * 1. 디렉토리 내 모든 JSON 파일 탐색
 * 2. 각 파일에 대해 패턴 데이터셋 생성
 * 3. 성공/실패 결과 집계 및 평균 품질 점수 계산
 */
export async function processBatchIssues(options) {
  if (!options.input) {
    console.error('입력 디렉토리를 지정해주세요: -i <dir>');
    return;
  }

  console.log('배치 처리 시작');
  console.log(`입력 디렉토리: ${options.input}`);

  const issueFiles = await getJsonFiles(options.input);
  console.log(`발견된 이슈 파일: ${issueFiles.length}개`);

  if (issueFiles.length === 0) {
    console.log('처리할 이슈 파일이 없습니다.');
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
      console.log(`\n처리 중 (${i + 1}/${issueFiles.length}): ${fileName}`);

      const issueData = await loadIssueData(filePath);
      const patternDataset = await generator.generatePatternDataset(issueData);

      results.push(patternDataset);

      if (options.output) {
        const outputPath = path.join(options.output, `pattern_${patternDataset.issue_record_id}.json`);
        await savePatternDataset(patternDataset, outputPath);
      }

      console.log(`  완료: ${patternDataset.issue_record_id} (품질: ${patternDataset.validation_info.quality_score.toFixed(2)})`);

    } catch (error) {
      console.error(`  실패: ${fileName} - ${error.message}`);
      errors.push({ file: fileName, error: error.message });
    }
  }

  // 배치 처리 결과 통계 출력
  console.log('\n배치 처리 결과 요약:');
  console.log(`성공: ${results.length}개`);
  console.log(`실패: ${errors.length}개`);

  if (results.length > 0) {
    const avgQuality = results.reduce((sum, r) => sum + r.validation_info.quality_score, 0) / results.length;
    console.log(`평균 품질 점수: ${avgQuality.toFixed(2)}`);
  }

  if (errors.length > 0) {
    console.log('\n실패한 파일들:');
    errors.forEach(({ file, error }) => {
      console.log(`  - ${file}: ${error}`);
    });
  }
}