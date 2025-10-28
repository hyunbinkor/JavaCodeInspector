import path from 'path';
import { UnifiedJavaCodeChecker } from '../core/unifiedCodeChecker.js';
import { LLMService } from '../clients/llmService.js';
import { deduplicateIssuesByLineAndRule, categorizeIssues } from '../utils/issueUtils.js';
import { generateGuidelineFixSuggestion, generateFullFixedCodeForGuidelines } from '../services/guidelineFixService.js';
import { loadData } from '../utils/fileUtils.js';
import logger from '../utils/loggerUtils.js';

/**
 * 가이드라인 전용 검사 수행
 * 
 * 내부 흐름:
 * 1. DevelopmentGuidelineChecker로 가이드라인 JSON 로드
 * 2. 각 규칙에 대해 코드 검증 수행
 * 3. (옵션) vLLM 기반 맥락적 검사 추가 실행
 * 4. (옵션) 가이드라인 기반 코드 수정안 생성
 * 5. 검사 결과 반환
 */
export async function performGuidelineOnlyCheck(options) {
  if (!options.code) {
    logger.error('검사할 코드 파일을 지정해주세요: -c <file>');
    return;
  }

  logger.info('=== 개발가이드 규칙 검사 ===');
  logger.info(`대상 파일: ${options.code}`);

  const sourceCode = await loadData(options.code, 'sampleCode');
  const fileName = path.basename(options.code);

  const unifiedChecker = new UnifiedJavaCodeChecker();
  await unifiedChecker.initialize();

  // AST 파싱 및 가이드라인 검사 수행
  const astAnalysis = unifiedChecker.astParser.parseJavaCode(sourceCode);
  const guidelineResults = await unifiedChecker.performGuidelineCheck(sourceCode, astAnalysis, options);

  if (options.includeContextual) {
    logger.info('\n맥락적 가이드라인 검사 포함됨');
  }

  // 라인과 규칙 ID 기준으로 중복 이슈 제거
  const allViolations = deduplicateIssuesByLineAndRule(guidelineResults.violations);
  const allWarnings = deduplicateIssuesByLineAndRule(guidelineResults.warnings);

  logger.info('\n=== 검사 결과 ===');
  logger.info(`위반사항: ${allViolations.length}개`);
  logger.info(`경고사항: ${allWarnings.length}개`);
  logger.info(`스타일 점수: ${guidelineResults.styleScore}/100`);

  // 위반사항을 카테고리별로 분류하여 출력
  if (allViolations.length > 0) {
    logger.info('\n[위반사항]');
    const categorizedViolations = categorizeIssues(allViolations);
    Object.entries(categorizedViolations).forEach(([category, issues]) => {
      logger.info(`\n  ${category}: ${issues.length}개`);
      issues.slice(0, 3).forEach((issue, index) => {
        logger.info(`    ${index + 1}. 라인 ${issue.line}: ${issue.message || issue.title}`);
      });
      if (issues.length > 3) {
        logger.info(`    ... 외 ${issues.length - 3}개`);
      }
    });
  }

  // 경고사항 출력
  if (allWarnings.length > 0) {
    logger.info('\n[경고사항]');
    const categorizedWarnings = categorizeIssues(allWarnings);
    Object.entries(categorizedWarnings).forEach(([category, issues]) => {
      logger.info(`\n  ${category}: ${issues.length}개`);
      issues.slice(0, 3).forEach((issue, index) => {
        logger.info(`    ${index + 1}. 라인 ${issue.line}: ${issue.message || issue.title}`);
      });
      if (issues.length > 3) {
        logger.info(`    ... 외 ${issues.length - 3}개`);
      }
    });
  }

  let fixSuggestions = [];
  let fullFixedCode = null;

  // --fix 옵션: LLM을 통해 각 위반사항에 대한 수정 제안 생성
  if (options.fix && allViolations.length > 0) {
    logger.info('\n=== 수정 제안 생성 중 ===');

    const llmService = new LLMService();
    await llmService.initialize();

    // 각 위반사항에 대해 LLM 기반 수정 제안 생성
    for (let i = 0; i < allViolations.length; i++) {
      const issue = allViolations[i];
      logger.info(`\n[${i + 1}/${allViolations.length}] 라인 ${issue.line}: ${issue.title}`);

      const suggestion = await generateGuidelineFixSuggestion(issue, sourceCode, llmService);

      if (suggestion) {
        fixSuggestions.push({
          issue: issue,
          suggestion: suggestion
        });
        logger.info(`  ✅ 수정 제안 생성 완료 (신뢰도: ${(suggestion.confidence * 100).toFixed(0)}%)`);

        if (suggestion.steps && suggestion.steps.length > 0) {
          logger.info('  수정 단계:');
          suggestion.steps.forEach((step, idx) => {
            logger.info(`    ${idx + 1}. ${step}`);
          });
        }

        if (suggestion.fixedLine) {
          logger.info(`  수정 전: ${sourceCode.split('\n')[issue.line - 1]?.trim()}`);
          logger.info(`  수정 후: ${suggestion.fixedLine.trim()}`);
        }
      } else {
        logger.info(`  ⚠️ 수정 제안 생성 실패`);
      }
    }

    logger.info(`\n총 ${fixSuggestions.length}개 수정 제안 생성됨`);

    // 전체 코드에 모든 수정사항을 적용한 코드 생성
    if (fixSuggestions.length > 0) {
      logger.info('\n=== 전체 코드 수정 생성 중 ===');
      fullFixedCode = await generateFullFixedCodeForGuidelines(
        sourceCode,
        allViolations,
        llmService
      );

      if (fullFixedCode) {
        logger.info('✅ 전체 수정 코드 생성 완료');
        logger.info(`원본 코드: ${sourceCode.split('\n').length}줄`);
        logger.info(`수정 코드: ${fullFixedCode.split('\n').length}줄`);
      } else {
        logger.info('⚠️ 전체 수정 코드 생성 실패 - 개별 수정 제안만 제공됩니다');
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

    await saveJsonData(reportData, options.output, '');
    logger.info(`\n결과 저장: ${options.output}`);

    // 수정된 전체 코드를 별도 파일로 저장
    if (options.fix && fullFixedCode) {
      const fixedCodeName = options.output.replace('.json', '_fixed.java');
      await saveJsonData(fullFixedCode, fixedCodeName, 'fixedCode');
      logger.info(`수정된 코드 저장: ${fixedCodeName}`);
    }
  }

  logger.info('\n=== 검사 완료 ===');
  if (options.fix && fixSuggestions.length > 0) {
    logger.info(`✅ ${fixSuggestions.length}개 이슈에 대한 수정 제안 생성됨`);
    if (fullFixedCode) {
      logger.info('✅ 전체 수정 코드 생성 완료');
    }
  }
}