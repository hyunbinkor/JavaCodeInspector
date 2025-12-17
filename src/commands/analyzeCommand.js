/**
 * 규칙 분석 및 tagCondition 자동 생성 명령어
 * 
 * @module commands/analyzeCommand
 * @version 1.0.0
 */

import fs from 'fs/promises';
import path from 'path';
import { TagRequirementAnalyzer } from '../analyzer/TagRequirementAnalyzer.js';
import { RuleTagMapper } from '../analyzer/RuleTagMapper.js';
import { LLMClient } from '../clients/llmClient.js';
import { loadData, saveJsonData } from '../utils/fileUtils.js';
import logger from '../utils/loggerUtils.js';

/**
 * 규칙 파일 분석 및 필요 태그 추출
 * 
 * @param {Object} options - CLI 옵션
 * @param {string} options.input - 입력 규칙 JSON 파일
 * @param {string} [options.output] - 출력 파일
 * @param {boolean} [options.llm] - LLM 사용 여부
 */
export async function analyzeRules(options) {
  logger.info('=== 규칙 분석 (필요 태그 추출) ===');
  logger.info(`입력: ${options.input}`);

  // 규칙 로드
  const rules = await loadRulesFile(options.input);
  logger.info(`로드된 규칙: ${rules.length}개`);

  // 분석기 초기화
  const analyzer = new TagRequirementAnalyzer();
  await analyzer.initialize();

  // 분석 수행
  const results = await analyzer.analyzeRules(rules, {
    useLLM: options.llm || false,
    batchSize: 5
  });

  // 결과 출력
  analyzer.summarizeResults(results);

  // 결과 저장
  if (options.output) {
    const outputData = {
      source: options.input,
      analyzedAt: new Date().toISOString(),
      usedLLM: options.llm || false,
      results
    };
    await saveJsonData(outputData, options.output, 'report');
    logger.info(`\n✅ 분석 결과 저장: ${options.output}`);
  } else {
    // 콘솔 출력
    console.log('\n=== 상세 결과 ===');
    for (const r of results.slice(0, 10)) {
      console.log(`\n📋 ${r.ruleId}: ${r.title}`);
      console.log(`   필수 태그: [${r.requiredTags.join(', ')}]`);
      console.log(`   선택 태그: [${r.optionalTags.join(', ')}]`);
      console.log(`   신뢰도: ${(r.confidence * 100).toFixed(0)}%`);
      if (r.suggestedNewTags.length > 0) {
        console.log(`   ⚠️ 새 태그 필요: [${r.suggestedNewTags.join(', ')}]`);
      }
    }
    if (results.length > 10) {
      console.log(`\n... 외 ${results.length - 10}개`);
    }
  }

  logger.info('\n=== 분석 완료 ===');
  return results;
}

/**
 * 분석 결과를 기반으로 tagCondition 자동 생성
 * 
 * @param {Object} options - CLI 옵션
 * @param {string} options.input - 분석 결과 JSON 또는 규칙 JSON
 * @param {string} [options.output] - 출력 파일
 * @param {boolean} [options.llm] - LLM 사용 여부
 * @param {boolean} [options.apply] - 원본 규칙에 직접 적용
 */
export async function generateTagConditions(options) {
  logger.info('=== tagCondition 자동 생성 ===');
  logger.info(`입력: ${options.input}`);

  // 입력 파일 로드
  const inputData = await loadJsonFile(options.input);
  
  let analysisResults;
  let originalRules;

  // 분석 결과 파일인지 규칙 파일인지 판단
  if (inputData.results && Array.isArray(inputData.results)) {
    // 분석 결과 파일
    analysisResults = inputData.results;
    logger.info(`분석 결과 로드: ${analysisResults.length}개`);
  } else {
    // 규칙 파일 → 먼저 분석 수행
    originalRules = Array.isArray(inputData) ? inputData : (inputData.guidelines || []);
    logger.info(`규칙 파일 로드: ${originalRules.length}개 → 분석 먼저 수행`);

    const analyzer = new TagRequirementAnalyzer();
    await analyzer.initialize();
    analysisResults = await analyzer.analyzeRules(originalRules, { useLLM: false });
  }

  // 매퍼 초기화
  const mapper = new RuleTagMapper();
  await mapper.initialize();

  // tagCondition 생성
  const mappings = await mapper.generateTagConditions(analysisResults, {
    useLLM: options.llm || false,
    preferCompound: true
  });

  // 결과 요약
  mapper.summarizeMappings(mappings);

  // 출력 또는 적용
  if (options.apply && originalRules) {
    // 원본 규칙에 적용
    const updatedRules = mapper.applyMappingsToRules(originalRules, mappings);
    
    const outputPath = options.output || options.input.replace('.json', '_tagged.json');
    await saveJsonData(
      Array.isArray(inputData) ? updatedRules : { ...inputData, guidelines: updatedRules },
      outputPath,
      'rule'
    );
    logger.info(`\n✅ tagCondition 적용 완료: ${outputPath}`);
  } else if (options.output) {
    // 매핑 결과만 저장
    await saveJsonData({
      source: options.input,
      generatedAt: new Date().toISOString(),
      mappings
    }, options.output, 'report');
    logger.info(`\n✅ 매핑 결과 저장: ${options.output}`);
  } else {
    // 콘솔 출력
    console.log('\n=== 생성된 tagCondition ===');
    for (const m of mappings) {
      const status = m.validated ? '✅' : '❌';
      console.log(`${status} ${m.ruleId}: ${m.tagCondition}`);
      console.log(`   전략: ${m.strategy} | 복잡도: ${m.complexity}`);
    }
  }

  logger.info('\n=== 생성 완료 ===');
  return mappings;
}

/**
 * 규칙 파일에 tagCondition 일괄 적용 (통합 명령어)
 * 
 * @param {Object} options - CLI 옵션
 * @param {string} options.input - 규칙 JSON 파일
 * @param {string} [options.output] - 출력 파일
 * @param {boolean} [options.llm] - LLM 사용 여부
 */
export async function applyTagConditions(options) {
  logger.info('=== tagCondition 일괄 적용 ===');
  logger.info(`입력: ${options.input}`);

  // LLM 옵션 설정
  const useLLM = options.llm || false;
  const llmFallback = options.llmFallback || false;
  let llmClient = null;
  
  // LLM 필요 시 클라이언트 초기화
  if (useLLM || llmFallback) {
    llmClient = new LLMClient();
    const connected = await llmClient.checkConnection();
    
    if (connected) {
      if (useLLM) {
        logger.info('🤖 LLM 모드: 모든 규칙에 LLM 적용');
      } else if (llmFallback) {
        logger.info('🤖 LLM 폴백 모드: 매칭 실패 시에만 LLM 자동 사용');
      }
    } else {
      logger.warn('⚠️ LLM 서버 연결 실패 - LLM 없이 진행합니다.');
      llmClient = null;
    }
  }

  // 1. 규칙 로드
  const inputPath = path.resolve('asset', 'rules', options.input);
  const inputData = await loadJsonFile(inputPath);
  const rules = Array.isArray(inputData) ? inputData : (inputData.guidelines.guidelines || []);
  
  const withCondition = rules.filter(r => r.tagCondition);
  const withoutCondition = rules.filter(r => !r.tagCondition);

  logger.info(`총 규칙: ${rules.length}개`);
  logger.info(`  - tagCondition 있음: ${withCondition.length}개 (스킵)`);
  logger.info(`  - tagCondition 없음: ${withoutCondition.length}개 (처리)`);

  if (withoutCondition.length === 0) {
    logger.info('\n✅ 모든 규칙에 이미 tagCondition이 있습니다.');
    return;
  }

  // 2. 분석
  const analyzer = new TagRequirementAnalyzer();
  await analyzer.initialize();
  const analysisResults = await analyzer.analyzeRules(withoutCondition, {
    useLLM: useLLM && !!llmClient
  });

  // 3. 매핑
  const mapper = new RuleTagMapper();
  await mapper.initialize({ llmClient });
  const mappings = await mapper.generateTagConditions(analysisResults, {
    useLLM: useLLM && !!llmClient,
    llmFallback: llmFallback && !!llmClient
  });

  // 4. 적용
  const updatedRules = rules.map(rule => {
    if (rule.tagCondition) return rule;  // 이미 있으면 스킵
    
    const ruleId = rule.ruleId || rule.id;
    const mapping = mappings.find(m => m.ruleId === ruleId);
    
    if (mapping && mapping.validated) {
      return {
        ...rule,
        tagCondition: mapping.tagCondition,
        _tagMapping: {
          strategy: mapping.strategy,
          generatedAt: new Date().toISOString()
        }
      };
    }
    return rule;
  });

  // 5. 저장
  const outputPath = options.output || options.input.replace('.json', '_tagged.json');
  const outputData = Array.isArray(inputData) 
    ? updatedRules 
    : { ...inputData, guidelines: updatedRules };
  
  await saveJsonData(outputData, outputPath, 'rule');

  // 6. 결과 요약
  const applied = updatedRules.filter(r => r.tagCondition).length;
  const strategies = {};
  
  // mappings가 유효한 배열인지 확인
  if (Array.isArray(mappings)) {
    for (const m of mappings) {
      if (m && m.strategy) {
        strategies[m.strategy] = (strategies[m.strategy] || 0) + 1;
      }
    }
  }
  
  console.log('\n=== 적용 결과 ===');
  console.log(`적용 전: ${withCondition.length}개`);
  console.log(`적용 후: ${applied}개`);
  console.log(`신규 적용: ${applied - withCondition.length}개`);
  
  console.log('\n=== 전략별 통계 ===');
  const strategyEntries = Object.entries(strategies);
  if (strategyEntries.length > 0) {
    strategyEntries.forEach(([strategy, count]) => {
      const emoji = strategy === 'fallback' ? '⚠️' : 
                    strategy.includes('llm') ? '🤖' : '✅';
      console.log(`  ${emoji} ${strategy}: ${count}개`);
    });
  } else {
    console.log('  (통계 없음)');
  }

  logger.info(`\n✅ 저장 완료: ${outputPath}`);
}

/**
 * 현재 tagCondition 상태 확인
 */
export async function checkTagConditionStatus(options) {
  logger.info('=== tagCondition 상태 확인 ===');
  logger.info(`입력: ${options.input}`);

  const inputData = await loadJsonFile(options.input);
  const rules = Array.isArray(inputData) ? inputData : (inputData.guidelines || []);

  const withCondition = [];
  const withoutCondition = [];
  const byCategory = {};

  for (const rule of rules) {
    const category = rule.category || 'unknown';
    byCategory[category] = byCategory[category] || { with: 0, without: 0 };

    if (rule.tagCondition) {
      withCondition.push(rule);
      byCategory[category].with++;
    } else {
      withoutCondition.push(rule);
      byCategory[category].without++;
    }
  }

  console.log('\n=== 전체 현황 ===');
  console.log(`총 규칙: ${rules.length}개`);
  console.log(`  ✅ tagCondition 있음: ${withCondition.length}개 (${(withCondition.length/rules.length*100).toFixed(0)}%)`);
  console.log(`  ❌ tagCondition 없음: ${withoutCondition.length}개 (${(withoutCondition.length/rules.length*100).toFixed(0)}%)`);

  console.log('\n=== 카테고리별 현황 ===');
  for (const [category, counts] of Object.entries(byCategory)) {
    const total = counts.with + counts.without;
    const pct = (counts.with / total * 100).toFixed(0);
    const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
    console.log(`  ${category}: ${bar} ${pct}% (${counts.with}/${total})`);
  }

  if (withCondition.length > 0) {
    console.log('\n=== tagCondition 예시 (최대 5개) ===');
    for (const rule of withCondition.slice(0, 5)) {
      console.log(`  📋 ${rule.ruleId}: ${rule.tagCondition}`);
    }
  }

  if (withoutCondition.length > 0) {
    console.log('\n=== tagCondition 없는 규칙 (최대 5개) ===');
    for (const rule of withoutCondition.slice(0, 5)) {
      console.log(`  ❓ ${rule.ruleId}: ${rule.title}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// 유틸리티 함수
// ═══════════════════════════════════════════════════════════════════

async function loadRulesFile(filePath) {
  const data = await loadJsonFile(filePath);
  
  if (Array.isArray(data)) return data;
  if (data.guidelines) return data.guidelines;
  if (data.rules) return data.rules;
  
  throw new Error('규칙 배열을 찾을 수 없습니다');
}

async function loadJsonFile(filePath) {
  const absolutePath = path.isAbsolute(filePath) 
    ? filePath 
    : path.join(process.cwd(), filePath);
  
  const content = await fs.readFile(absolutePath, 'utf-8');
  return JSON.parse(content);
}

export default {
  analyzeRules,
  generateTagConditions,
  applyTagConditions,
  checkTagConditionStatus
};