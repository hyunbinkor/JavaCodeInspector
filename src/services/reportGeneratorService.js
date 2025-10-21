/**
 * 리포트 생성 서비스
 */

import { countBySeverity, groupByCategory, groupBySeverity, groupBySource } from '../utils/issueUtils.js';
import { summarizeIssue, truncateText } from '../utils/reportUtils.js';

/**
 * 최적화된 리포트 생성 (핵심 정보만 포함)
 * 메타데이터, 요약 통계, 상위 20개 이슈, 스타일/가이드라인 요약,
 * 패턴 분석 요약, 권장사항을 포함한 경량화된 JSON 구조 생성
 */
export function buildOptimizedReport(results, fileName, filePath, sourceCode, checkOptions) {
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