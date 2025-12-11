/**
 * 태그 관련 명령어 핸들러
 * 
 * @module commands/tagCommand
 * @version 1.0.0
 */

import path from 'path';
import { CodeProfiler } from '../profiler/CodeProfiler.js';
import { getTagDefinitionLoader } from '../profiler/TagDefinitionLoader.js';
import { loadData, saveJsonData } from '../utils/fileUtils.js';
import logger from '../utils/loggerUtils.js';

/**
 * 코드 프로파일링 (태그 추출)
 * 
 * @param {Object} options - CLI 옵션
 * @param {string} options.code - 검사할 Java 파일
 * @param {string} [options.output] - 결과 저장 파일
 * @param {boolean} [options.verbose] - 상세 출력
 * @param {boolean} [options.noLlm] - LLM 태깅 비활성화
 */
export async function profileCode(options) {
  logger.info('=== 코드 프로파일링 ===');
  logger.info(`대상: ${options.code}`);

  const sourceCode = await loadData(options.code, 'sampleCode');
  const fileName = path.basename(options.code);

  const profiler = new CodeProfiler();
  await profiler.initialize({
    enableTier2: !options.noLlm
  });

  const profile = await profiler.generateProfile(sourceCode, {
    enableTier2: !options.noLlm,
    includeCompound: true
  });

  // 결과 출력
  console.log('\n' + profiler.summarizeProfile(profile));

  if (options.verbose) {
    console.log('\n=== 상세 태그 정보 ===');
    for (const [tagName, detail] of profile.tagDetails) {
      console.log(`\n${tagName}:`);
      console.log(`  - 소스: ${detail.source}`);
      console.log(`  - 확신도: ${(detail.confidence * 100).toFixed(0)}%`);
      if (detail.evidence) {
        console.log(`  - 증거: ${detail.evidence.substring(0, 80)}...`);
      }
      if (detail.samples) {
        console.log(`  - 샘플: ${detail.samples.slice(0, 2).join(', ')}`);
      }
    }

    console.log('\n=== 복합 태그 상세 ===');
    for (const [name, result] of Object.entries(profile.compoundTags)) {
      const status = result.matched ? '⚠️ 해당' : '✅ 미해당';
      console.log(`${status} ${name}`);
      console.log(`   표현식: ${result.expression}`);
      console.log(`   설명: ${result.description}`);
    }
  }

  // 결과 저장
  if (options.output) {
    const jsonResult = {
      fileName,
      timestamp: new Date().toISOString(),
      profile: profiler.profileToJSON(profile)
    };
    await saveJsonData(jsonResult, options.output, 'report');
    logger.info(`\n결과 저장: ${options.output}`);
  }

  logger.info('\n=== 프로파일링 완료 ===');
}

/**
 * 태그 정의 목록 조회
 * 
 * @param {Object} options - CLI 옵션
 * @param {string} [options.category] - 특정 카테고리만
 * @param {number} [options.tier] - 특정 티어만 (1 또는 2)
 */
export async function listTags(options) {
  logger.info('=== 태그 정의 목록 ===\n');

  const loader = getTagDefinitionLoader();
  await loader.initialize();

  const stats = loader.getStats();
  console.log(`버전: ${stats.version}`);
  console.log(`총 태그: ${stats.totalTags}개`);
  console.log(`  - Tier 1: ${stats.tier1Count}개`);
  console.log(`  - Tier 2: ${stats.tier2Count}개`);
  console.log(`  - 복합 태그: ${stats.compoundCount}개`);
  console.log(`카테고리: ${stats.categories.join(', ')}\n`);

  // 카테고리별 또는 티어별 필터링
  let tags;
  if (options.category) {
    tags = loader.getTagsByCategory(options.category);
    console.log(`=== ${options.category} 카테고리 (${tags.length}개) ===\n`);
  } else if (options.tier) {
    tags = loader.getTagsByTier(parseInt(options.tier));
    console.log(`=== Tier ${options.tier} (${tags.length}개) ===\n`);
  } else {
    tags = loader.getAllTagNames();
    console.log(`=== 전체 태그 (${tags.length}개) ===\n`);
  }

  // 태그 출력
  for (const tagName of tags) {
    const def = loader.getTagDefinition(tagName);
    const tierBadge = def.tier === 1 ? '[T1]' : '[T2]';
    const typeBadge = def.detection?.type === 'llm' ? '🤖' : '📝';
    console.log(`${typeBadge} ${tierBadge} ${tagName}`);
    console.log(`   ${def.description}`);
    console.log(`   카테고리: ${def.category} | 방식: ${def.extractionMethod}\n`);
  }

  // 복합 태그
  if (!options.category && !options.tier) {
    const compoundTags = loader.getCompoundTags();
    console.log(`=== 복합 태그 (${Object.keys(compoundTags).length}개) ===\n`);
    
    for (const [name, def] of Object.entries(compoundTags)) {
      console.log(`🔗 ${name} [${def.severity}]`);
      console.log(`   ${def.description}`);
      console.log(`   표현식: ${def.expression}\n`);
    }
  }
}

/**
 * 태그 정의 유효성 검사
 * 
 * @param {Object} options - CLI 옵션
 * @param {string} [options.input] - 검사할 정의 파일 경로
 */
export async function validateTagDefinitions(options) {
  logger.info('=== 태그 정의 유효성 검사 ===\n');

  const loader = getTagDefinitionLoader();
  
  try {
    await loader.initialize(options.input);
    
    const stats = loader.getStats();
    console.log('✅ 태그 정의 유효성 검사 통과\n');
    console.log(`로드된 태그: ${stats.totalTags}개`);
    console.log(`Tier 1: ${stats.tier1Count}개`);
    console.log(`Tier 2: ${stats.tier2Count}개`);
    console.log(`복합 태그: ${stats.compoundCount}개`);

  } catch (error) {
    console.error(`❌ 유효성 검사 실패: ${error.message}`);
    process.exit(1);
  }
}

/**
 * 태그 정의 내보내기
 * 
 * @param {Object} options - CLI 옵션
 * @param {string} options.output - 출력 파일 경로
 */
export async function exportTagDefinitions(options) {
  logger.info('=== 태그 정의 내보내기 ===');

  const loader = getTagDefinitionLoader();
  await loader.initialize();

  await loader.exportDefinitions(options.output);
  
  logger.info(`✅ 내보내기 완료: ${options.output}`);
}

/**
 * 특정 코드에 대해 특정 태그만 테스트
 * 
 * @param {Object} options - CLI 옵션
 * @param {string} options.code - Java 파일
 * @param {string} options.tags - 테스트할 태그 (쉼표 구분)
 */
export async function testTags(options) {
  logger.info('=== 태그 테스트 ===');
  logger.info(`대상: ${options.code}`);
  logger.info(`태그: ${options.tags}\n`);

  const sourceCode = await loadData(options.code, 'sampleCode');
  const tagNames = options.tags.split(',').map(t => t.trim());

  const profiler = new CodeProfiler();
  await profiler.initialize();

  // 전체 프로파일 생성 후 필터링
  const profile = await profiler.generateProfile(sourceCode);

  console.log('\n=== 테스트 결과 ===\n');
  
  for (const tagName of tagNames) {
    const hasTag = profile.tags.has(tagName);
    const detail = profile.tagDetails.get(tagName);
    
    const icon = hasTag ? '✅' : '❌';
    console.log(`${icon} ${tagName}: ${hasTag ? '해당' : '미해당'}`);
    
    if (detail) {
      console.log(`   소스: ${detail.source}`);
      console.log(`   확신도: ${(detail.confidence * 100).toFixed(0)}%`);
      if (detail.evidence) {
        console.log(`   증거: ${detail.evidence.substring(0, 60)}...`);
      }
    }
    console.log();
  }
}

export default {
  profileCode,
  listTags,
  validateTagDefinitions,
  exportTagDefinitions,
  testTags
};
