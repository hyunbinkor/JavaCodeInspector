/**
 * 코드 검사 명령어
 * @module commands/checkCommand
 */

import fs from 'fs/promises';
import path from 'path';
import { CodeProfiler } from '../profiler/CodeProfiler.js';
import { RuleMatcher } from '../matcher/RuleMatcher.js';
import { getTagDefinitionLoader } from '../profiler/TagDefinitionLoader.js';
import { loadData, saveJsonData } from '../utils/fileUtils.js';
import logger from '../utils/loggerUtils.js';

/**
 * 통합 코드 검사
 */
export async function performUnifiedCheck(options) {
  logger.info('=== 통합 Java 코드 품질 검사 ===');
  logger.info(`대상: ${options.code}`);

  const sourceCode = await loadData(options.code, 'sampleCode');
  const fileName = path.basename(options.code);

  // 1. 코드 프로파일 생성
  logger.info('\n📊 Step 1: 코드 프로파일 생성...');
  const profiler = new CodeProfiler();
  await profiler.initialize({ enableTier2: false });
  
  const startTime = Date.now();
  const profile = await profiler.generateProfile(sourceCode, {
    enableTier2: false,
    includeCompound: true
  });
  const profileTime = Date.now() - startTime;

  console.log('\n' + profiler.summarizeProfile(profile));
  console.log(`⏱️ 프로파일링 시간: ${profileTime}ms`);

  // 2. 규칙 로드 (외부 파일 또는 기본 규칙)
  logger.info('\n🔍 Step 2: 규칙 로드 및 매칭...');
  const matcher = new RuleMatcher();
  await matcher.initialize();

  let rules;
  if (options.rules) {
    // 외부 규칙 파일 사용
    rules = await loadRulesFromFile(options.rules);
    logger.info(`  외부 규칙 로드: ${rules.length}개`);
  } else {
    // 기본 테스트 규칙
    rules = getDefaultRules();
    logger.info(`  기본 규칙 사용: ${rules.length}개`);
  }

  const matchStartTime = Date.now();
  const matchResult = await matcher.matchRules(profile, rules, {
    skipUntagged: false,  // tagCondition 없는 규칙도 포함
    sortByPriority: true
  });
  const matchTime = Date.now() - matchStartTime;

  // 3. 결과 출력
  logger.info('\n📋 Step 3: 결과 출력...');
  console.log(`\n${'='.repeat(50)}`);
  console.log(`검사 결과: ${matchResult.violations.length}개 위반 발견`);
  console.log(`${'='.repeat(50)}\n`);

  if (matchResult.violations.length === 0) {
    console.log('✅ 위반사항 없음');
  } else {
    for (const violation of matchResult.violations) {
      const icon = violation.severity === 'CRITICAL' ? '🚨' : 
                   violation.severity === 'HIGH' ? '⚠️' : 
                   violation.severity === 'MEDIUM' ? '📝' : 'ℹ️';
      console.log(`${icon} [${violation.severity}] ${violation.title} (${violation.ruleId})`);
      console.log(`   카테고리: ${violation.category}`);
      console.log(`   매칭 조건: ${violation.expression}`);
      console.log(`   매칭 태그: [${violation.matchedTags.join(', ')}]`);
      if (violation.suggestion) {
        console.log(`   💡 제안: ${violation.suggestion}`);
      }
      console.log();
    }
  }

  // 요약
  const summary = matcher.summarizeViolations(matchResult.violations);
  console.log('=== 요약 ===');
  console.log(`총 위반: ${summary.total}개`);
  console.log(`  - CRITICAL: ${summary.bySeverity.critical}개`);
  console.log(`  - HIGH: ${summary.bySeverity.high}개`);
  console.log(`  - MEDIUM: ${summary.bySeverity.medium}개`);
  console.log(`  - LOW: ${summary.bySeverity.low}개`);
  console.log(`\n⏱️ 처리 시간: 프로파일링 ${profileTime}ms + 매칭 ${matchTime}ms = ${profileTime + matchTime}ms`);

  // 결과 저장
  if (options.output) {
    const jsonResult = {
      fileName,
      timestamp: new Date().toISOString(),
      profile: profiler.profileToJSON(profile),
      violations: matchResult.violations,
      summary,
      timing: {
        profiling: profileTime,
        matching: matchTime,
        total: profileTime + matchTime
      }
    };
    await saveJsonData(jsonResult, options.output, 'report');
    logger.info(`\n결과 저장: ${options.output}`);
  }

  logger.info('\n=== 검사 완료 ===');
  return matchResult;
}

/**
 * 가이드라인 전용 검사
 */
export async function performGuidelineOnlyCheck(options) {
  logger.info('=== 가이드라인 전용 검사 ===');
  logger.warn('⚠️ 이 기능은 VectorDB 연동 후 완전히 지원됩니다.');
  
  // 현재는 통합 검사로 대체
  await performUnifiedCheck(options);
}

/**
 * 외부 규칙 파일 로드
 */
async function loadRulesFromFile(filePath) {
  const absolutePath = path.isAbsolute(filePath) 
    ? filePath 
    : path.join(process.cwd(), filePath);
  
  const content = await fs.readFile(absolutePath, 'utf-8');
  const data = JSON.parse(content);
  
  // guidelines 또는 rules 또는 직접 배열
  return data.guidelines || data.rules || (Array.isArray(data) ? data : []);
}

/**
 * 기본 테스트 규칙 (VectorDB 연동 전)
 */
function getDefaultRules() {
  return [
    {
      ruleId: 'RES-001',
      title: '리소스 누수 방지',
      description: 'Connection, Statement, ResultSet 등의 리소스는 반드시 try-with-resources 또는 finally에서 close해야 합니다.',
      severity: 'CRITICAL',
      category: 'resource_management',
      tagCondition: 'RESOURCE_LEAK_RISK',
      suggestion: 'try-with-resources 구문을 사용하세요.'
    },
    {
      ruleId: 'SEC-001',
      title: 'SQL Injection 방지',
      description: 'SQL 문자열 연결 대신 PreparedStatement를 사용해야 합니다.',
      severity: 'CRITICAL',
      category: 'security',
      tagCondition: 'SQL_INJECTION_RISK',
      suggestion: 'PreparedStatement와 파라미터 바인딩을 사용하세요.'
    },
    {
      ruleId: 'PERF-001',
      title: 'N+1 쿼리 방지',
      description: '루프 내에서 DB 호출을 하면 성능 문제가 발생합니다.',
      severity: 'HIGH',
      category: 'performance',
      tagCondition: 'N_PLUS_ONE_RISK',
      suggestion: '배치 조회나 JOIN을 사용하세요.'
    },
    {
      ruleId: 'ARCH-001',
      title: 'Controller에서 DAO 직접 호출 금지',
      description: 'Controller는 Service 계층을 통해서만 데이터에 접근해야 합니다.',
      severity: 'HIGH',
      category: 'architecture',
      tagCondition: 'IS_CONTROLLER && IS_DAO',
      suggestion: 'Service 계층을 추가하세요.'
    },
    {
      ruleId: 'ERR-001',
      title: '빈 catch 블록 금지',
      description: '예외를 무시하면 디버깅이 어렵습니다.',
      severity: 'MEDIUM',
      category: 'exception_handling',
      tagCondition: 'HAS_EMPTY_CATCH',
      suggestion: '로깅 또는 예외 재발생을 추가하세요.'
    },
    {
      ruleId: 'ERR-002',
      title: '포괄적 예외 처리 지양',
      description: 'catch(Exception e)보다 구체적인 예외를 처리하세요.',
      severity: 'MEDIUM',
      category: 'exception_handling',
      tagCondition: 'HAS_GENERIC_CATCH && !HAS_EMPTY_CATCH',
      suggestion: '구체적인 예외 타입을 catch하세요.'
    }
  ];
}

export default { performUnifiedCheck, performGuidelineOnlyCheck };
