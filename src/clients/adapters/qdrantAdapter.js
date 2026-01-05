import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from '../../config/config.js';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../utils/loggerUtils.js';

/**
 * Qdrant Vector DB Adapter (v4.0)
 * 
 * v4.0 변경사항:
 * - checkType: pure_regex, llm_with_regex, llm_contextual, llm_with_ast
 * - checkTypeReason 필드 추가
 * 
 * @version 4.0
 */
export class QdrantAdapter {
  constructor() {
    this.client = this.initializeClient();
    this.codePatternCollectionName = config.vector.qdrant.collectionNamePattern
      .replace('{type}', 'pattern');
    this.guidelineCollectionName = config.vector.qdrant.collectionNamePattern
      .replace('{type}', 'guideline');
    this.vectorDimensions = config.vector.qdrant.vectorDimensions;

    // 🆕 v4.0 유효한 checkType
    this.validCheckTypes = ['pure_regex', 'llm_with_regex', 'llm_contextual', 'llm_with_ast'];
  }

  initializeClient() {
    const qdrantConfig = config.vector.qdrant;

    let host = qdrantConfig.host;
    let port = qdrantConfig.port;
    let https = qdrantConfig.https;

    if (!host && qdrantConfig.url) {
      try {
        const parsedUrl = new URL(qdrantConfig.url);
        host = parsedUrl.hostname;
        port = parseInt(parsedUrl.port) || (parsedUrl.protocol === 'https:' ? 443 : 6333);
        https = parsedUrl.protocol === 'https:';
      } catch (e) {
        logger.warn('⚠️ Qdrant URL 파싱 실패, 기본값 사용:', e.message);
        host = 'localhost';
        port = 6333;
        https = false;
      }
    }

    const clientOptions = {
      host: host || 'localhost',
      port: port || 6333,
      https: https || false,
      checkCompatibility: false
    };

    logger.info(`🔌 Qdrant 연결: ${clientOptions.https ? 'https' : 'http'}://${clientOptions.host}:${clientOptions.port}`);

    if (qdrantConfig.apiKey) {
      clientOptions.apiKey = qdrantConfig.apiKey;
      logger.info('🔐 Qdrant API Key 인증 사용');
    } else {
      logger.info('🔓 Qdrant 익명 접근 모드');
    }

    return new QdrantClient(clientOptions);
  }

  async initializeSchema() {
    try {
      // CodePattern 컬렉션 처리
      const patternExists = await this.collectionExists(this.codePatternCollectionName);
      if (patternExists) {
        logger.info(`✅ 기존 ${this.codePatternCollectionName} 컬렉션 확인됨`);
      } else {
        logger.info(`🔨 ${this.codePatternCollectionName} 컬렉션 생성 중...`);
        await this.createCodePatternCollection();
        logger.info(`✅ ${this.codePatternCollectionName} 컬렉션 생성 완료`);
      }

      // Guideline 컬렉션 처리
      const guidelineExists = await this.collectionExists(this.guidelineCollectionName);
      if (guidelineExists) {
        logger.info(`✅ 기존 ${this.guidelineCollectionName} 컬렉션 확인됨`);
      } else {
        logger.info(`🔨 ${this.guidelineCollectionName} 컬렉션 생성 중...`);
        await this.createGuidelineCollection();
        logger.info(`✅ ${this.guidelineCollectionName} 컬렉션 생성 완료`);
      }

      logger.info('✅ 모든 컬렉션 초기화 완료');
    } catch (error) {
      logger.error('❌ 컬렉션 초기화 실패:', error.message);
      throw error;
    }
  }

  async collectionExists(collectionName) {
    try {
      const collections = await this.client.getCollections();
      return collections.collections.some(c => c.name === collectionName);
    } catch (error) {
      logger.error(`컬렉션 존재 확인 오류 (${collectionName}):`, error.message);
      return false;
    }
  }

  async createCodePatternCollection() {
    const indexParams = config.vector.qdrant.indexParams;

    logger.info(`📋 CodePattern 컬렉션 생성 파라미터:`);
    logger.info(`   - 벡터 차원: ${this.vectorDimensions}`);
    logger.info(`   - 거리 측정: Cosine`);
    logger.info(`   - HNSW M: ${indexParams.m}`);
    logger.info(`   - HNSW EF: ${indexParams.ef_construct}`);

    await this.client.createCollection(this.codePatternCollectionName, {
      vectors: {
        size: this.vectorDimensions,
        distance: 'Cosine',
        hnsw_config: {
          m: indexParams.m,
          ef_construct: indexParams.ef_construct
        }
      },
      optimizers_config: {
        default_segment_number: 2
      },
      replication_factor: 1
    });

    await this.createPayloadIndices(this.codePatternCollectionName, [
      'issueRecordId',
      'category',
      'severity',
      'cyclomaticComplexity'
    ]);
  }

  /**
   * 🆕 v4.0: Guideline 컬렉션 생성 (checkType 인덱스 포함)
   */
  async createGuidelineCollection() {
    const indexParams = config.vector.qdrant.indexParams;

    logger.info(`📋 Guideline 컬렉션 생성 파라미터 (v4.0):`);
    logger.info(`   - 벡터 차원: ${this.vectorDimensions}`);
    logger.info(`   - 거리 측정: Cosine`);
    logger.info(`   - checkType 인덱스: ${this.validCheckTypes.join(', ')}`);

    await this.client.createCollection(this.guidelineCollectionName, {
      vectors: {
        size: this.vectorDimensions,
        distance: 'Cosine',
        hnsw_config: {
          m: indexParams.m,
          ef_construct: indexParams.ef_construct
        }
      },
      optimizers_config: {
        default_segment_number: 2
      },
      replication_factor: 1
    });

    // 인덱스 생성 (checkType 포함)
    await this.createPayloadIndices(this.guidelineCollectionName, [
      'ruleId',
      'category',
      'checkType',  // v4.0: pure_regex, llm_with_regex, llm_contextual, llm_with_ast
      'severity',
      'isActive'
    ]);
  }

  async createPayloadIndices(collectionName, fieldNames) {
    for (const fieldName of fieldNames) {
      try {
        await this.client.createPayloadIndex(collectionName, {
          field_name: fieldName,
          field_schema: 'keyword'
        });
      } catch (error) {
        console.warn(`인덱스 생성 경고 (${fieldName}):`, error.message);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🆕 v4.0: Guideline 저장 (checkTypeReason 추가)
  // ═══════════════════════════════════════════════════════════════════════════

  async storeGuideline(guideline) {
    try {
      const id = uuidv4();

      // antiPatterns 처리
      const antiPatternsArray = (guideline.antiPatterns || []).map(p => {
        if (typeof p === 'string') {
          return { pattern: p, flags: 'g', description: '' };
        }
        if (p instanceof RegExp) {
          return { pattern: p.source, flags: p.flags || 'g', description: '' };
        }
        if (typeof p === 'object' && p.pattern) {
          return {
            pattern: typeof p.pattern === 'string' ? p.pattern : p.pattern.source,
            flags: p.flags || (p.pattern.flags) || 'g',
            description: p.description || ''
          };
        }
        return null;
      }).filter(p => p !== null);

      // goodPatterns 처리
      const goodPatternsArray = (guideline.goodPatterns || []).map(p => {
        if (typeof p === 'string') {
          return { pattern: p, flags: 'g', description: '' };
        }
        if (p instanceof RegExp) {
          return { pattern: p.source, flags: p.flags || 'g', description: '' };
        }
        if (typeof p === 'object' && p.pattern) {
          return {
            pattern: typeof p.pattern === 'string' ? p.pattern : p.pattern.source,
            flags: p.flags || (p.pattern.flags) || 'g',
            description: p.description || ''
          };
        }
        return null;
      }).filter(p => p !== null);

      // 벡터 준비 및 차원 검증
      let vector = guideline.embedding || this.createDummyVector();
      if (vector.length !== this.vectorDimensions) {
        console.warn(`⚠️ 벡터 차원 불일치: ${vector.length} -> ${this.vectorDimensions} (더미 벡터 사용)`);
        vector = this.createDummyVector();
      }

      if (!this.validateVector(vector)) {
        console.warn(`⚠️ 가이드라인 벡터 유효하지 않음, 더미 벡터 사용`);
        vector = this.createDummyVector();
      }

      // 🆕 v4.0: checkType 검증
      let checkType = guideline.checkType || 'llm_contextual';
      if (!this.validCheckTypes.includes(checkType)) {
        logger.warn(`⚠️ 유효하지 않은 checkType: ${checkType} → llm_contextual로 변경`);
        checkType = 'llm_contextual';
      }

      const point = {
        id,
        vector,
        payload: {
          // 기본 필드
          ruleId: guideline.ruleId,
          ruleTitle: guideline.title,
          category: guideline.category,
          description: guideline.description || '',
          keywords: JSON.stringify(guideline.keywords || []),
          severity: guideline.severity,
          examples: JSON.stringify(guideline.examples || {}),

          // 🆕 v4.0 checkType 관련
          checkType: checkType,
          checkTypeReason: guideline.checkTypeReason || null,
          originalCheckType: guideline.originalCheckType || null,

          // 패턴 필드
          antiPatterns: JSON.stringify(antiPatternsArray),
          goodPatterns: JSON.stringify(goodPatternsArray),
          astHints: JSON.stringify(guideline.astHints || {}),

          // LLM 지원 필드
          astDescription: guideline.astDescription || null,
          checkPoints: JSON.stringify(guideline.checkPoints || []),

          // 메시지/메타
          message: guideline.message || '',
          isActive: guideline.isActive !== false,

          // 태그 기반 필터링
          tagCondition: guideline.tagCondition ? JSON.stringify(guideline.tagCondition) : null,
          requiredTags: JSON.stringify(guideline.requiredTags || []),
          excludeTags: JSON.stringify(guideline.excludeTags || []),

          // 메타데이터
          metadata: JSON.stringify(guideline.metadata || {}),
          createdAt: new Date().toISOString()
        }
      };

      await this.client.upsert(this.guidelineCollectionName, {
        wait: true,
        points: [point]
      });

      logger.info(`✅ 가이드라인 저장 완료: ${guideline.ruleId}`);
      logger.info(`   - checkType: ${checkType}`);
      logger.info(`   - antiPatterns: ${antiPatternsArray.length}, goodPatterns: ${goodPatternsArray.length}`);
      if (guideline.checkTypeReason) {
        logger.info(`   - checkTypeReason: ${guideline.checkTypeReason.substring(0, 50)}...`);
      }

      return id;
    } catch (error) {
      logger.error(`가이드라인 저장 오류 (${guideline.ruleId}):`, error.message);
      if (error.data) {
        logger.error('상세 오류:', JSON.stringify(error.data, null, 2));
      }
      throw error;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🆕 v4.0: Guideline 검색 (다중 checkType 지원)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 가이드라인 검색
   * 
   * @param {Object} filters - 필터 조건
   * @param {string} filters.category - 카테고리 필터
   * @param {string|string[]} filters.checkType - checkType 필터 (단일 또는 배열)
   * @param {boolean} filters.isActive - 활성화 상태 필터
   * @param {number} filters.limit - 결과 수 제한
   * @returns {Promise<array>} 가이드라인 배열
   */
  async searchGuidelines(filters = {}) {
    try {
      const must = [];

      if (filters.category) {
        must.push({ key: 'category', match: { value: filters.category } });
      }

      // 🆕 v4.0: 다중 checkType 지원
      if (filters.checkType) {
        if (Array.isArray(filters.checkType)) {
          // 배열인 경우 should 조건 사용
          if (filters.checkType.length === 1) {
            must.push({ key: 'checkType', match: { value: filters.checkType[0] } });
          } else if (filters.checkType.length > 1) {
            must.push({
              should: filters.checkType.map(ct => ({
                key: 'checkType',
                match: { value: ct }
              }))
            });
          }
        } else {
          must.push({ key: 'checkType', match: { value: filters.checkType } });
        }
      }

      if (filters.severity) {
        must.push({ key: 'severity', match: { value: filters.severity } });
      }

      if (filters.isActive !== undefined) {
        must.push({ key: 'isActive', match: { value: filters.isActive } });
      }

      const scrollResult = await this.client.scroll(this.guidelineCollectionName, {
        filter: must.length > 0 ? { must } : undefined,
        limit: filters.limit || 100,
        with_payload: true,
        with_vector: false
      });

      return scrollResult.points.map(point => this.parseGuidelinePayload(point.payload));
    } catch (error) {
      logger.error('가이드라인 검색 오류:', error.message);
      return [];
    }
  }

  /**
   * Payload를 가이드라인 객체로 변환
   */
  parseGuidelinePayload(payload) {
    return {
      // 기본 필드
      ruleId: payload.ruleId,
      id: payload.ruleId,  // 하위 호환
      title: payload.ruleTitle,
      category: payload.category,
      description: payload.description,
      keywords: this.parseJSON(payload.keywords),
      severity: payload.severity,
      examples: this.parseExamples(payload.examples),

      // 🆕 v4.0 checkType 관련
      checkType: payload.checkType,
      checkTypeReason: payload.checkTypeReason || null,
      originalCheckType: payload.originalCheckType || null,

      // 패턴 필드
      antiPatterns: this.parsePatternArray(payload.antiPatterns),
      goodPatterns: this.parsePatternArray(payload.goodPatterns),
      astHints: this.parseJSON(payload.astHints) || {},

      // LLM 지원 필드
      astDescription: payload.astDescription || null,
      checkPoints: this.parseJSON(payload.checkPoints) || [],

      // 메시지/메타
      message: payload.message,
      isActive: payload.isActive,

      // 태그 기반 필터링
      tagCondition: payload.tagCondition ? this.parseJSON(payload.tagCondition) : null,
      requiredTags: this.parseJSON(payload.requiredTags) || [],
      excludeTags: this.parseJSON(payload.excludeTags) || [],

      // 메타데이터
      metadata: this.parseJSON(payload.metadata) || {}
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CodePattern 관련 메서드 (기존 유지)
  // ═══════════════════════════════════════════════════════════════════════════

  async storePattern(dataset) {
    try {
      const id = uuidv4();

      let vector = dataset.embeddings?.combined_embedding;

      if (!vector || !Array.isArray(vector)) {
        console.warn(`⚠️ 벡터가 없어 더미 벡터 생성: ${dataset.issue_record_id}`);
        vector = this.createDummyVector();
      }

      if (vector.length !== this.vectorDimensions) {
        logger.error(`❌ 벡터 차원 불일치: ${vector.length} !== ${this.vectorDimensions}`);
        vector = this.createDummyVector();
      }

      if (!this.validateVector(vector)) {
        logger.error(`❌ 벡터에 유효하지 않은 값 포함: ${dataset.issue_record_id}`);
        throw new Error('Vector contains NaN, Infinity, or non-numeric values');
      }

      const payload = {
        issueRecordId: dataset.issue_record_id,
        patternData: JSON.stringify(dataset),
        title: (dataset.metadata?.title || '').substring(0, 500),
        category: dataset.metadata?.category || 'general',
        severity: dataset.metadata?.severity || 'MEDIUM',
        tags: JSON.stringify(dataset.metadata?.tags || []),
        antiPatternCode: (dataset.anti_pattern?.code_template || '').substring(0, 5000),
        recommendedPatternCode: (dataset.recommended_pattern?.code_template || '').substring(0, 5000),
        semanticSignature: String(dataset.anti_pattern?.pattern_signature?.semantic_signature || '').substring(0, 500),
        frameworkVersion: dataset.framework_context?.framework_version || 'unknown',
        occurrenceFrequency: Number(dataset.impact_analysis?.historical_data?.occurrence_frequency ?? 1),
        qualityScore: Number(dataset.validation_info?.quality_score ?? 0),
        astSignature: (dataset.embeddings?.ast_analysis?.signature || '').substring(0, 5000),
        astNodeTypes: JSON.stringify(dataset.embeddings?.ast_analysis?.nodeTypes || []),
        cyclomaticComplexity: Number(dataset.embeddings?.ast_analysis?.cyclomaticComplexity ?? 1),
        maxDepth: Number(dataset.embeddings?.ast_analysis?.maxDepth ?? 1)
      };

      const point = { id, vector, payload };

      await this.client.upsert(this.codePatternCollectionName, {
        wait: true,
        points: [point]
      });

      logger.info(`✅ 패턴 저장 완료: ${dataset.issue_record_id}`);
    } catch (error) {
      logger.error(`❌ 패턴 저장 오류 (${dataset.issue_record_id}):`, error.message);
      throw error;
    }
  }

  async searchSimilarPatterns(queryVector, limit = 5, threshold = 0.7) {
    try {
      if (!this.validateVector(queryVector)) {
        logger.error('❌ 검색 벡터가 유효하지 않음');
        return [];
      }

      const searchResult = await this.client.search(this.codePatternCollectionName, {
        vector: queryVector,
        limit,
        score_threshold: threshold,
        with_payload: true,
        with_vector: false
      });

      return searchResult.map(result => ({
        id: result.payload.issueRecordId,
        title: result.payload.title,
        category: result.payload.category,
        severity: result.payload.severity,
        semanticSignature: result.payload.semanticSignature,
        astSignature: result.payload.astSignature,
        cyclomaticComplexity: result.payload.cyclomaticComplexity,
        maxDepth: result.payload.maxDepth,
        qualityScore: result.payload.qualityScore,
        score: result.score,
        fullData: JSON.parse(result.payload.patternData || '{}')
      }));
    } catch (error) {
      logger.error('❌ 유사 패턴 검색 오류:', error.message);
      return [];
    }
  }

  async getAllPatterns(limit = 100) {
    try {
      const scrollResult = await this.client.scroll(this.codePatternCollectionName, {
        limit,
        with_payload: true,
        with_vector: false
      });

      return scrollResult.points.map(point => {
        if (point.payload.patternData) {
          try {
            return JSON.parse(point.payload.patternData);
          } catch (e) {
            console.warn('patternData 파싱 실패:', e.message);
          }
        }

        return {
          issue_record_id: point.payload.issueRecordId,
          issueRecordId: point.payload.issueRecordId,
          metadata: {
            title: point.payload.title,
            category: point.payload.category,
            severity: point.payload.severity
          },
          category: point.payload.category,
          title: point.payload.title
        };
      });
    } catch (error) {
      logger.error('전체 패턴 조회 오류:', error.message);
      return [];
    }
  }

  async clearAllPatterns() {
    try {
      const collectionInfo = await this.client.getCollection(this.codePatternCollectionName);
      const pointsCount = collectionInfo.points_count || 0;

      if (pointsCount === 0) {
        logger.info('📭 삭제할 패턴이 없습니다.');
        return { deleted: 0 };
      }

      logger.info(`🗑️  ${pointsCount}개 패턴 삭제 시작...`);

      await this.client.delete(this.codePatternCollectionName, {
        filter: { must: [] }
      });

      logger.info(`✅ ${pointsCount}개 패턴 삭제 완료`);
      return { deleted: pointsCount };

    } catch (error) {
      logger.error('❌ 패턴 전체 삭제 오류:', error.message);
      throw error;
    }
  }

  async checkPatternsExist(issueRecordIds) {
    try {
      if (!issueRecordIds || issueRecordIds.length === 0) {
        return { exists: false, existingIds: [], count: 0 };
      }

      const existingIds = [];

      for (const issueRecordId of issueRecordIds) {
        const searchResult = await this.client.scroll(this.codePatternCollectionName, {
          filter: {
            must: [{ key: 'issueRecordId', match: { value: issueRecordId } }]
          },
          limit: 1,
          with_payload: false
        });

        if (searchResult.points.length > 0) {
          existingIds.push(issueRecordId);
        }
      }

      return {
        exists: existingIds.length > 0,
        existingIds,
        count: existingIds.length
      };

    } catch (error) {
      logger.error('❌ 패턴 존재 확인 오류:', error.message);
      throw error;
    }
  }

  async preparePatternPoint(dataset) {
    const id = uuidv4();

    let vector = dataset.embeddings?.combined_embedding;

    if (!vector || !Array.isArray(vector)) {
      vector = this.createDummyVector();
    }

    if (vector.length !== this.vectorDimensions) {
      vector = this.createDummyVector();
    }

    if (!this.validateVector(vector)) {
      throw new Error('Vector contains NaN, Infinity, or non-numeric values');
    }

    const payload = {
      issueRecordId: dataset.issue_record_id,
      patternData: JSON.stringify(dataset),
      title: (dataset.metadata?.title || '').substring(0, 500),
      category: dataset.metadata?.category || 'general',
      severity: dataset.metadata?.severity || 'MEDIUM',
      tags: JSON.stringify(dataset.metadata?.tags || []),
      antiPatternCode: (dataset.anti_pattern?.code_template || '').substring(0, 5000),
      recommendedPatternCode: (dataset.recommended_pattern?.code_template || '').substring(0, 5000),
      semanticSignature: (dataset.anti_pattern?.pattern_signature?.semantic_signature || '').substring(0, 500),
      frameworkVersion: dataset.framework_context?.framework_version || 'unknown',
      occurrenceFrequency: Number(dataset.validation_info?.historical_data?.occurrence_frequency ?? 1),
      qualityScore: Number(dataset.validation_info?.quality_score ?? 0),
      astSignature: (dataset.embeddings?.ast_analysis?.signature || '').substring(0, 5000),
      astNodeTypes: JSON.stringify(dataset.embeddings?.ast_analysis?.nodeTypes || []),
      cyclomaticComplexity: Number(dataset.embeddings?.ast_analysis?.cyclomaticComplexity ?? 1),
      maxDepth: Number(dataset.embeddings?.ast_analysis?.maxDepth ?? 1)
    };

    return { id, vector, payload };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 유틸리티 메서드
  // ═══════════════════════════════════════════════════════════════════════════

  validateVector(vector) {
    if (!Array.isArray(vector) || vector.length === 0) {
      return false;
    }

    return vector.every(v => {
      return typeof v === 'number' && !isNaN(v) && isFinite(v);
    });
  }

  createDummyVector() {
    return new Array(this.vectorDimensions).fill(0);
  }

  parseExamples(examplesString) {
    try {
      return JSON.parse(examplesString || '{}');
    } catch (error) {
      return {};
    }
  }

  parseJSON(jsonString) {
    try {
      if (typeof jsonString === 'object') return jsonString;
      return JSON.parse(jsonString || '[]');
    } catch (error) {
      return Array.isArray(jsonString) ? jsonString : [];
    }
  }

  parsePatternArray(jsonStr) {
    if (!jsonStr) return [];

    try {
      const patterns = JSON.parse(jsonStr);
      if (!Array.isArray(patterns)) return [];

      return patterns.map(p => {
        try {
          if (typeof p === 'object' && p.pattern) {
            return {
              regex: new RegExp(p.pattern, p.flags || 'g'),
              description: p.description || ''
            };
          }
          if (typeof p === 'string') {
            return {
              regex: new RegExp(p, 'g'),
              description: ''
            };
          }
          return null;
        } catch (e) {
          console.warn(`패턴 RegExp 변환 실패: ${JSON.stringify(p)} - ${e.message}`);
          return null;
        }
      }).filter(p => p !== null);
    } catch (e) {
      console.warn(`패턴 배열 JSON 파싱 실패: ${e.message}`);
      return [];
    }
  }

  async checkConnection() {
    try {
      await this.client.getCollections();
      logger.info('✅ Qdrant 연결 성공');
      return true;
    } catch (error) {
      logger.error('Qdrant 연결 실패:', error.message);
      return false;
    }
  }
}

export default QdrantAdapter;