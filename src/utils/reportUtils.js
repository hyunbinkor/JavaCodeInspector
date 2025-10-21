/**
 * 리포트 빌드 및 최적화 관련 유틸리티 함수들
 */

/**
 * 이슈 요약 헬퍼 함수
 * 제목, 카테고리, 심각도, 라인, 설명(150자), 규칙ID만 포함
 */
export function summarizeIssue(issue) {
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
  export function truncateText(text, maxLength) {
    if (!text) return '';
    return text.length > maxLength
      ? text.substring(0, maxLength) + '...'
      : text;
  }