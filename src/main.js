#!/usr/bin/env node

import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import { UnifiedJavaCodeChecker } from './core/unifiedCodeChecker.js';
import { PatternDatasetGenerator } from './core/patternGenerator.js';
import { WeaviateClient } from './clients/weaviateClient.js';
import { issueCodeAnalyzer as IssueCodeAnalyzer } from './core/issueCodeAnalyzer.js';
import { GuidelineExtractor } from './core/guidelineExtractor.js';
import { LLMService } from './clients/llmService.js';
import { pathToFileURL } from 'url';

const program = new Command();

// CLI 프로그램 기본 정보 설정
program
  .name('unified-code-analyzer')
  .description('통합 Java 코드 품질 검사 도구 (패턴 분석 + 개발가이드 검사)')
  .version('2.0.0');

// 통합 코드 품질 검사 명령어
// 패턴 분석과 가이드라인 검사를 동시에 수행하며 종합 리포트 생성
program
  .command('check')
  .description('통합 Java 코드 품질 검사 (추천)')
  .option('-c, --code <file>', '검사할 Java 코드 파일')
  .option('-o, --output <file>', '분석 결과 저장 파일')
  .option('--skip-patterns', '패턴 분석 건너뛰기')
  .option('--skip-guidelines', '가이드라인 검사 건너뛰기')
  .option('--skip-contextual', 'LLM 기반 맥락적 검사 건너뛰기')
  .option('--generate-fixes', '수정안 자동 생성')
  .option('-l, --limit <number>', '패턴 검색 결과 수', '10')
  .action(async (options) => {
    try {
      await performUnifiedCheck(options);
    } catch (error) {
      console.error('통합 검사 실패:', error.message);
      process.exit(1);
    }
  });

// 개발가이드 전용 검사 명령어
// 정적 규칙 검사와 선택적 LLM 맥락 검사를 수행하고 수정안 생성 가능
program
  .command('check-guidelines')
  .description('개발가이드 규칙만 검사')
  .option('-c, --code <file>', '검사할 Java 코드 파일')
  .option('--include-contextual', 'LLM 기반 맥락적 검사 포함')
  .option('--fix', '가이드라인 기반 코드 수정 생성')
  .option('-o, --output <file>', '결과 저장 파일')
  .action(async (options) => {
    try {
      await performGuidelineOnlyCheck(options);
    } catch (error) {
      console.error('가이드라인 검사 실패:', error.message);
      process.exit(1);
    }
  });

// VectorDB 기반 유사 패턴 검색 및 분석 명령어
// 코드를 임베딩하여 유사 패턴을 검색하고 동적으로 이슈 탐지
program
  .command('search')
  .description('유사 패턴 검색 및 수정안 제시 (issueCodeAnalyzer 사용)')
  .option('-c, --code <file>', '검색할 코드 파일')
  .option('-l, --limit <number>', '검색 결과 수', '5')
  .option('--fix', '수정안 제시 활성화')
  .option('-o, --output <file>', '분석 결과 저장 파일')
  .action(async (options) => {
    try {
      await searchAndAnalyzePatterns(options);
    } catch (error) {
      console.error('❌ 검색 실패:', error.message);
      process.exit(1);
    }
  });

// 하위 호환성을 위한 search-patterns 명령어 (search와 동일)
program
  .command('search-patterns')
  .description('VectorDB 패턴 분석만 수행 (search 명령어와 동일)')
  .option('-c, --code <file>', '검사할 코드 파일')
  .option('-l, --limit <number>', '검색 결과 수', '5')
  .option('--fix', '수정안 제시 활성화')
  .option('-o, --output <file>', '분석 결과 저장 파일')
  .action(async (options) => {
    try {
      await searchAndAnalyzePatterns(options);
    } catch (error) {
      console.error('패턴 검색 실패:', error.message);
      process.exit(1);
    }
  });

// 단일 이슈를 분석하여 패턴 데이터셋 생성
// JSON 형식의 이슈 데이터를 입력받아 임베딩 및 검증 수행
program
  .command('analyze')
  .description('단일 이슈를 분석하여 패턴 데이터셋 생성')
  .option('-i, --input <file>', '입력 JSON 파일 경로')
  .option('-o, --output <file>', '출력 JSON 파일 경로')
  .action(async (options) => {
    try {
      await processSingleIssue(options);
    } catch (error) {
      console.error('분석 실패:', error.message);
      process.exit(1);
    }
  });

// 여러 이슈 파일을 배치로 처리
// 디렉토리 내 모든 JSON 파일을 순회하며 패턴 데이터셋 생성
program
  .command('batch')
  .description('여러 이슈를 배치로 처리')
  .option('-i, --input <dir>', '입력 디렉토리 경로')
  .option('-o, --output <dir>', '출력 디렉토리 경로')
  .action(async (options) => {
    try {
      await processBatchIssues(options);
    } catch (error) {
      console.error('배치 처리 실패:', error.message);
      process.exit(1);
    }
  });

// 가이드라인 규칙 관리 명령어
// 텍스트 파일 import, 저장된 규칙 목록 조회, JSON으로 export 기능 제공
program
  .command('manage-guidelines')
  .description('개발가이드 룰 관리')
  .option('--import <file>', '가이드라인 텍스트 파일 가져오기')
  .option('--list', '저장된 가이드라인 룰 목록 출력')
  .option('--export <file>', '가이드라인 룰을 파일로 내보내기')
  .action(async (options) => {
    try {
      await manageGuidelines(options);
    } catch (error) {
      console.error('가이드라인 관리 실패:', error.message);
      process.exit(1);
    }
  });

// PDF에서 개발가이드 규칙 추출
// LLM을 활용하여 PDF 텍스트에서 구조화된 가이드라인 규칙 추출
program
  .command('extract-guidelines')
  .description('PDF에서 개발가이드 규칙 추출')
  .requiredOption('-i, --input <file>', '입력 PDF 파일 경로')
  .requiredOption('-o, --output <file>', '출력 JSON 파일 경로')
  .option('--import-to-db', '추출 후 바로 VectorDB에 import')
  .action(async (options) => {
    try {
      console.log('전달받은 옵션:', {
        input: options.input,
        output: options.output,
        importToDb: options.importToDb
      });

      await extractGuidelinesFromPDF(options);
    } catch (error) {
      console.error('가이드라인 추출 실패:', error.message);
      process.exit(1);
    }
  });

// 추출된 가이드라인 JSON을 VectorDB에 일괄 저장
// 임베딩 생성 후 Weaviate에 배치 insert 수행
program
  .command('import-guidelines')
  .description('추출된 가이드라인 JSON을 VectorDB에 저장')
  .requiredOption('-i, --input <file>', '가이드라인 JSON 파일 경로')
  .option('--dry-run', 'VectorDB 저장 없이 미리보기만')
  .action(async (options) => {
    try {
      await importGuidelinesToVectorDB(options);
    } catch (error) {
      console.error('가이드라인 import 실패:', error.message);
      process.exit(1);
    }
  });

// 시스템 상태 확인
// VectorDB 연결, 패턴 수, 가이드라인 규칙 수 등 전반적인 상태 출력
program
  .command('status')
  .description('시스템 상태 확인')
  .action(async () => {
    try {
      await checkSystemStatus();
    } catch (error) {
      console.error('상태 확인 실패:', error.message);
      process.exit(1);
    }
  });

/**
 * 가이드라인 JSON을 VectorDB에 import
 * 1. JSON 파일 로드 및 파싱
 * 2. 가이드라인 배열 추출 및 검증
 * 3. 통계 정보 출력
 * 4. dry-run이 아닐 경우 Weaviate에 배치 import
 */
async function importGuidelinesToVectorDB(options) {
  console.log('\n=== 가이드라인 VectorDB Import 시작 ===');
  console.log(`입력 파일: ${options.input}`);

  // 입력 파일 존재 여부 및 크기 확인
  const inputPath = path.resolve(options.input);
  try {
    await fs.access(inputPath);
    const stats = await fs.stat(inputPath);
    console.log(`✅ 입력 파일 확인됨 (크기: ${stats.size} bytes)`);
  } catch (error) {
    console.error(`❌ 입력 파일을 찾을 수 없습니다: ${inputPath}`);
    process.exit(1);
  }

  // JSON 파일 읽기 및 파싱
  console.log('\n📖 가이드라인 JSON 파일 로딩 중...');
  let guidelineData;
  try {
    const fileContent = await fs.readFile(inputPath, 'utf-8');
    guidelineData = JSON.parse(fileContent);
    console.log('✅ JSON 파싱 완료');
  } catch (error) {
    console.error('❌ JSON 파일 읽기/파싱 실패:', error.message);
    process.exit(1);
  }

  // 가이드라인 배열 추출 (배열 직접 또는 guidelines 속성)
  let guidelines = [];
  if (Array.isArray(guidelineData)) {
    guidelines = guidelineData;
  } else if (guidelineData.guidelines && Array.isArray(guidelineData.guidelines)) {
    guidelines = guidelineData.guidelines;
  } else {
    console.error('❌ 올바른 가이드라인 형식이 아닙니다.');
    console.log('예상 형식: { guidelines: [...] } 또는 [...]');
    process.exit(1);
  }

  console.log(`\n📊 로드된 가이드라인: ${guidelines.length}개`);

  // 처음 3개 가이드라인 미리보기
  if (guidelines.length > 0) {
    console.log('\n📋 가이드라인 샘플 (처음 3개):');
    guidelines.slice(0, 3).forEach((guideline, idx) => {
      console.log(`\n${idx + 1}. ${guideline.title || guideline.ruleId}`);
      console.log(`   카테고리: ${guideline.category}`);
      console.log(`   체크 타입: ${guideline.checkType}`);
      console.log(`   심각도: ${guideline.severity}`);
    });
  }

  // 카테고리, 심각도, 체크 타입별 통계 집계
  const stats = {
    category: {},
    severity: {},
    checkType: {}
  };

  guidelines.forEach(g => {
    stats.category[g.category] = (stats.category[g.category] || 0) + 1;
    stats.severity[g.severity] = (stats.severity[g.severity] || 0) + 1;
    stats.checkType[g.checkType] = (stats.checkType[g.checkType] || 0) + 1;
  });

  console.log('\n📈 통계:');
  console.log('\n카테고리별 분포:');
  Object.entries(stats.category).forEach(([k, v]) =>
    console.log(`  - ${k}: ${v}개`)
  );

  console.log('\n심각도별 분포:');
  Object.entries(stats.severity).forEach(([k, v]) =>
    console.log(`  - ${k}: ${v}개`)
  );

  console.log('\n체크 타입별 분포:');
  Object.entries(stats.checkType).forEach(([k, v]) =>
    console.log(`  - ${k}: ${v}개`)
  );

  // Dry-run 모드일 경우 실제 저장하지 않고 종료
  if (options.dryRun) {
    console.log('\n🔍 Dry-run 모드: VectorDB 저장을 건너뜁니다.');
    console.log('실제 저장하려면 --dry-run 옵션을 제거하세요.');
    console.log('\n=== Import 미리보기 완료 ===');
    return;
  }

  // VectorDB 클라이언트 초기화 및 스키마 설정
  console.log('\n🔥 VectorDB에 가이드라인 import 중...');
  const vectorClient = new WeaviateClient();

  console.log('\n🔧 스키마 초기화 중...');
  try {
    await vectorClient.initializeSchema();
    console.log('✅ 스키마 초기화 완료');
  } catch (error) {
    console.log(`⚠️ 스키마 초기화 경고: ${error.message}`);
    console.log('계속 진행합니다...');
  }

  // 가이드라인을 Weaviate에 배치 저장
  console.log('\n🔥 VectorDB에 가이드라인 import 중...');

  try {
    const startTime = Date.now();
    const results = await vectorClient.batchImportGuidelines(guidelines);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`\n✅ VectorDB import 완료!`);
    console.log(`⏱️ 소요 시간: ${duration}초`);
    console.log(`✅ 성공: ${results.success}개`);
    console.log(`❌ 실패: ${results.failed}개`);

    // 실패한 항목이 있을 경우 처음 5개만 출력
    if (results.failed > 0 && results.errors && results.errors.length > 0) {
      console.log('\n⚠️ 실패한 항목:');
      results.errors.slice(0, 5).forEach((error, idx) => {
        console.log(`  ${idx + 1}. ${error.ruleId || 'Unknown'}: ${error.error}`);
      });
      if (results.errors.length > 5) {
        console.log(`  ... 외 ${results.errors.length - 5}개`);
      }
    }

  } catch (error) {
    console.error('\n❌ VectorDB import 중 오류 발생');
    console.error(`오류 메시지: ${error.message}`);
    if (error.stack) {
      console.error('\n스택 트레이스:');
      console.error(error.stack);
    }
    throw error;
  }

  console.log('\n=== 가이드라인 Import 완료 ===');
}

/**
 * PDF에서 가이드라인 추출
 * 1. PDF 파일 존재 확인
 * 2. GuidelineExtractor 초기화 및 PDF 파싱
 * 3. LLM을 통해 텍스트에서 구조화된 가이드라인 추출
 * 4. JSON 파일로 저장
 * 5. 옵션에 따라 VectorDB에 바로 import
 */
async function extractGuidelinesFromPDF(options) {
  console.log('\n=== PDF 가이드라인 추출 시작 ===');
  console.log(`입력 파일: ${options.input}`);
  console.log(`출력 파일: ${options.output}`);
  console.log(`작업 디렉토리: ${process.cwd()}`);
  console.log(`절대 경로: ${path.resolve(options.input)}`);

  // PDF 파일 존재 여부 및 크기 확인
  const inputPath = path.resolve(options.input);
  try {
    await fs.access(inputPath);
    const stats = await fs.stat(inputPath);
    console.log(`✅ 입력 파일 확인됨 (크기: ${stats.size} bytes)`);
  } catch (error) {
    console.error(`❌ 입력 파일을 찾을 수 없습니다: ${inputPath}`);
    console.error(`현재 디렉토리의 파일 목록을 확인하세요:`);
    try {
      const files = await fs.readdir('.');
      console.log('현재 디렉토리 파일:', files.filter(f => f.endsWith('.pdf')));
    } catch (e) {
      // 무시
    }
    process.exit(1);
  }

  // GuidelineExtractor 초기화 (LLM 클라이언트 설정 포함)
  console.log('\n🚀 GuidelineExtractor 초기화 중...');
  const extractor = new GuidelineExtractor();

  try {
    await extractor.initialize();
    console.log('✅ 초기화 완료');

    // PDF 파일 텍스트 추출 및 LLM으로 가이드라인 파싱
    console.log('\n📄 PDF 파일 분석 시작...');
    const startTime = Date.now();

    await extractor.extractFromPDF(inputPath);

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`⏱️ 추출 소요 시간: ${duration}초`);

    // 추출 결과가 없을 경우 경고
    if (extractor.guidelines.length === 0) {
      console.warn('\n⚠️ 추출된 가이드라인이 없습니다.');
      console.log('extracted_text_debug.txt 파일을 확인해보세요.');

      if (extractor.extractedText) {
        console.log(`\n추출된 텍스트 샘플 (처음 500자):`);
        console.log(extractor.extractedText.substring(0, 500));
      }
      return;
    }

    console.log(`\n✅ 총 ${extractor.guidelines.length}개의 가이드라인 추출 완료`);

    // 처음 3개 가이드라인 샘플 출력
    console.log('\n📋 추출된 가이드라인 샘플 (처음 3개):');
    extractor.guidelines.slice(0, 3).forEach((guideline, idx) => {
      console.log(`\n${idx + 1}. ${guideline.title}`);
      console.log(`   카테고리: ${guideline.category}`);
      console.log(`   체크 타입: ${guideline.checkType}`);
      console.log(`   설명: ${guideline.description.substring(0, 100)}...`);
    });

    // 추출된 가이드라인을 JSON 파일로 저장
    console.log(`\n💾 JSON 파일 저장 중: ${options.output}`);
    await extractor.saveToJSON(options.output);

    // --import-to-db 옵션이 있을 경우 바로 VectorDB에 저장
    if (options.importToDb) {
      console.log('\n🔥 VectorDB에 가이드라인 import 중...');
      const vectorClient = new WeaviateClient();

      const results = await vectorClient.batchImportGuidelines(extractor.guidelines);

      console.log(`✅ VectorDB import 완료: 성공 ${results.success}개, 실패 ${results.failed}개`);
    }

    console.log('\n=== 가이드라인 추출 완료 ===');

  } catch (error) {
    console.error('\n❌ 가이드라인 추출 중 오류 발생');
    console.error(`오류 메시지: ${error.message}`);
    console.error(`오류 타입: ${error.name}`);
    if (error.stack) {
      console.error('\n스택 트레이스:');
      console.error(error.stack);
    }
    throw error;
  }
}

/**
 * 통합 코드 품질 검사 수행
 * 1. UnifiedJavaCodeChecker 초기화
 * 2. 검사 옵션에 따라 가이드라인, 맥락 검사, 패턴 분석 수행
 * 3. 결과를 우선순위화하여 통합 리포트 생성
 * 4. 옵션에 따라 최적화된 JSON 리포트 저장
 */
async function performUnifiedCheck(options) {
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

/**
 * 최적화된 리포트 생성 (핵심 정보만 포함)
 * 메타데이터, 요약 통계, 상위 20개 이슈, 스타일/가이드라인 요약,
 * 패턴 분석 요약, 권장사항을 포함한 경량화된 JSON 구조 생성
 */
function buildOptimizedReport(results, fileName, filePath, sourceCode, checkOptions) {
  const report = {
    metadata: {
      fileName,
      filePath,
      analysisDate: new Date().toISOString(),
      codeLines: sourceCode.split('\n').length,
      codeSize: sourceCode.length,
      checkOptions: {
        guidelines: !checkOptions.skipGuidelines,
        contextual: !checkOptions.skipContextual,
        patterns: !checkOptions.skipPatterns,
        generateFixes: checkOptions.generateFixes
      }
    },

    // 전체 점수 및 심각도별 이슈 수 요약
    summary: {
      overallScore: results.overview.overallScore,
      totalIssues: results.overview.totalIssues,
      criticalIssues: countBySeverity(results.prioritizedIssues, 'CRITICAL'),
      highIssues: countBySeverity(results.prioritizedIssues, 'HIGH'),
      mediumIssues: countBySeverity(results.prioritizedIssues, 'MEDIUM'),
      lowIssues: countBySeverity(results.prioritizedIssues, 'LOW'),
      warningCount: results.styleAndGuideline?.warnings?.length || 0
    },

    // 카테고리별, 심각도별, 소스별 통계 집계
    statistics: {
      byCategory: groupByCategory(results.prioritizedIssues),
      bySeverity: groupBySeverity(results.prioritizedIssues),
      bySource: groupBySource(results.prioritizedIssues),
      warningsByCategory: results.styleAndGuideline?.warnings
        ? groupByCategory(results.styleAndGuideline.warnings)
        : {}
    },

    // 우선순위 상위 20개 이슈만 포함 (제목, 카테고리, 심각도, 위치 등)
    topIssues: results.prioritizedIssues
      .slice(0, 20)
      .map(issue => ({
        title: issue.title,
        category: issue.category,
        severity: issue.severity,
        line: issue.location?.startLine || issue.line,
        description: truncateText(issue.description, 200),
        source: issue.source,
        effort: issue.effort
      })),

    // 스타일 및 가이드라인 검사 결과 요약
    styleAndGuideline: results.styleAndGuideline ? {
      score: results.styleAndGuideline.score,
      violationCount: results.styleAndGuideline.violations.length,
      warningCount: results.styleAndGuideline.warnings.length,
      topViolations: results.styleAndGuideline.violations
        .map(v => summarizeIssue(v)),
      topWarnings: results.styleAndGuideline.warnings
        .map(w => summarizeIssue(w))
    } : null,

    // 패턴 분석 결과 요약 (VectorDB 기반)
    patternAnalysis: results.patternAnalysis ? {
      score: results.patternAnalysis.score,
      detectedIssuesCount: results.patternAnalysis.detectedIssues.length,
      similarPatternsCount: results.patternAnalysis.similarPatterns.length,
      topDetectedIssues: results.patternAnalysis.detectedIssues
        .map(issue => summarizeIssue(issue))
    } : null,

    // 카테고리별 개선 권장사항 (빠른 수정, 장기 개선)
    recommendations: results.recommendations
      ? results.recommendations.slice(0, 5).map(rec => ({
        category: rec.category,
        issueCount: rec.issueCount,
        priority: rec.priority,
        quickFixesAvailable: rec.quickFixes?.length || 0,
        quickFixTitles: rec.quickFixes?.slice(0, 3).map(f => f.title),
        improvementAreas: rec.longtermImprovements?.slice(0, 3)
      }))
      : []
  };

  // 수정안 생성 옵션이 활성화된 경우 수정 정보 포함
  if (checkOptions.generateFixes && results.fixes) {
    report.fixes = {
      available: true,
      count: results.fixes.length,
      summary: results.fixes.slice(0, 3).map(fix => ({
        issueTitle: fix.issueTitle,
        hasFixedCode: !!fix.fixedCode,
        confidence: fix.confidence
      }))
    };
  }

  return report;
}

/**
 * 이슈 요약 헬퍼 함수
 * 제목, 카테고리, 심각도, 라인, 설명(150자), 규칙ID만 포함
 */
function summarizeIssue(issue) {
  return {
    title: issue.title,
    category: issue.category,
    severity: issue.severity,
    line: issue.location?.startLine || issue.line,
    description: truncateText(issue.description || issue.message, 150),
    ruleId: issue.ruleId
  };
}

/**
 * 텍스트를 지정된 최대 길이로 자르기
 */
function truncateText(text, maxLength) {
  if (!text) return '';
  return text.length > maxLength
    ? text.substring(0, maxLength) + '...'
    : text;
}

/**
 * 특정 심각도의 이슈 개수 계산
 */
function countBySeverity(issues, severity) {
  return issues.filter(i => i.severity === severity).length;
}

/**
 * 카테고리별 이슈 개수 집계
 */
function groupByCategory(issues) {
  const groups = {};
  issues.forEach(issue => {
    const cat = issue.category || 'other';
    groups[cat] = (groups[cat] || 0) + 1;
  });
  return groups;
}

/**
 * 심각도별 이슈 개수 집계
 * warnings는 명시적으로 LOW로 처리
 */
function groupBySeverity(issues) {
  const groups = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0
  };

  issues.forEach(issue => {
    let severity = issue.severity;
    if (issue.source === 'style_analyzer' && !severity) {
      severity = 'LOW';
    }
    const sev = severity || 'LOW';
    groups[sev] = (groups[sev] || 0) + 1;
  });

  return groups;
}

/**
 * 소스별 이슈 개수 집계 (guideline_checker, pattern_analyzer 등)
 */
function groupBySource(issues) {
  const groups = {};
  issues.forEach(issue => {
    const src = issue.source || 'unknown';
    groups[src] = (groups[src] || 0) + 1;
  });
  return groups;
}

/**
 * 가이드라인 전용 검사 수행
 * 1. AST 파싱
 * 2. 정적 규칙 검사 및 선택적 LLM 맥락 검사
 * 3. 중복 이슈 제거
 * 4. --fix 옵션 시 각 위반사항에 대한 수정 제안 및 전체 수정 코드 생성
 * 5. 결과를 JSON으로 저장
 */
async function performGuidelineOnlyCheck(options) {
  if (!options.code) {
    console.error('검사할 코드 파일을 지정해주세요: -c <file>');
    return;
  }

  console.log('=== 개발가이드 규칙 검사 ===');
  console.log(`대상 파일: ${options.code}`);

  const sourceCode = await fs.readFile(options.code, 'utf-8');
  const fileName = path.basename(options.code);

  const unifiedChecker = new UnifiedJavaCodeChecker();
  await unifiedChecker.initialize();

  // AST 파싱 및 가이드라인 검사 수행
  const astAnalysis = unifiedChecker.astParser.parseJavaCode(sourceCode);
  const guidelineResults = await unifiedChecker.performGuidelineCheck(sourceCode, astAnalysis, options);

  if (options.includeContextual) {
    console.log('\n맥락적 가이드라인 검사 포함됨');
  }

  // 라인과 규칙 ID 기준으로 중복 이슈 제거
  const allViolations = deduplicateIssuesByLineAndRule(guidelineResults.violations);
  const allWarnings = deduplicateIssuesByLineAndRule(guidelineResults.warnings);

  console.log('\n=== 검사 결과 ===');
  console.log(`위반사항: ${allViolations.length}개`);
  console.log(`경고사항: ${allWarnings.length}개`);
  console.log(`스타일 점수: ${guidelineResults.styleScore}/100`);

  // 위반사항을 카테고리별로 분류하여 출력
  if (allViolations.length > 0) {
    console.log('\n[위반사항]');
    const categorizedViolations = categorizeIssues(allViolations);
    Object.entries(categorizedViolations).forEach(([category, issues]) => {
      console.log(`\n  ${category}: ${issues.length}개`);
      issues.slice(0, 3).forEach((issue, index) => {
        console.log(`    ${index + 1}. 라인 ${issue.line}: ${issue.message || issue.title}`);
      });
      if (issues.length > 3) {
        console.log(`    ... 외 ${issues.length - 3}개`);
      }
    });
  }

  // 경고사항 출력
  if (allWarnings.length > 0) {
    console.log('\n[경고사항]');
    const categorizedWarnings = categorizeIssues(allWarnings);
    Object.entries(categorizedWarnings).forEach(([category, issues]) => {
      console.log(`\n  ${category}: ${issues.length}개`);
      issues.slice(0, 3).forEach((issue, index) => {
        console.log(`    ${index + 1}. 라인 ${issue.line}: ${issue.message || issue.title}`);
      });
      if (issues.length > 3) {
        console.log(`    ... 외 ${issues.length - 3}개`);
      }
    });
  }

  let fixSuggestions = [];
  let fullFixedCode = null;

  // --fix 옵션: LLM을 통해 각 위반사항에 대한 수정 제안 생성
  if (options.fix && allViolations.length > 0) {
    console.log('\n=== 수정 제안 생성 중 ===');

    const llmService = new LLMService();
    await llmService.initialize();

    // 각 위반사항에 대해 LLM 기반 수정 제안 생성
    for (let i = 0; i < allViolations.length; i++) {
      const issue = allViolations[i];
      console.log(`\n[${i + 1}/${allViolations.length}] 라인 ${issue.line}: ${issue.title}`);

      const suggestion = await generateGuidelineFixSuggestion(issue, sourceCode, llmService);

      if (suggestion) {
        fixSuggestions.push({
          issue: issue,
          suggestion: suggestion
        });
        console.log(`  ✅ 수정 제안 생성 완료 (신뢰도: ${(suggestion.confidence * 100).toFixed(0)}%)`);

        if (suggestion.steps && suggestion.steps.length > 0) {
          console.log('  수정 단계:');
          suggestion.steps.forEach((step, idx) => {
            console.log(`    ${idx + 1}. ${step}`);
          });
        }

        if (suggestion.fixedLine) {
          console.log(`  수정 전: ${sourceCode.split('\n')[issue.line - 1]?.trim()}`);
          console.log(`  수정 후: ${suggestion.fixedLine.trim()}`);
        }
      } else {
        console.log(`  ⚠️ 수정 제안 생성 실패`);
      }
    }

    console.log(`\n총 ${fixSuggestions.length}개 수정 제안 생성됨`);

    // 전체 코드에 모든 수정사항을 적용한 코드 생성
    if (fixSuggestions.length > 0) {
      console.log('\n=== 전체 코드 수정 생성 중 ===');
      fullFixedCode = await generateFullFixedCodeForGuidelines(
        sourceCode,
        allViolations,
        llmService
      );

      if (fullFixedCode) {
        console.log('✅ 전체 수정 코드 생성 완료');
        console.log(`원본 코드: ${sourceCode.split('\n').length}줄`);
        console.log(`수정 코드: ${fullFixedCode.split('\n').length}줄`);
      } else {
        console.log('⚠️ 전체 수정 코드 생성 실패 - 개별 수정 제안만 제공됩니다');
      }
    }
  }

  // 결과를 JSON 파일로 저장 (수정 제안 포함)
  if (options.output) {
    const reportData = {
      fileName: fileName,
      filePath: options.code,
      analysisDate: new Date().toISOString(),
      guidelineResults: {
        violations: allViolations,
        warnings: allWarnings,
        styleScore: guidelineResults.styleScore,
        categorizedViolations: categorizeIssues(allViolations),
        categorizedWarnings: categorizeIssues(allWarnings),
        duplicatesRemoved: {
          violations: guidelineResults.violations.length - allViolations.length,
          warnings: guidelineResults.warnings.length - allWarnings.length
        }
      },
      statistics: {
        totalViolations: allViolations.length,
        totalWarnings: allWarnings.length
      }
    };

    // fix 옵션 활성화 시 수정 정보 추가
    if (options.fix) {
      reportData.fixResults = {
        fixEnabled: true,
        totalSuggestions: fixSuggestions.length,
        suggestions: fixSuggestions.map(({ issue, suggestion }) => ({
          line: issue.line,
          ruleId: issue.ruleId,
          title: issue.title,
          category: issue.category,
          severity: issue.severity,
          originalLine: sourceCode.split('\n')[issue.line - 1],
          fixedLine: suggestion.fixedLine,
          steps: suggestion.steps,
          explanation: suggestion.explanation,
          confidence: suggestion.confidence
        })),
        fullFixedCode: fullFixedCode
      };

      reportData.fixSummary = {
        suggestionsGenerated: fixSuggestions.length,
        suggestionsFailed: allViolations.length - fixSuggestions.length,
        fullCodeFixed: !!fullFixedCode,
        averageConfidence: fixSuggestions.length > 0
          ? (fixSuggestions.reduce((sum, f) => sum + f.suggestion.confidence, 0) / fixSuggestions.length).toFixed(2)
          : 0
      };
    }

    await fs.writeFile(options.output, JSON.stringify(reportData, null, 2));
    console.log(`\n결과 저장: ${options.output}`);

    // 수정된 전체 코드를 별도 파일로 저장
    if (options.fix && fullFixedCode) {
      const fixedCodePath = options.output.replace('.json', '_fixed.java');
      await fs.writeFile(fixedCodePath, fullFixedCode);
      console.log(`수정된 코드 저장: ${fixedCodePath}`);
    }
  }

  console.log('\n=== 검사 완료 ===');
  if (options.fix && fixSuggestions.length > 0) {
    console.log(`✅ ${fixSuggestions.length}개 이슈에 대한 수정 제안 생성됨`);
    if (fullFixedCode) {
      console.log('✅ 전체 수정 코드 생성 완료');
    }
  }
}

/**
 * 개별 가이드라인 위반사항에 대한 수정 제안 생성
 * 1. Cast Operator 등 특정 규칙의 오탐 필터링
 * 2. 컨텍스트 코드 추출 (앞뒤 5줄)
 * 3. LLM에 프롬프트하여 수정 단계, 수정된 라인, 설명 획득
 * 4. 신뢰도 검증 및 불확실한 응답 필터링
 */
async function generateGuidelineFixSuggestion(issue, sourceCode, llmService) {
  const codeLines = sourceCode.split('\n');
  const issueLineIndex = issue.line - 1;
  const line = codeLines[issueLineIndex] || '';

  // Cast Operator 규칙의 오탐 필터링: 실제로 Cast가 없으면 null 반환
  if (issue.ruleId === 'code_style.3_7_3' || issue.title?.includes('Cast Operator')) {
    const hasCastOperator = /\([A-Z][a-zA-Z0-9<>]*\)\s+[a-zA-Z]/.test(line);
    if (!hasCastOperator) {
      console.log(`   ⚠️ 오탐 필터링: ${issue.line}번 라인에 Cast 연산자 없음 - "${line.trim()}"`);
      return null;
    }
  }

  // 컨텍스트 코드 추출 (앞뒤 5줄)
  const contextStart = Math.max(0, issueLineIndex - 5);
  const contextEnd = Math.min(codeLines.length, issueLineIndex + 6);
  const contextCode = codeLines.slice(contextStart, contextEnd).join('\n');

  // LLM에 수정 요청 프롬프트 생성
  const prompt = `Java 코드의 개발가이드 위반사항을 수정해주세요.

## 위반사항 정보
- 규칙: ${issue.title}
- 카테고리: ${issue.category}
- 심각도: ${issue.severity}
- 라인: ${issue.line}
- 메시지: ${issue.message}
${issue.suggestion ? `- 제안사항: ${issue.suggestion}` : ''}

## 문제 코드 (라인 ${contextStart + 1}~${contextEnd}):
${contextCode}

## 요구사항
1. 개발가이드 규칙을 정확히 준수하도록 수정
2. 비즈니스 로직은 변경하지 않음
3. 수정이 필요한 라인만 제시

다음 JSON 형식으로 응답해주세요:
{
  "steps": ["수정 단계 1", "수정 단계 2"],
  "fixedLine": "수정된 코드 라인",
  "explanation": "수정 이유 설명"
}`;

  try {
    const response = await llmService.generateCompletion(prompt, {
      temperature: 0.1,
      num_predict: 1000
    });

    const parsed = llmService.llmClient.cleanAndExtractJSON(response);

    // LLM 응답 검증: 불확실한 표현이나 낮은 신뢰도 필터링
    if (parsed && parsed.fixedLine) {
      const uncertainPhrases = [
        '찾을 수 없',
        '제공되지 않았',
        '보이지 않습니다',
        '확인되지 않습니다',
        '발견되지 않',
        '전체 코드를 확인'
      ];

      const isUncertain = uncertainPhrases.some(phrase =>
        parsed.fixedLine.includes(phrase) ||
        parsed.explanation?.includes(phrase)
      );

      if (isUncertain || (parsed.confidence && parsed.confidence < 0.6)) {
        console.log(`   ⚠️ 신뢰도 낮음: ${issue.title} - LLM이 문제를 찾지 못함`);
        return null;
      }

      return {
        steps: parsed.steps || [],
        fixedLine: parsed.fixedLine,
        explanation: parsed.explanation || '',
        confidence: parsed.confidence || 0.85
      };
    }
  } catch (error) {
    console.warn(`   수정안 생성 중 오류: ${error.message}`);
  }

  return null;
}

/**
 * 전체 코드에 대한 가이드라인 기반 수정 생성
 * 1. 모든 위반사항 요약을 LLM에 전달
 * 2. 비즈니스 로직 유지하면서 모든 위반사항 수정 요청
 * 3. 수정된 전체 Java 코드 반환
 * 4. 코드 클리닝 및 유효성 검증
 */
async function generateFullFixedCodeForGuidelines(sourceCode, issues, llmService) {
  const issuesSummary = issues.map((issue, idx) =>
    `${idx + 1}. 라인 ${issue.line}: ${issue.title} - ${issue.message}`
  ).join('\n');

  const prompt = `다음 Java 코드의 개발가이드 위반사항들을 모두 수정해주세요.

## 원본 코드
${sourceCode}

## 수정해야 할 위반사항들
${issuesSummary}

## 수정 요구사항
1. 모든 개발가이드 위반사항 수정
2. 비즈니스 로직과 메서드 시그니처는 유지
3. 컴파일 가능한 완전한 Java 코드 제공
4. 주요 수정사항은 주석으로 표시

수정된 완전한 Java 코드만 반환해주세요.`;

  try {
    const response = await llmService.generateCompletion(prompt, {
      temperature: 0.1,
      num_predict: 4000
    });

    // LLM 응답에서 코드만 추출 및 클리닝
    let fixedCode = cleanLLMCodeResponse(response);

    // 코드 유효성 검증 (클래스 존재, 괄호 균형 등)
    if (fixedCode && validateJavaCode(fixedCode, sourceCode)) {
      return fixedCode;
    }
  } catch (error) {
    console.error('   전체 코드 수정 생성 실패:', error.message);
  }

  return null;
}

/**
 * LLM 응답에서 순수 코드만 추출
 * 1. <think> 태그, 마크다운 코드 블록 제거
 * 2. 설명, 헤더, 번호 리스트 제거
 * 3. package/import/class 시작점 찾기
 * 4. 마지막 중괄호 이후 설명 제거
 * 5. 빈 줄 정리
 */
function cleanLLMCodeResponse(response) {
  if (!response) return null;

  let code = response.trim();

  // <think> 태그와 마크다운 블록 제거
  code = code.replace(/<think>[\s\S]*?<\/think>/gi, '');
  code = code.replace(/```java\s*/gi, '');
  code = code.replace(/```\s*/g, '');
  code = code.replace(/\*\*.*?\*\*/g, '');
  code = code.replace(/Explanation:[\s\S]*?(?=package|import|public|class|$)/gi, '');

  // 마크다운 헤더 제거
  code = code.replace(/^##.*$/gm, '');
  code = code.replace(/^###.*$/gm, '');
  code = code.replace(/^#.*$/gm, '');

  // 번호 리스트 제거
  code = code.replace(/^\d+\.\s+.*?:/gm, '');

  // Java 코드 시작점 찾기 (package, import, public class 중 첫 번째)
  const packageIndex = code.indexOf('package ');
  const importIndex = code.indexOf('import ');
  const classIndex = code.indexOf('public class ');

  let startIndex = -1;
  if (packageIndex >= 0) startIndex = packageIndex;
  else if (importIndex >= 0) startIndex = importIndex;
  else if (classIndex >= 0) startIndex = classIndex;

  if (startIndex >= 0) {
    code = code.substring(startIndex);
  }

  // 마지막 중괄호 이후 설명 제거
  const lastBraceIndex = code.lastIndexOf('}');
  if (lastBraceIndex > 0) {
    const afterBrace = code.substring(lastBraceIndex + 1).trim();
    if (afterBrace.length > 0) {
      const codePattern = /^(package|import|public|private|protected|class|interface|@|\s*$)/;
      if (!codePattern.test(afterBrace)) {
        code = code.substring(0, lastBraceIndex + 1);
      }
    }
  }

  // 연속된 빈 줄 제거
  code = code.replace(/\n\s*\n\s*\n/g, '\n\n');

  return code.trim();
}

/**
 * Java 코드 유효성 검증
 * 1. 최소 길이 검증 (원본의 30% 이상)
 * 2. class 키워드 존재 확인
 * 3. 괄호 균형 검증 (오차 ±2 이내)
 */
function validateJavaCode(fixedCode, originalCode) {
  if (!fixedCode || fixedCode.length < originalCode.length * 0.3) {
    return false;
  }

  const hasClass = fixedCode.includes('class ');
  const openBraces = (fixedCode.match(/\{/g) || []).length;
  const closeBraces = (fixedCode.match(/\}/g) || []).length;

  return hasClass && Math.abs(openBraces - closeBraces) <= 2;
}

/**
 * 통합 검사 결과를 콘솔에 출력
 * 1. 전체 점수 및 이슈 수 요약
 * 2. 스타일/가이드라인 점수 및 위반/경고 수
 * 3. 패턴 분석 점수 및 발견된 이슈 수
 * 4. 우선순위 상위 10개 이슈 상세 출력
 * 5. 개선 권장사항 출력
 * 6. 심각도별 통계 출력
 */
function displayUnifiedResults(results, fileName) {
  console.log('\n=== 검사 결과 종합 ===');
  console.log(`파일: ${fileName}`);
  console.log(`전체 점수: ${results.overview.overallScore}/100`);
  console.log(`이슈 수: ${results.overview.totalIssues}개`);

  // 스타일 및 가이드라인 검사 결과
  if (results.styleAndGuideline) {
    console.log(`\n스타일 & 가이드라인 점수: ${results.styleAndGuideline.score}/100`);
    console.log(`- 위반사항: ${results.styleAndGuideline.violations.length}개`);
    console.log(`- 경고사항: ${results.styleAndGuideline.warnings.length}개`);

    if (results.styleAndGuideline.warnings.length > 0) {
      console.log('\n주요 경고사항:');
      results.styleAndGuideline.warnings.slice(0, 3).forEach((warning, idx) => {
        console.log(`  ${idx + 1}. 라인 ${warning.line}: ${warning.message || warning.title}`);
      });
      if (results.styleAndGuideline.warnings.length > 3) {
        console.log(`  ... 외 ${results.styleAndGuideline.warnings.length - 3}개`);
      }
    }
  }

  // VectorDB 패턴 분석 결과
  if (results.patternAnalysis) {
    console.log(`\n패턴 분석 점수: ${results.patternAnalysis.score}/100`);
    console.log(`- 발견된 이슈: ${results.patternAnalysis.detectedIssues.length}개`);
    console.log(`- 유사 패턴: ${results.patternAnalysis.similarPatterns.length}개`);
  }

  // 우선순위 상위 10개 이슈 출력 (심각도 아이콘 포함)
  if (results.prioritizedIssues.length > 0) {
    console.log('\n=== 주요 이슈 (우선순위 순) ===');
    results.prioritizedIssues.slice(0, 10).forEach((issue, index) => {
      const severity = getSeverityIcon(issue.severity);
      const severityText = issue.severity || 'LOW';
      console.log(`${index + 1}. ${severity} [${severityText}] [${issue.category}] ${issue.title}`);
      console.log(`   라인 ${issue.location.startLine}: ${issue.description}`);
      console.log(`   출처: ${issue.source} | 수정 난이도: ${issue.effort}/5`);
      console.log('');
    });

    if (results.prioritizedIssues.length > 10) {
      console.log(`... 외 ${results.prioritizedIssues.length - 10}개 이슈`);
    }
  }

  // 개선 권장사항 출력
  if (results.recommendations && results.recommendations.length > 0) {
    console.log('\n=== 개선 권장사항 ===');
    results.recommendations.slice(0, 3).forEach((rec, index) => {
      console.log(`${index + 1}. ${rec.category} (${rec.issueCount}개 이슈)`);
      if (rec.quickFixes && rec.quickFixes.length > 0) {
        console.log('   즉시 수정 가능:');
        rec.quickFixes.forEach(fix => {
          console.log(`   - ${fix.title}`);
        });
      }
      if (rec.longtermImprovements && rec.longtermImprovements.length > 0) {
        console.log('   장기 개선:');
        rec.longtermImprovements.forEach(improvement => {
          console.log(`   - ${improvement}`);
        });
      }
    });
  }

  // 심각도별 통계 요약
  console.log('\n=== 심각도별 통계 ===');
  const stats = {
    CRITICAL: countBySeverity(results.prioritizedIssues, 'CRITICAL'),
    HIGH: countBySeverity(results.prioritizedIssues, 'HIGH'),
    MEDIUM: countBySeverity(results.prioritizedIssues, 'MEDIUM'),
    LOW: countBySeverity(results.prioritizedIssues, 'LOW')
  };

  console.log(`🔴 CRITICAL: ${stats.CRITICAL}개`);
  console.log(`🟠 HIGH: ${stats.HIGH}개`);
  console.log(`🟡 MEDIUM: ${stats.MEDIUM}개`);
  console.log(`🔵 LOW: ${stats.LOW}개`);

  if (results.styleAndGuideline?.warnings?.length > 0) {
    console.log(`⚠️ 경고: ${results.styleAndGuideline.warnings.length}개 (스타일/포맷)`);
  }
}

/**
 * 심각도에 따른 이모지 아이콘 반환
 */
function getSeverityIcon(severity) {
  const icons = {
    'CRITICAL': '🔴',
    'HIGH': '🟠',
    'MEDIUM': '🟡',
    'LOW': '🔵'
  };
  return icons[severity] || '⚪';
}

/**
 * 가이드라인 규칙 관리
 * --import: 텍스트 파일에서 가이드라인 파싱 후 VectorDB에 저장
 * --list: 저장/**
 * 가이드라인 규칙 관리
 * --import: 텍스트 파일에서 가이드라인 파싱 후 VectorDB에 저장
 * --list: 저장된 정적/맥락적 규칙 목록 출력
 * --export: 모든 규칙을 JSON 파일로 내보내기
 */
async function manageGuidelines(options) {
  const unifiedChecker = new UnifiedJavaCodeChecker();
  await unifiedChecker.initialize();

  if (options.import) {
    console.log(`가이드라인 가져오기: ${options.import}`);
    const guidelineText = await fs.readFile(options.import, 'utf-8');

    // 텍스트를 파싱하여 구조화된 규칙으로 변환 후 VectorDB에 저장
    await unifiedChecker.guidelineChecker.importGuidelineText(guidelineText);
    console.log('가이드라인 가져오기 완료');

  } else if (options.list) {
    console.log('저장된 가이드라인 룰 목록:');

    const staticRules = Array.from(unifiedChecker.guidelineChecker.staticRules.values());
    const contextualRules = Array.from(unifiedChecker.guidelineChecker.contextualRules.values());

    console.log(`\n정적 규칙: ${staticRules.length}개`);
    staticRules.forEach((rule, index) => {
      console.log(`  ${index + 1}. ${rule.id} - ${rule.title} (${rule.category})`);
    });

    console.log(`\n맥락적 규칙: ${contextualRules.length}개`);
    contextualRules.forEach((rule, index) => {
      console.log(`  ${index + 1}. ${rule.id} - ${rule.title} (${rule.category})`);
    });

  } else if (options.export) {
    console.log(`가이드라인 내보내기: ${options.export}`);
    const allRules = {
      staticRules: Array.from(unifiedChecker.guidelineChecker.staticRules.values()),
      contextualRules: Array.from(unifiedChecker.guidelineChecker.contextualRules.values())
    };

    await fs.writeFile(options.export, JSON.stringify(allRules, null, 2));
    console.log('가이드라인 내보내기 완료');
  } else {
    console.log('옵션을 지정해주세요: --import, --list, --export 중 하나');
  }
}

/**
 * 단일 이슈 분석 및 패턴 데이터셋 생성
 * 1. JSON 파일에서 이슈 데이터 로드
 * 2. PatternDatasetGenerator로 코드 임베딩 생성
 * 3. 품질 검증 수행
 * 4. 패턴 데이터셋 JSON으로 저장
 */
async function processSingleIssue(options) {
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

/**
 * 배치 이슈 처리
 * 1. 디렉토리 내 모든 JSON 파일 탐색
 * 2. 각 파일에 대해 패턴 데이터셋 생성
 * 3. 성공/실패 결과 집계 및 평균 품질 점수 계산
 */
async function processBatchIssues(options) {
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

/**
 * VectorDB 기반 유사 패턴 검색 및 동적 분석
 * 1. 코드를 임베딩하여 VectorDB에서 유사 패턴 검색
 * 2. issueCodeAnalyzer로 안전/문제 패턴 분류
 * 3. 실제 코드에서 문제 패턴 탐지
 * 4. --fix 옵션 시 패턴 기반 수정 제안 생성
 * 5. 분석 결과 JSON으로 저장
 */
async function searchAndAnalyzePatterns(options) {
  if (!options.code) {
    console.error('검색할 코드 파일을 지정해주세요: -c <file>');
    return;
  }

  console.log('코드 패턴 분석 시작');
  console.log(`코드 파일: ${options.code}`);

  const sourceCode = await fs.readFile(options.code, 'utf-8');
  const fileName = path.basename(options.code);

  const analyzer = new IssueCodeAnalyzer();
  await analyzer.initialize();

  console.log('\n1단계: 유사 패턴 검색 중...');

  // 코드를 임베딩하여 VectorDB에서 유사한 패턴 검색
  const generator = new PatternDatasetGenerator();
  await generator.initialize();

  const embeddings = await generator.generateEmbeddings(sourceCode, {});
  const queryVector = embeddings.combined_embedding;

  const vectorClient = new WeaviateClient();
  const similarPatterns = await vectorClient.searchSimilarPatterns(
    queryVector,
    parseInt(options.limit),
    0.7
  );

  if (similarPatterns.length === 0) {
    console.log('유사한 패턴이 발견되지 않았습니다.');
    return;
  }

  console.log(`\n발견된 유사 패턴: ${similarPatterns.length}개`);

  // 검색된 패턴을 안전/문제 패턴으로 분류하여 출력
  similarPatterns.forEach((pattern, index) => {
    const patternType = pattern.recommended_pattern ? '안전한 패턴' : '문제 패턴';
    console.log(`  ${index + 1}. ${pattern.title} (${pattern.category}) - ${patternType}`);
  });

  console.log('\n2단계: 동적 패턴 기반 코드 분석 중...');

  // 검색된 패턴을 기반으로 실제 코드에서 문제점 탐지
  const analysisResults = await analyzer.analyzeCodeIssues(sourceCode, similarPatterns);

  const classification = analysisResults.patternClassification;
  if (classification.safePatterns.length > 0) {
    console.log(`\n안전한 패턴: ${classification.safePatterns.length}개`);
    classification.safePatterns.forEach((pattern, index) => {
      console.log(`  ${index + 1}. ${pattern.title} (${pattern.category})`);
    });
  }

  if (classification.antiPatterns.length > 0) {
    console.log(`\n문제 패턴: ${classification.antiPatterns.length}개`);
    classification.antiPatterns.forEach((pattern, index) => {
      console.log(`  ${index + 1}. ${pattern.title} (${pattern.category})`);
    });
  }

  // 코드에서 발견된 안전한 구현 출력
  if (analysisResults.safePracticesFound && analysisResults.safePracticesFound.length > 0) {
    console.log(`\n코드에서 발견된 안전한 구현: ${analysisResults.safePracticesFound.length}개`);
    analysisResults.safePracticesFound.forEach((practice, index) => {
      console.log(`  ${index + 1}. ${practice.description} (${practice.category})`);
    });
  }

  // 실제 문제가 발견되지 않은 경우 권장사항만 출력
  if (analysisResults.detectedIssues.length === 0) {
    console.log('\n주요 문제성 패턴이 발견되지 않았습니다.');

    if (analysisResults.recommendations && analysisResults.recommendations.length > 0) {
      console.log('\n추가 개선 권장사항:');
      analysisResults.recommendations.forEach((rec, index) => {
        if (rec.missing.length > 0) {
          console.log(`\n  ${rec.category} 카테고리:`);
          console.log(`    현재 구현: ${rec.implemented.map(i => i.description).join(', ') || '없음'}`);
          console.log(`    추가 권장: ${rec.missing.join(', ')}`);
        }
      });
    }

    if (options.output) {
      const analysisReport = {
        fileName,
        analysisDate: new Date().toISOString(),
        sourceCodeLines: sourceCode.split('\n').length,
        result: 'NO_ISSUES_FOUND',
        patternClassification: {
          safePatterns: classification.safePatterns.map(p => ({
            title: p.title,
            category: p.category,
            patternName: p.recommended_pattern?.pattern_name
          })),
          antiPatterns: classification.antiPatterns.map(p => ({
            title: p.title,
            category: p.category,
            severity: p.metadata?.severity
          }))
        },
        safePracticesFound: analysisResults.safePracticesFound,
        recommendations: analysisResults.recommendations,
        detectedIssues: [],
        summary: '주요 문제성 패턴이 발견되지 않았습니다. VectorDB의 동적 패턴 분석을 통해 코드가 모범 사례를 잘 따르고 있음을 확인했습니다.',
        analysisMetadata: analysisResults.analysisMetadata
      };

      await fs.writeFile(options.output, JSON.stringify(analysisReport, null, 2), 'utf-8');
      console.log(`\n분석 결과가 저장되었습니다: ${options.output}`);
    }

    console.log('\n동적 패턴 기반 코드 분석 완료 - 문제 없음');
    return;
  }

  // 발견된 문제 출력
  console.log(`\n실제 발견된 문제: ${analysisResults.detectedIssues.length}개`);

  analysisResults.detectedIssues.forEach((issue, index) => {
    console.log(`\n--- 문제 ${index + 1}: ${issue.title} ---`);
    console.log(`위치: ${issue.location.startLine}~${issue.location.endLine}줄`);
    console.log(`심각도: ${issue.severity}`);
    console.log(`신뢰도: ${(issue.patternInfo?.confidence * 100 || 80).toFixed(0)}%`);
    console.log(`패턴 ID: ${issue.patternInfo?.patternId || 'N/A'}`);
    console.log(`설명: ${issue.description}`);
    console.log('해당 코드:');
    console.log(addLineNumbers(issue.codeSnippet, issue.location.startLine));
  });

  let fullFixedCode = null;

  // --fix 옵션: VectorDB 패턴을 기반으로 수정 제안 생성
  if (options.fix) {
    console.log('\n3단계: VectorDB 패턴 기반 수정안 생성 중...');

    for (let i = 0; i < analysisResults.detectedIssues.length; i++) {
      const issue = analysisResults.detectedIssues[i];
      console.log(`\n문제 ${i + 1} VectorDB 패턴 기반 수정안 생성 중...`);

      // VectorDB에서 가져온 권장 패턴을 기반으로 수정 제안 생성
      const fixSuggestion = await analyzer.generateFixSuggestion(issue, sourceCode);
      analysisResults.detectedIssues[i].fixSuggestion = fixSuggestion;

      console.log(`\n--- VectorDB 패턴 기반 수정안 ${i + 1}: ${issue.title} ---`);

      if (fixSuggestion.patternBasedSuggestions) {
        console.log('VectorDB 권장 사항:');
        fixSuggestion.patternBasedSuggestions.forEach((suggestion, idx) => {
          console.log(`  ${idx + 1}. ${suggestion}`);
        });
      }

      console.log('\n구체적 수정 방법:');
      fixSuggestion.steps.forEach((step, stepIndex) => {
        console.log(`  ${stepIndex + 1}. ${step}`);
      });

      if (fixSuggestion.fixedCode) {
        console.log('\n수정된 코드:');
        console.log(addLineNumbers(fixSuggestion.fixedCode, issue.location.startLine));
      }

      if (fixSuggestion.frameworkNotes && fixSuggestion.frameworkNotes.length > 0) {
        console.log('\n프레임워크별 추가 권장사항:');
        fixSuggestion.frameworkNotes.forEach((note, noteIdx) => {
          console.log(`  • ${note}`);
        });
      }

      if (fixSuggestion.explanation) {
        console.log(`\n설명: ${fixSuggestion.explanation}`);
      }
    }

    // 모든 수정사항을 적용한 전체 코드 생성
    console.log('\n4단계: 전체 VectorDB 패턴 적용 코드 생성 중...');
    fullFixedCode = await analyzer.generateFullFixedCodeWithLLM(sourceCode, analysisResults.detectedIssues);

    console.log('\nVectorDB 패턴이 적용된 전체 수정 코드:');
    console.log('='.repeat(80));
    console.log(addLineNumbers(fullFixedCode));
    console.log('='.repeat(80));
  }

  // 분석 결과를 JSON으로 저장
  if (options.output) {
    const analysisReport = {
      fileName,
      analysisDate: new Date().toISOString(),
      sourceCodeLines: sourceCode.split('\n').length,
      result: 'ISSUES_FOUND',
      patternClassification: {
        safePatterns: classification.safePatterns.map(p => ({
          title: p.title,
          category: p.category,
          patternName: p.recommended_pattern?.pattern_name,
          codeExample: p.recommended_pattern?.code_template
        })),
        antiPatterns: classification.antiPatterns.map(p => ({
          title: p.title,
          category: p.category,
          severity: p.metadata?.severity,
          problematicCode: p.anti_pattern?.code_template
        }))
      },
      safePracticesFound: analysisResults.safePracticesFound,
      detectedIssues: analysisResults.detectedIssues,
      recommendations: analysisResults.recommendations,
      ...(options.fix && {
        vectorDbBasedFixes: analysisResults.detectedIssues.map(issue => ({
          issueTitle: issue.title,
          patternBasedSuggestions: issue.fixSuggestion?.patternBasedSuggestions,
          frameworkNotes: issue.fixSuggestion?.frameworkNotes,
          codeExample: issue.fixSuggestion?.codeExample
        })),
        fullFixedCode: fullFixedCode
      }),
      analysisMetadata: analysisResults.analysisMetadata,
      summary: `VectorDB의 동적 패턴 분석을 통해 ${analysisResults.detectedIssues.length}개의 문제가 발견되었습니다. ${classification.safePatterns.length}개의 안전한 패턴과 ${classification.antiPatterns.length}개의 문제 패턴을 참고하여 분석했습니다.`
    };

    await fs.writeFile(options.output, JSON.stringify(analysisReport, null, 2), 'utf-8');
    console.log(`\nVectorDB 패턴 기반 분석 결과가 저장되었습니다: ${options.output}`);
  }

  const issueCount = analysisResults.detectedIssues.length;
  const safePracticeCount = analysisResults.safePracticesFound?.length || 0;
  const safePatternCount = classification.safePatterns.length;
  const antiPatternCount = classification.antiPatterns.length;

  console.log('\nVectorDB 기반 동적 패턴 분석 완료');
  console.log(`분석 요약:`);
  console.log(`   - VectorDB 안전한 패턴: ${safePatternCount}개`);
  console.log(`   - VectorDB 문제 패턴: ${antiPatternCount}개`);
  console.log(`   - 코드 내 안전한 구현: ${safePracticeCount}개`);
  console.log(`   - 발견된 실제 문제: ${issueCount}개`);
  console.log(`   - VectorDB 기반 수정안: ${options.fix ? '제시됨' : '미제시'}`);

  if (issueCount === 0 && safePracticeCount > 0) {
    console.log(`결론: VectorDB 패턴 분석 결과, 코드가 모범 사례를 잘 따르고 있습니다.`);
  } else if (issueCount > 0) {
    console.log(`권고: VectorDB에서 가져온 ${antiPatternCount}개의 패턴 정보를 참고하여 ${issueCount}개 문제를 수정해주세요.`);
  }
}

/**
 * 시스템 상태 확인
 * 1. UnifiedJavaCodeChecker 초기화 테스트
 * 2. VectorDB 연결 확인
 * 3. 저장된 패턴 수 조회
 * 4. 가이드라인 규칙 수 조회
 * 5. 카테고리별 패턴 분포 출력
 */
async function checkSystemStatus() {
  console.log('시스템 상태 확인 중...\n');

  const unifiedChecker = new UnifiedJavaCodeChecker();

  try {
    await unifiedChecker.initialize();
    console.log('모든 시스템이 정상 작동 중입니다.\n');

    const vectorClient = new WeaviateClient();

    // VectorDB에서 전체 패턴 조회
    const patterns = await vectorClient.getAllPatterns();
    console.log(`저장된 패턴 수: ${patterns.length}개`);

    // 메모리에 로드된 가이드라인 규칙 수 확인
    const staticRuleCount = unifiedChecker.guidelineChecker.staticRules.size;
    const contextualRuleCount = unifiedChecker.guidelineChecker.contextualRules.size;
    console.log(`가이드라인 룰: 정적 ${staticRuleCount}개, 맥락적 ${contextualRuleCount}개`);

    // 카테고리별 패턴 분포 통계
    const categoryStats = patterns.reduce((stats, pattern) => {
      stats[pattern.category] = (stats[pattern.category] || 0) + 1;
      return stats;
    }, {});

    if (Object.keys(categoryStats).length > 0) {
      console.log('\n카테고리별 패턴 분포:');
      Object.entries(categoryStats).forEach(([category, count]) => {
        console.log(`  - ${category}: ${count}개`);
      });
    }

  } catch (error) {
    console.error('시스템 오류:', error.message);
    throw error;
  }
}

/**
 * JSON 파일에서 이슈 데이터 로드 및 필수 필드 검증
 */
async function loadIssueData(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    const required = ['issueId', 'title', 'problematicCode'];
    for (const field of required) {
      if (!data[field]) {
        throw new Error(`필수 필드 누락: ${field}`);
      }
    }

    return data;
  } catch (error) {
    throw new Error(`이슈 데이터 로드 실패 (${filePath}): ${error.message}`);
  }
}

/**
 * 패턴 데이터셋을 JSON 파일로 저장 (디렉토리 자동 생성)
 */
async function savePatternDataset(dataset, filePath) {
  try {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(filePath, JSON.stringify(dataset, null, 2), 'utf-8');
  } catch (error) {
    throw new Error(`패턴 데이터셋 저장 실패 (${filePath}): ${error.message}`);
  }
}

/**
 * 디렉토리 내 모든 JSON 파일 경로 반환
 */
async function getJsonFiles(dirPath) {
  try {
    const files = await fs.readdir(dirPath);
    const jsonFiles = files
      .filter(file => file.endsWith('.json'))
      .map(file => path.join(dirPath, file));

    return jsonFiles;
  } catch (error) {
    throw new Error(`디렉토리 읽기 실패 (${dirPath}): ${error.message}`);
  }
}

/**
 * 코드에 라인 번호 추가 (출력 가독성 향상)
 */
function addLineNumbers(code, startLine = 1) {
  return code.split('\n').map((line, index) => {
    const lineNum = (startLine + index).toString().padStart(3, ' ');
    return `${lineNum}: ${line}`;
  }).join('\n');
}

/**
 * 라인과 규칙 ID 기준으로 중복 이슈 제거
 * 같은 라인에 같은 규칙의 이슈가 여러 번 탐지되는 것 방지
 */
function deduplicateIssuesByLineAndRule(issues) {
  const seen = new Set();
  return issues.filter(issue => {
    const key = `${issue.line}-${issue.ruleId}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * 이슈를 카테고리별로 그룹화
 * 출력 시 카테고리별로 분류하여 보여주기 위함
 */
function categorizeIssues(issues) {
  return issues.reduce((groups, issue) => {
    const category = issue.category || 'general';
    if (!groups[category]) groups[category] = [];
    groups[category].push(issue);
    return groups;
  }, {});
}

/**
 * 메인 진입점: CLI 명령어 파싱 및 실행
 */
async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    console.error('실행 오류:', error.message);
    process.exit(1);
  }
}

// 직접 실행 시에만 main 함수 호출 (모듈 import 시에는 실행 안함)
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main();
}