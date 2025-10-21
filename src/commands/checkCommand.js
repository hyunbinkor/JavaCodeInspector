/**
 * 통합 코드 품질 검사 명령어
 */

import fs from 'fs/promises';
import path from 'path';
import { UnifiedJavaCodeChecker } from '../core/unifiedCodeChecker.js';
import { buildOptimizedReport } from '../services/reportGeneratorService.js';
import { displayUnifiedResults } from '../utils/displayUtils.js';

/**
 * 통합 코드 품질 검사 수행
 * 1. UnifiedJavaCodeChecker 초기화
 * 2. 검사 옵션에 따라 가이드라인, 맥락 검사, 패턴 분석 수행
 * 3. 결과를 우선순위화하여 통합 리포트 생성
 * 4. 옵션에 따라 최적화된 JSON 리포트 저장
 */
export async function performUnifiedCheck(options) {
  if (!options.code) {
    console.error('검사할 코드 파일을 지정해주세요: -c <file>');
    return;
  }

  console.log('=== 통합 Java 코드 품질 검사 시작 ===');
  console.log(`대상 파일: ${options.code}`);

  const sourceCode = await fs.readFile(options.code, 'utf-8');
  const fileName = path.basename(options.code);

  // 통합 검사기 초기화 (AST 파서, 가이드라인 체커, VectorDB 등)
  const unifiedChecker = new UnifiedJavaCodeChecker();
  await unifiedChecker.initialize();

  // 검사 범위 설정
  const checkOptions = {
    skipPatterns: options.skipPatterns,
    skipGuidelines: options.skipGuidelines,
    skipContextual: options.skipContextual,
    generateRecommendations: true,
    generateFixes: options.generateFixes,
    patternLimit: parseInt(options.limit)
  };

  console.log('\n검사 범위:');
  console.log(`- 개발가이드 검사: ${!checkOptions.skipGuidelines ? 'O' : 'X'}`);
  console.log(`- 맥락적 가이드라인: ${!checkOptions.skipContextual ? 'O' : 'X'}`);
  console.log(`- 패턴 분석: ${!checkOptions.skipPatterns ? 'O' : 'X'}`);
  console.log(`- 자동 수정안: ${checkOptions.generateFixes ? 'O' : 'X'}`);

  // AST 파싱 → 가이드라인 검사 → 패턴 검색 → 결과 통합 및 우선순위화
  const unifiedResults = await unifiedChecker.analyzeCode(sourceCode, checkOptions);

  // 콘솔에 결과 출력 (심각도별 통계, 주요 이슈, 권장사항 등)
  displayUnifiedResults(unifiedResults, fileName);

  // 최적화된 리포트를 JSON으로 저장 (메타데이터, 요약, 상위 이슈만 포함)
  if (options.output) {
    const optimizedReport = buildOptimizedReport(
      unifiedResults,
      fileName,
      options.code,
      sourceCode,
      checkOptions
    );

    await fs.writeFile(options.output, JSON.stringify(optimizedReport, null, 2), 'utf-8');
    console.log(`\n결과 저장: ${options.output}`);
    console.log(`파일 크기: ${(JSON.stringify(optimizedReport).length / 1024).toFixed(2)} KB`);
  }

  console.log('\n=== 통합 검사 완료 ===');
}