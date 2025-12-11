/**
 * 코드 검사 명령어 핸들러
 * 
 * @module commands/checkCommand
 * @version 3.0.0
 */

import path from 'path';
import { UnifiedJavaCodeChecker } from '../core/unifiedCodeChecker.js';
import { buildOptimizedReport } from '../services/reportGeneratorService.js';
import { generateGuidelineFixSuggestion, generateFullFixedCodeForGuidelines } from '../services/guidelineFixService.js';
import { LLMService } from '../clients/llmService.js';
import { deduplicateIssuesByLineAndRule, categorizeIssues } from '../utils/issueUtils.js';
import { displayUnifiedResults } from '../utils/displayUtil.js';
import { loadData, saveJsonData } from '../utils/fileUtils.js';
import logger from '../utils/loggerUtils.js';

/**
 * 통합 코드 품질 검사 (Layer1 + Layer2 + Layer3)
 * 
 * @param {Object} options - CLI 옵션
 * @param {string} options.code - 검사할 Java 파일
 * @param {string} [options.output] - 결과 저장 파일
 * @param {boolean} [options.fix] - 수정안 생성
 * @param {number} [options.limit=10] - 패턴 검색 수
 */
export async function performUnifiedCheck(options) {
  logger.info('=== 통합 Java 코드 품질 검사 ===');
  logger.info(`대상: ${options.code}`);

  const sourceCode = await loadData(options.code, 'sampleCode');
  const fileName = path.basename(options.code);

  const checker = new UnifiedJavaCodeChecker();
  await checker.initialize();

  const results = await checker.analyzeCode(sourceCode, {
    generateFixes: options.fix || false,
    patternLimit: parseInt(options.limit) || 10
  });

  displayUnifiedResults(results, fileName);

  if (options.output) {
    const report = buildOptimizedReport(results, fileName, options.code, sourceCode);
    await saveJsonData(report, options.output, 'report');
    logger.info(`결과 저장: ${options.output}`);
  }

  logger.info('=== 검사 완료 ===');
}

/**
 * 가이드라인 전용 검사 (Layer1)
 * 
 * @param {Object} options - CLI 옵션
 * @param {string} options.code - 검사할 Java 파일
 * @param {string} [options.output] - 결과 저장 파일
 * @param {boolean} [options.fix] - 수정안 생성
 */
export async function performGuidelineOnlyCheck(options) {
  logger.info('=== 가이드라인 검사 (Layer1) ===');
  logger.info(`대상: ${options.code}`);

  const sourceCode = await loadData(options.code, 'sampleCode');
  const fileName = path.basename(options.code);

  const checker = new UnifiedJavaCodeChecker();
  await checker.initialize();

  const astAnalysis = checker.astParser.parseJavaCode(sourceCode);
  const results = await checker.performGuidelineCheck(sourceCode, astAnalysis, {
    skipPatterns: true
  });

  const violations = deduplicateIssuesByLineAndRule(results.violations);
  const warnings = deduplicateIssuesByLineAndRule(results.warnings);

  logger.info(`\n검사 결과: ${violations.length}개 위반, ${warnings.length}개 경고`);

  // 위반사항 출력
  if (violations.length > 0) {
    const grouped = categorizeIssues(violations);
    for (const [category, items] of Object.entries(grouped)) {
      logger.info(`\n[${category}] ${items.length}개`);
      items.slice(0, 5).forEach((v, i) => {
        logger.info(`  ${i + 1}. 라인 ${v.line}: ${v.message}`);
      });
      if (items.length > 5) logger.info(`  ... 외 ${items.length - 5}개`);
    }
  }

  // --fix 옵션: 수정안 생성
  let fixedCode = null;
  if (options.fix && violations.length > 0) {
    logger.info('\n=== 수정안 생성 중... ===');
    
    const llmService = new LLMService();
    
    // 개별 위반사항 수정안 (상위 5개)
    for (const violation of violations.slice(0, 5)) {
      try {
        const fix = await generateGuidelineFixSuggestion(violation, sourceCode, llmService);
        if (fix?.fixedLine) {
          logger.info(`\n✅ ${violation.title}`);
          logger.info(`   원본: ${sourceCode.split('\n')[violation.line - 1]?.trim()}`);
          logger.info(`   수정: ${fix.fixedLine}`);
        }
      } catch (error) {
        logger.warn(`   ⚠️ 수정안 생성 실패: ${error.message}`);
      }
    }

    // 전체 수정 코드 생성
    try {
      fixedCode = await generateFullFixedCodeForGuidelines(sourceCode, violations, llmService);
      if (fixedCode) {
        logger.info('\n✅ 전체 수정 코드 생성 완료');
      }
    } catch (error) {
      logger.warn(`전체 수정 코드 생성 실패: ${error.message}`);
    }
  }

  // 결과 저장
  if (options.output) {
    const reportData = {
      fileName,
      timestamp: new Date().toISOString(),
      violations,
      warnings
    };

    await saveJsonData(reportData, options.output, 'report');
    logger.info(`\n결과 저장: ${options.output}`);

    // 수정 코드 저장
    if (fixedCode) {
      const fixedFileName = options.output.replace('.json', '_fixed.java');
      await saveJsonData(fixedCode, fixedFileName, 'fixedCode');
      logger.info(`수정 코드 저장: ${fixedFileName}`);
    }
  }

  logger.info('=== 검사 완료 ===');
}