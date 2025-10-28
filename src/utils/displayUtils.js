/**
 * 콘솔 출력 포맷팅 관련 유틸리티 함수들
 */

import { countBySeverity } from './issueUtils.js';
import logger from './loggerUtils.js';

/**
 * 통합 검사 결과를 콘솔에 출력
 * 1. 전체 점수 및 이슈 수 요약
 * 2. 스타일/가이드라인 점수 및 위반/경고 수
 * 3. 패턴 분석 점수 및 발견된 이슈 수
 * 4. 우선순위 상위 10개 이슈 상세 출력
 * 5. 개선 권장사항 출력
 * 6. 심각도별 통계 출력
 */
export function displayUnifiedResults(results, fileName) {
  logger.info('\n=== 검사 결과 종합 ===');
  logger.info(`파일: ${fileName}`);
  logger.info(`전체 점수: ${results.overview.overallScore}/100`);
  logger.info(`이슈 수: ${results.overview.totalIssues}개`);

  // 스타일 및 가이드라인 검사 결과
  if (results.styleAndGuideline) {
    logger.info(`\n스타일 & 가이드라인 점수: ${results.styleAndGuideline.score}/100`);
    logger.info(`- 위반사항: ${results.styleAndGuideline.violations.length}개`);
    logger.info(`- 경고사항: ${results.styleAndGuideline.warnings.length}개`);

    if (results.styleAndGuideline.warnings.length > 0) {
      logger.info('\n주요 경고사항:');
      results.styleAndGuideline.warnings.slice(0, 3).forEach((warning, idx) => {
        logger.info(`  ${idx + 1}. 라인 ${warning.line}: ${warning.message || warning.title}`);
      });
      if (results.styleAndGuideline.warnings.length > 3) {
        logger.info(`  ... 외 ${results.styleAndGuideline.warnings.length - 3}개`);
      }
    }
  }

  // VectorDB 패턴 분석 결과
  if (results.patternAnalysis) {
    logger.info(`\n패턴 분석 점수: ${results.patternAnalysis.score}/100`);
    logger.info(`- 발견된 이슈: ${results.patternAnalysis.detectedIssues.length}개`);
    logger.info(`- 유사 패턴: ${results.patternAnalysis.similarPatterns.length}개`);
  }

  // 우선순위 상위 10개 이슈 출력 (심각도 아이콘 포함)
  if (results.prioritizedIssues.length > 0) {
    logger.info('\n=== 주요 이슈 (우선순위 순) ===');
    results.prioritizedIssues.slice(0, 10).forEach((issue, index) => {
      const severity = getSeverityIcon(issue.severity);
      const severityText = issue.severity || 'LOW';
      logger.info(`${index + 1}. ${severity} [${severityText}] [${issue.category}] ${issue.title}`);
      logger.info(`   라인 ${issue.location.startLine}: ${issue.description}`);
      logger.info(`   출처: ${issue.source} | 수정 난이도: ${issue.effort}/5`);
      logger.info('');
    });

    if (results.prioritizedIssues.length > 10) {
      logger.info(`... 외 ${results.prioritizedIssues.length - 10}개 이슈`);
    }
  }

  // 개선 권장사항 출력
  if (results.recommendations && results.recommendations.length > 0) {
    logger.info('\n=== 개선 권장사항 ===');
    results.recommendations.slice(0, 3).forEach((rec, index) => {
      logger.info(`${index + 1}. ${rec.category} (${rec.issueCount}개 이슈)`);
      if (rec.quickFixes && rec.quickFixes.length > 0) {
        logger.info('   즉시 수정 가능:');
        rec.quickFixes.forEach(fix => {
          logger.info(`   - ${fix.title}`);
        });
      }
      if (rec.longtermImprovements && rec.longtermImprovements.length > 0) {
        logger.info('   장기 개선:');
        rec.longtermImprovements.forEach(improvement => {
          logger.info(`   - ${improvement}`);
        });
      }
    });
  }

  // 심각도별 통계 요약
  logger.info('\n=== 심각도별 통계 ===');
  const stats = {
    CRITICAL: countBySeverity(results.prioritizedIssues, 'CRITICAL'),
    HIGH: countBySeverity(results.prioritizedIssues, 'HIGH'),
    MEDIUM: countBySeverity(results.prioritizedIssues, 'MEDIUM'),
    LOW: countBySeverity(results.prioritizedIssues, 'LOW')
  };

  logger.info(`🔴 CRITICAL: ${stats.CRITICAL}개`);
  logger.info(`🟠 HIGH: ${stats.HIGH}개`);
  logger.info(`🟡 MEDIUM: ${stats.MEDIUM}개`);
  logger.info(`🔵 LOW: ${stats.LOW}개`);

  if (results.styleAndGuideline?.warnings?.length > 0) {
    logger.info(`⚠️ 경고: ${results.styleAndGuideline.warnings.length}개 (스타일/포맷)`);
  }
}

/**
 * 심각도에 따른 이모지 아이콘 반환
 */
export function getSeverityIcon(severity) {
  const icons = {
    'CRITICAL': '🔴',
    'HIGH': '🟠',
    'MEDIUM': '🟡',
    'LOW': '🔵'
  };
  return icons[severity] || '⚪';
}