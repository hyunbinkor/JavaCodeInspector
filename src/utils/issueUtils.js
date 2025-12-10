/**
 * 이슈 처리 관련 유틸리티 함수들
 */

/**
 * 라인과 규칙 ID 기준으로 중복 이슈 제거
 * 같은 라인에 같은 규칙의 이슈가 여러 번 탐지되는 것 방지
 */
export function deduplicateIssuesByLineAndRule(issues) {
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
export function categorizeIssues(issues) {
  return issues.reduce((groups, issue) => {
    const category = issue.category || 'general';
    if (!groups[category]) groups[category] = [];
    groups[category].push(issue);
    return groups;
  }, {});
}

/**
 * 특정 심각도의 이슈 개수 계산
 */
export function countBySeverity(issues, severity) {
  return issues.filter(i => i.severity === severity).length;
}

/**
 * 카테고리별 이슈 개수 집계
 */
export function groupByCategory(issues) {
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
export function groupBySeverity(issues) {
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
export function groupBySource(issues) {
  const groups = {};
  issues.forEach(issue => {
    const src = issue.source || 'unknown';
    groups[src] = (groups[src] || 0) + 1;
  });
  return groups;
}