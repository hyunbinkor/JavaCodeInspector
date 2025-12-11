/**
 * 태그 정의 로더 (TagDefinitionLoader)
 * 
 * JSON 파일에서 태그 정의를 로드하고 캐싱하여 제공
 * 싱글톤 패턴으로 구현하여 중복 로드 방지
 * 
 * @module profiler/TagDefinitionLoader
 * @version 1.0.0
 */

import fs from 'fs/promises';
import path from 'path';
import logger from '../utils/loggerUtils.js';

/**
 * 태그 정의 로더 클래스
 * 
 * 주요 기능:
 * - JSON 파일에서 태그 정의 로드
 * - 태그 정의 유효성 검증
 * - 티어별/카테고리별 태그 필터링
 * - 싱글톤 캐싱
 */
class TagDefinitionLoader {
  constructor() {
    /** @type {Object|null} 로드된 태그 정의 */
    this.definitions = null;
    
    /** @type {boolean} 초기화 완료 여부 */
    this.initialized = false;
    
    /** @type {string} 태그 정의 파일 경로 */
    this.definitionPath = null;
    
    /** @type {Map<string, Object>} 태그명으로 빠른 조회를 위한 맵 */
    this.tagMap = new Map();
    
    /** @type {Map<string, string[]>} 카테고리별 태그 목록 */
    this.categoryIndex = new Map();
    
    /** @type {Map<number, string[]>} 티어별 태그 목록 */
    this.tierIndex = new Map();
  }

  /**
   * 초기화 - 태그 정의 파일 로드
   * 
   * @param {string} [customPath] - 커스텀 정의 파일 경로 (선택)
   * @returns {Promise<boolean>} 초기화 성공 여부
   */
  async initialize(customPath = null) {
    if (this.initialized && !customPath) {
      logger.debug('TagDefinitionLoader: 이미 초기화됨, 캐시 사용');
      return true;
    }

    try {
      // 정의 파일 경로 결정
      this.definitionPath = customPath || 
        process.env.TAG_DEFINITIONS_PATH ||
        path.join(process.cwd(), 'config', 'tag-definitions.json');

      logger.info(`📋 태그 정의 로드 중: ${this.definitionPath}`);

      // JSON 파일 로드
      const content = await fs.readFile(this.definitionPath, 'utf-8');
      this.definitions = JSON.parse(content);

      // 유효성 검증
      this.validateDefinitions();

      // 인덱스 구축
      this.buildIndices();

      this.initialized = true;
      
      const stats = this.getStats();
      logger.info(`✅ 태그 정의 로드 완료: ${stats.totalTags}개 태그`);
      logger.info(`   - Tier 1 (정규식/AST): ${stats.tier1Count}개`);
      logger.info(`   - Tier 2 (LLM): ${stats.tier2Count}개`);
      logger.info(`   - 복합 태그: ${stats.compoundCount}개`);

      return true;

    } catch (error) {
      logger.error(`❌ 태그 정의 로드 실패: ${error.message}`);
      
      // 기본 정의로 폴백
      this.loadDefaultDefinitions();
      this.initialized = true;
      
      return false;
    }
  }

  /**
   * 태그 정의 유효성 검증
   * 
   * @throws {Error} 유효하지 않은 정의인 경우
   */
  validateDefinitions() {
    if (!this.definitions) {
      throw new Error('태그 정의가 null입니다');
    }

    if (!this.definitions.tags || typeof this.definitions.tags !== 'object') {
      throw new Error('tags 필드가 없거나 유효하지 않습니다');
    }

    const requiredFields = ['category', 'description', 'extractionMethod', 'tier', 'detection'];
    const errors = [];

    for (const [tagName, tagDef] of Object.entries(this.definitions.tags)) {
      // 태그명 형식 검증 (대문자 + 언더스코어)
      if (!/^[A-Z][A-Z0-9_]*$/.test(tagName)) {
        errors.push(`태그명 형식 오류: ${tagName} (대문자와 언더스코어만 허용)`);
      }

      // 필수 필드 검증
      for (const field of requiredFields) {
        if (!(field in tagDef)) {
          errors.push(`${tagName}: 필수 필드 누락 - ${field}`);
        }
      }

      // tier 값 검증
      if (tagDef.tier && ![1, 2].includes(tagDef.tier)) {
        errors.push(`${tagName}: tier 값 오류 (1 또는 2만 허용)`);
      }

      // detection.type 검증
      const validTypes = ['regex', 'ast', 'ast_context', 'llm'];
      if (tagDef.detection && !validTypes.includes(tagDef.detection.type)) {
        errors.push(`${tagName}: detection.type 오류 (${validTypes.join('/')} 만 허용)`);
      }
    }

    if (errors.length > 0) {
      logger.warn(`⚠️ 태그 정의 검증 경고 (${errors.length}개):`);
      errors.slice(0, 5).forEach(err => logger.warn(`   - ${err}`));
      if (errors.length > 5) {
        logger.warn(`   ... 외 ${errors.length - 5}개`);
      }
    }
  }

  /**
   * 빠른 조회를 위한 인덱스 구축
   */
  buildIndices() {
    this.tagMap.clear();
    this.categoryIndex.clear();
    this.tierIndex.clear();

    for (const [tagName, tagDef] of Object.entries(this.definitions.tags)) {
      // 태그 맵
      this.tagMap.set(tagName, tagDef);

      // 카테고리 인덱스
      const category = tagDef.category || 'unknown';
      if (!this.categoryIndex.has(category)) {
        this.categoryIndex.set(category, []);
      }
      this.categoryIndex.get(category).push(tagName);

      // 티어 인덱스
      const tier = tagDef.tier || 1;
      if (!this.tierIndex.has(tier)) {
        this.tierIndex.set(tier, []);
      }
      this.tierIndex.get(tier).push(tagName);
    }
  }

  /**
   * 기본 태그 정의 (폴백용)
   */
  loadDefaultDefinitions() {
    logger.warn('⚠️ 기본 태그 정의 사용 (최소 기능만 지원)');
    
    this.definitions = {
      _metadata: { version: '0.0.1', description: 'Default fallback definitions' },
      tags: {
        IS_CONTROLLER: {
          category: 'structure',
          description: '@Controller 클래스',
          extractionMethod: 'regex',
          tier: 1,
          detection: { type: 'regex', patterns: ['@Controller\\b', '@RestController\\b'] }
        },
        IS_SERVICE: {
          category: 'structure',
          description: '@Service 클래스',
          extractionMethod: 'regex',
          tier: 1,
          detection: { type: 'regex', patterns: ['@Service\\b'] }
        },
        USES_CONNECTION: {
          category: 'resource',
          description: 'JDBC Connection 사용',
          extractionMethod: 'regex',
          tier: 1,
          detection: { type: 'regex', patterns: ['Connection\\s+\\w+', 'getConnection\\s*\\('] }
        }
      },
      compoundTags: {},
      triggerConditions: {}
    };

    this.buildIndices();
  }

  /**
   * 모든 태그 정의 반환
   * 
   * @returns {Object} 전체 태그 정의
   */
  getAllDefinitions() {
    return this.definitions;
  }

  /**
   * 특정 태그 정의 반환
   * 
   * @param {string} tagName - 태그명
   * @returns {Object|null} 태그 정의 또는 null
   */
  getTagDefinition(tagName) {
    return this.tagMap.get(tagName) || null;
  }

  /**
   * 모든 태그명 목록 반환
   * 
   * @returns {string[]} 태그명 배열
   */
  getAllTagNames() {
    return Array.from(this.tagMap.keys());
  }

  /**
   * 특정 티어의 태그 목록 반환
   * 
   * @param {number} tier - 티어 (1 또는 2)
   * @returns {string[]} 해당 티어의 태그명 배열
   */
  getTagsByTier(tier) {
    return this.tierIndex.get(tier) || [];
  }

  /**
   * Tier 1 태그 (정규식/AST) 목록 반환
   * 
   * @returns {Object[]} Tier 1 태그 정의 배열
   */
  getTier1Tags() {
    const tagNames = this.getTagsByTier(1);
    return tagNames.map(name => ({
      name,
      ...this.tagMap.get(name)
    }));
  }

  /**
   * Tier 2 태그 (LLM) 목록 반환
   * 
   * @returns {Object[]} Tier 2 태그 정의 배열
   */
  getTier2Tags() {
    const tagNames = this.getTagsByTier(2);
    return tagNames.map(name => ({
      name,
      ...this.tagMap.get(name)
    }));
  }

  /**
   * 특정 카테고리의 태그 목록 반환
   * 
   * @param {string} category - 카테고리명
   * @returns {string[]} 해당 카테고리의 태그명 배열
   */
  getTagsByCategory(category) {
    return this.categoryIndex.get(category) || [];
  }

  /**
   * 모든 카테고리 목록 반환
   * 
   * @returns {string[]} 카테고리명 배열
   */
  getAllCategories() {
    return Array.from(this.categoryIndex.keys());
  }

  /**
   * 복합 태그 정의 반환
   * 
   * @returns {Object} 복합 태그 정의
   */
  getCompoundTags() {
    return this.definitions.compoundTags || {};
  }

  /**
   * 특정 복합 태그 정의 반환
   * 
   * @param {string} compoundTagName - 복합 태그명
   * @returns {Object|null} 복합 태그 정의 또는 null
   */
  getCompoundTag(compoundTagName) {
    return this.definitions.compoundTags?.[compoundTagName] || null;
  }

  /**
   * 트리거 조건 정의 반환
   * 
   * @returns {Object} 트리거 조건 정의
   */
  getTriggerConditions() {
    return this.definitions.triggerConditions || {};
  }

  /**
   * Tier 1 태그 집합에 기반하여 필요한 Tier 2 태그 결정
   * 
   * @param {Set<string>} tier1Tags - Tier 1에서 추출된 태그 집합
   * @returns {string[]} 평가가 필요한 Tier 2 태그 목록
   */
  getRequiredTier2Tags(tier1Tags) {
    const requiredTier2 = new Set();
    const triggerConditions = this.getTriggerConditions();

    for (const [conditionName, condition] of Object.entries(triggerConditions)) {
      // Tier 1 태그 중 하나라도 트리거 조건에 해당하면
      const hasTrigger = condition.tier1Tags?.some(t => tier1Tags.has(t));
      
      if (hasTrigger) {
        condition.tier2Tags?.forEach(t => requiredTier2.add(t));
      }
    }

    return Array.from(requiredTier2);
  }

  /**
   * 특정 태그의 detection 정보 반환
   * 
   * @param {string} tagName - 태그명
   * @returns {Object|null} detection 정보 또는 null
   */
  getDetectionInfo(tagName) {
    const tagDef = this.tagMap.get(tagName);
    return tagDef?.detection || null;
  }

  /**
   * 정규식 기반 태그만 필터링
   * 
   * @returns {Object[]} 정규식 기반 태그 정의 배열
   */
  getRegexBasedTags() {
    return this.getTier1Tags().filter(tag => tag.detection?.type === 'regex');
  }

  /**
   * AST 기반 태그만 필터링
   * 
   * @returns {Object[]} AST 기반 태그 정의 배열
   */
  getASTBasedTags() {
    return this.getTier1Tags().filter(tag => 
      tag.detection?.type === 'ast' || tag.detection?.type === 'ast_context'
    );
  }

  /**
   * 통계 정보 반환
   * 
   * @returns {Object} 통계 정보
   */
  getStats() {
    const tier1 = this.getTagsByTier(1);
    const tier2 = this.getTagsByTier(2);
    const compound = Object.keys(this.definitions.compoundTags || {});

    return {
      totalTags: this.tagMap.size,
      tier1Count: tier1.length,
      tier2Count: tier2.length,
      compoundCount: compound.length,
      categories: this.getAllCategories(),
      version: this.definitions._metadata?.version || 'unknown'
    };
  }

  /**
   * 태그 정의 새로고침 (파일 변경 시)
   * 
   * @returns {Promise<boolean>} 새로고침 성공 여부
   */
  async refresh() {
    this.initialized = false;
    return this.initialize(this.definitionPath);
  }

  /**
   * 태그 정의 내보내기 (디버깅용)
   * 
   * @param {string} outputPath - 출력 파일 경로
   * @returns {Promise<void>}
   */
  async exportDefinitions(outputPath) {
    const exportData = {
      ...this.definitions,
      _exportedAt: new Date().toISOString(),
      _stats: this.getStats()
    };

    await fs.writeFile(outputPath, JSON.stringify(exportData, null, 2), 'utf-8');
    logger.info(`태그 정의 내보내기 완료: ${outputPath}`);
  }
}

// 싱글톤 인스턴스
let instance = null;

/**
 * 싱글톤 인스턴스 반환
 * 
 * @returns {TagDefinitionLoader} 싱글톤 인스턴스
 */
export function getTagDefinitionLoader() {
  if (!instance) {
    instance = new TagDefinitionLoader();
  }
  return instance;
}

/**
 * 새 인스턴스 생성 (테스트용)
 * 
 * @returns {TagDefinitionLoader} 새 인스턴스
 */
export function createTagDefinitionLoader() {
  return new TagDefinitionLoader();
}

export { TagDefinitionLoader };
export default getTagDefinitionLoader;
