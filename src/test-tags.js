/**
 * 태그 추출 테스트 스크립트
 * 
 * 실행: node src/test-tags.js
 */

import fs from 'fs/promises';
import path from 'path';
import { TagExtractor } from './profiler/TagExtractor.js';
import { CodeProfiler } from './profiler/CodeProfiler.js';
import { TagExpressionEvaluator } from './matcher/TagExpressionEvaluator.js';
import { RuleMatcher } from './matcher/RuleMatcher.js';
import { getTagDefinitionLoader } from './profiler/TagDefinitionLoader.js';

async function main() {
  console.log('=== 태그 기반 필터링 시스템 테스트 ===\n');

  // 1. 샘플 코드 로드
  const samplePath = path.join(process.cwd(), 'UserController.java');
  let sourceCode;
  
  try {
    sourceCode = await fs.readFile(samplePath, 'utf-8');
    console.log(`✅ 샘플 코드 로드: ${samplePath}`);
    console.log(`   라인 수: ${sourceCode.split('\n').length}\n`);
  } catch (error) {
    console.error(`❌ 샘플 코드 로드 실패: ${error.message}`);
    process.exit(1);
  }

  // 2. 태그 정의 로더 테스트
  console.log('--- Step 1: 태그 정의 로드 ---');
  const loader = getTagDefinitionLoader();
  await loader.initialize();
  
  const stats = loader.getStats();
  console.log(`총 태그: ${stats.totalTags}개`);
  console.log(`  - Tier 1: ${stats.tier1Count}개`);
  console.log(`  - Tier 2: ${stats.tier2Count}개`);
  console.log(`  - 복합 태그: ${stats.compoundCount}개\n`);

  // 3. 태그 추출 테스트
  console.log('--- Step 2: Tier 1 태그 추출 ---');
  const extractor = new TagExtractor();
  await extractor.initialize();
  
  const extractResult = await extractor.extractTags(sourceCode, null);
  
  console.log(`추출된 태그: ${extractResult.tags.size}개`);
  console.log('태그 목록:');
  for (const tag of extractResult.tags) {
    const detail = extractResult.details.get(tag);
    console.log(`  ✓ ${tag} (${detail?.source || 'unknown'})`);
  }
  console.log();

  // 4. 코드 프로파일러 테스트 (Tier 2 없이)
  console.log('--- Step 3: 코드 프로파일 생성 ---');
  const profiler = new CodeProfiler();
  await profiler.initialize({ enableTier2: false });  // LLM 없이 테스트
  
  const profile = await profiler.generateProfile(sourceCode, {
    enableTier2: false,
    includeCompound: true
  });

  console.log(profiler.summarizeProfile(profile));
  console.log();

  // 5. 표현식 평가 테스트
  console.log('--- Step 4: 태그 표현식 평가 ---');
  const evaluator = new TagExpressionEvaluator();
  
  const testExpressions = [
    'IS_CONTROLLER',
    'IS_CONTROLLER && USES_CONNECTION',
    'USES_CONNECTION && !HAS_TRY_WITH_RESOURCES',
    'HAS_SQL_CONCATENATION || HAS_HARDCODED_PASSWORD',
    '(IS_CONTROLLER || IS_SERVICE) && HAS_DB_CALL_IN_LOOP',
    'RESOURCE_LEAK_RISK',
    'SQL_INJECTION_RISK'
  ];

  for (const expr of testExpressions) {
    const result = evaluator.evaluate(expr, profile.tags);
    const status = result.result ? '✅ TRUE' : '❌ FALSE';
    console.log(`${status}: ${expr}`);
    if (result.matchedTags.length > 0) {
      console.log(`       매칭: [${result.matchedTags.join(', ')}]`);
    }
  }
  console.log();

  // 6. 규칙 매칭 테스트
  console.log('--- Step 5: 규칙 매칭 테스트 ---');
  const matcher = new RuleMatcher();
  await matcher.initialize();

  // 테스트용 규칙
  const testRules = [
    {
      ruleId: 'TEST-001',
      title: '리소스 누수 방지',
      severity: 'CRITICAL',
      category: 'resource_management',
      tagCondition: 'RESOURCE_LEAK_RISK'
    },
    {
      ruleId: 'TEST-002',
      title: 'SQL Injection 방지',
      severity: 'CRITICAL',
      category: 'security',
      tagCondition: 'SQL_INJECTION_RISK'
    },
    {
      ruleId: 'TEST-003',
      title: 'N+1 쿼리 방지',
      severity: 'HIGH',
      category: 'performance',
      tagCondition: 'N_PLUS_ONE_RISK'
    },
    {
      ruleId: 'TEST-004',
      title: '계층 분리',
      severity: 'HIGH',
      category: 'architecture',
      tagCondition: 'IS_CONTROLLER && (CALLS_DAO || IS_DAO)'
    },
    {
      ruleId: 'TEST-005',
      title: '빈 catch 금지',
      severity: 'MEDIUM',
      category: 'exception_handling',
      tagCondition: 'HAS_EMPTY_CATCH'
    },
    {
      ruleId: 'TEST-006',
      title: 'JPA Repository 사용',
      severity: 'LOW',
      category: 'framework',
      tagCondition: 'USES_JPA_REPOSITORY'  // 해당 없음
    }
  ];

  const matchResult = await matcher.matchRules(profile, testRules, {
    skipUntagged: true,
    sortByPriority: true
  });

  console.log(`매칭된 규칙 (위반): ${matchResult.violations.length}개`);
  console.log(`필터링된 규칙: ${matchResult.filtered.notMatched}개\n`);

  for (const violation of matchResult.violations) {
    console.log(`🚨 [${violation.severity}] ${violation.title} (${violation.ruleId})`);
    console.log(`   표현식: ${violation.expression}`);
    console.log(`   매칭 태그: [${violation.matchedTags.join(', ')}]`);
    console.log(`   우선순위: ${violation.priority}`);
    console.log();
  }

  // 7. 요약
  console.log('=== 테스트 완료 ===');
  console.log(`총 태그: ${profile.tags.size}개`);
  console.log(`복합 태그 (위험): ${Object.values(profile.compoundTags).filter(c => c.matched).length}개`);
  console.log(`매칭된 규칙: ${matchResult.violations.length}개`);
  console.log(`위험 수준: ${profile.riskLevel}`);
}

main().catch(console.error);
