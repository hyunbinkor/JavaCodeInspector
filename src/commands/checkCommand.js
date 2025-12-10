import path from 'path';
import { UnifiedJavaCodeChecker } from '../core/unifiedCodeChecker.js';
import { generateGuidelineFixSuggestion, generateFullFixedCodeForGuidelines } from '../services/guidelineFixService.js';
import { buildOptimizedReport } from '../services/reportGeneratorService.js';
import { LLMService } from '../clients/llmService.js';
import { deduplicateIssuesByLineAndRule, categorizeIssues } from '../utils/issueUtils.js';
import { displayUnifiedResults } from '../utils/displayUtil.js';
import { loadData, saveJsonData } from '../utils/fileUtils.js';
import logger from '../utils/loggerUtils.js';

/**
 * 통합 코드 품질 검사 수행
 * 
 * v2.1 이원화 지원:
 * - 정적 규칙: SonarQube 연동 예정 (skipStaticRules로 제어)
 * - 컨텍스트 규칙: LLM 전담 (useUnifiedPrompt로 방식 선택)
 * 
 * 내부 흐름:
 * 1. DevelopmentGuidelineChecker로 가이드라인 규칙 검증
 *    - 정적 규칙: skipStaticRules=true면 스킵 (SonarQube 연동 준비)
 *    - 컨텍스트 규칙: LLM으로 검사
 * 2. CodeEmbeddingGenerator로 코드 벡터 생성
 * 3. Qdrant VectorDB에서 유사 패턴 검색
 * 4. IssueCodeAnalyzer로 패턴 분석 및 수정안 생성
 * 5. UnifiedJavaCodeChecker로 통합 리포트 생성
 */
export async function performUnifiedCheck(options) {
  if (!options.code) {
    logger.error('검사할 코드 파일을 지정해주세요: -c <file>');
    return;
  }

  logger.info('=== 통합 Java 코드 품질 검사 시작 ===');
  logger.info(`대상 파일: ${options.code}`);

  const sourceCode = await loadData(options.code, 'sampleCode');
  const fileName = path.basename(options.code);

  // 통합 검사기 초기화 (AST 파서, 가이드라인 체커, VectorDB 등)
  const unifiedChecker = new UnifiedJavaCodeChecker();
  await unifiedChecker.initialize();

  // 검사 범위 설정 (v2.1 이원화 옵션 추가)
  const checkOptions = {
    // 기존 옵션
    skipPatterns: options.skipPatterns,
    skipGuidelines: options.skipGuidelines,
    skipContextual: options.skipContextual,
    generateRecommendations: true,
    generateFixes: options.generateFixes,
    patternLimit: parseInt(options.limit) || 10,
    
    // v2.1 이원화 옵션
    skipStaticRules: options.skipStaticRules !== false,  // 기본: true (SonarQube 연동 전까지)
    useUnifiedPrompt: options.useUnifiedPrompt !== false  // 기본: true (통합 프롬프트)
  };

  logger.info('\n검사 범위:');
  logger.info(`- 개발가이드 검사: ${!checkOptions.skipGuidelines ? 'O' : 'X'}`);
  logger.info(`- 정적 규칙 (SonarQube): ${!checkOptions.skipStaticRules ? 'O' : 'X (연동 예정)'}`);
  logger.info(`- 컨텍스트 규칙 (LLM): ${!checkOptions.skipContextual ? 'O' : 'X'}`);
  logger.info(`- 통합 프롬프트 사용: ${checkOptions.useUnifiedPrompt ? 'O' : 'X (배치 방식)'}`);
  logger.info(`- 패턴 분석: ${!checkOptions.skipPatterns ? 'O' : 'X'}`);
  logger.info(`- 자동 수정안: ${checkOptions.generateFixes ? 'O' : 'X'}`);

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

    await saveJsonData(optimizedReport, options.output, 'report');
    logger.info(`\n결과 저장: ${options.output}`);
    logger.info(`파일 크기: ${(JSON.stringify(optimizedReport).length / 1024).toFixed(2)} KB`);
  }

  logger.info('\n=== 통합 검사 완료 ===');
}

/**
 * 가이드라인 전용 검사 수행
 * 
 * v2.1 이원화:
 * - 정적 규칙은 스킵 (SonarQube 연동 예정)
 * - 컨텍스트 규칙만 LLM으로 검사
 * 
 * 내부 흐름:
 * 1. DevelopmentGuidelineChecker로 가이드라인 JSON 로드
 * 2. 각 규칙에 대해 코드 검증 수행 (LLM 전담)
 * 3. (옵션) 가이드라인 기반 코드 수정안 생성
 * 4. 검사 결과 반환
 */
export async function performGuidelineOnlyCheck(options) {
  if (!options.code) {
    logger.error('검사할 코드 파일을 지정해주세요: -c <file>');
    return;
  }

  logger.info('=== 개발가이드 규칙 검사 (LLM 전담) ===');
  logger.info(`대상 파일: ${options.code}`);

  const sourceCode = await loadData(options.code, 'sampleCode');
  const fileName = path.basename(options.code);

  const unifiedChecker = new UnifiedJavaCodeChecker();
  await unifiedChecker.initialize();

  // 가이드라인 전용 옵션 (v2.1 이원화)
  const checkOptions = {
    skipPatterns: true,           // 패턴 분석 스킵
    skipGuidelines: false,        // 가이드라인 검사 활성화
    skipContextual: false,        // 컨텍스트 검사 활성화
    skipStaticRules: true,        // 정적 규칙 스킵 (SonarQube 연동 전)
    useUnifiedPrompt: true,       // 통합 프롬프트 사용
    generateRecommendations: true
  };

  logger.info('\n검사 모드: 가이드라인 전용 (LLM)');
  logger.info('- 정적 규칙: 스킵 (SonarQube 연동 예정)');
  logger.info('- 컨텍스트 규칙: LLM 통합 프롬프트');

  // AST 파서를 사용한 코드 분석
  const guidelineResults = await unifiedChecker.performGuidelineCheck(
    sourceCode,
    unifiedChecker.astParser.parseJavaCode(sourceCode),
    checkOptions
  );

  // 중복 제거
  const allViolations = deduplicateIssuesByLineAndRule(guidelineResults.violations);
  const allWarnings = deduplicateIssuesByLineAndRule(guidelineResults.warnings);

  // 결과 출력
  logger.info(`\n📋 가이드라인 검사 결과: ${allViolations.length}개 위반, ${allWarnings.length}개 경고`);

  if (allViolations.length > 0) {
    logger.info('\n=== 위반사항 ===');
    const categorizedViolations = categorizeIssues(allViolations);

    for (const [category, violations] of Object.entries(categorizedViolations)) {
      logger.info(`\n📁 ${category} (${violations.length}개)`);
      violations.slice(0, 5).forEach((v, idx) => {
        logger.info(`  ${idx + 1}. [${v.severity}] ${v.title}`);
        logger.info(`     라인 ${v.line}: ${v.message}`);
        if (v.suggestion) {
          logger.info(`     💡 ${v.suggestion}`);
        }
      });

      if (violations.length > 5) {
        logger.info(`  ... 외 ${violations.length - 5}개`);
      }
    }
  }

  if (allWarnings.length > 0) {
    logger.info('\n=== 경고사항 ===');
    const categorizedWarnings = categorizeIssues(allWarnings);

    for (const [category, warnings] of Object.entries(categorizedWarnings)) {
      logger.info(`\n📁 ${category} (${warnings.length}개)`);
      warnings.slice(0, 3).forEach((w, idx) => {
        logger.info(`  ${idx + 1}. ${w.title}`);
        logger.info(`     라인 ${w.line}: ${w.message}`);
      });

      if (warnings.length > 3) {
        logger.info(`  ... 외 ${warnings.length - 3}개`);
      }
    }
  }

  // 수정안 생성 (옵션)
  if (options.fix && allViolations.length > 0) {
    logger.info('\n=== 자동 수정안 생성 중... ===');

    const llmService = new LLMService();

    // 각 위반에 대해 수정안 생성
    for (const violation of allViolations.slice(0, 5)) {
      try {
        const fixSuggestion = await generateGuidelineFixSuggestion(
          violation,
          sourceCode,
          llmService
        );

        if (fixSuggestion && fixSuggestion.fixedCode) {
          logger.info(`\n✅ ${violation.title} 수정안:`);
          logger.info(`   원본 라인 ${violation.line}: ${sourceCode.split('\n')[violation.line - 1]?.trim()}`);
          logger.info(`   수정안: ${fixSuggestion.fixedLine}`);
        }
      } catch (error) {
        logger.warn(`   ⚠️ 수정안 생성 실패: ${error.message}`);
      }
    }

    // 전체 수정 코드 생성
    logger.info('\n=== 전체 수정 코드 생성 중... ===');
    const fullFixedCode = await generateFullFixedCodeForGuidelines(
      sourceCode,
      allViolations,
      llmService
    );

    if (fullFixedCode) {
      logger.info('✅ 전체 수정 코드 생성 완료');

      // 결과 저장
      if (options.output) {
        const reportData = {
          metadata: {
            fileName,
            timestamp: new Date().toISOString(),
            checkMode: 'guideline_only_v2.1',
            options: checkOptions
          },
          summary: {
            totalViolations: allViolations.length,
            totalWarnings: allWarnings.length,
            categorizedViolations: categorizeIssues(allViolations),
            categorizedWarnings: categorizeIssues(allWarnings)
          },
          violations: allViolations,
          warnings: allWarnings
        };

        await saveJsonData(reportData, options.output, 'report');
        logger.info(`\n결과 저장: ${options.output}`);

        // 수정된 코드 저장
        const fixedCodeName = options.output.replace('.json', '_fixed.java');
        await saveJsonData(fullFixedCode, fixedCodeName, 'fixedCode');
        logger.info(`수정 코드 저장: ${fixedCodeName}`);
      }
    }
  } else if (options.output) {
    // 수정 없이 결과만 저장
    const reportData = {
      metadata: {
        fileName,
        timestamp: new Date().toISOString(),
        checkMode: 'guideline_only_v2.1',
        options: checkOptions
      },
      summary: {
        totalViolations: allViolations.length,
        totalWarnings: allWarnings.length
      },
      violations: allViolations,
      warnings: allWarnings
    };

    await saveJsonData(reportData, options.output, 'report');
    logger.info(`\n결과 저장: ${options.output}`);
  }

  logger.info('\n=== 가이드라인 검사 완료 ===');
}