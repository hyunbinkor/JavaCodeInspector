import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from '../../config/config.js';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../utils/loggerUtils.js';
import { hostname } from 'os';

/**
 * Qdrant Vector DB Adapter
 */
export class QdrantAdapter {
  constructor() {
    this.client = this.initializeClient();
    this.codePatternCollectionName = config.vector.qdrant.collectionNamePattern
      .replace('{type}', 'pattern');
    this.guidelineCollectionName = config.vector.qdrant.collectionNamePattern
      .replace('{type}', 'guideline');
    this.vectorDimensions = config.vector.qdrant.vectorDimensions;
  }

  initializeClient() {
    const qdrantConfig = config.vector.qdrant;

    // URL에서 host, port, https 파싱 (호환성 보장)
    let host = qdrantConfig.host;
    let port = qdrantConfig.port;
    let https = qdrantConfig.https;

    // host/port가 없으면 url에서 파싱
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

    // API 키가 있으면 추가
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

    // 인덱스 생성
    await this.createPayloadIndices(this.codePatternCollectionName, [
      'issueRecordId',
      'category',
      'severity',
      'cyclomaticComplexity'
    ]);
  }

  async createGuidelineCollection() {
    const indexParams = config.vector.qdrant.indexParams;

    logger.info(`📋 Guideline 컬렉션 생성 파라미터:`);
    logger.info(`   - 벡터 차원: ${this.vectorDimensions}`);
    logger.info(`   - 거리 측정: Cosine`);

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

    // 인덱스 생성
    await this.createPayloadIndices(this.guidelineCollectionName, [
      'ruleId',
      'category',
      'checkType',
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

  async storePattern(dataset) {
    try {
      const id = uuidv4();

      // 벡터 준비
      let vector = dataset.embeddings?.combined_embedding;

      // 벡터 존재 여부 확인
      if (!vector || !Array.isArray(vector)) {
        console.warn(`⚠️ 벡터가 없어 더미 벡터 생성: ${dataset.issue_record_id}`);
        vector = this.createDummyVector();
      }

      // 벡터 차원 검증 (조정하지 않음)
      if (vector.length !== this.vectorDimensions) {
        logger.error(`❌ 벡터 차원 불일치: ${vector.length} !== ${this.vectorDimensions}`);
        logger.error(`   패턴 ID: ${dataset.issue_record_id}`);
        logger.error(`   ⚠️ 임베딩 생성 로직을 확인하세요`);

        // 에러 대신 경고만 표시하고 더미 벡터 사용
        console.warn(`   더미 벡터로 대체하여 저장 진행`);
        vector = this.createDummyVector();
      }

      // 벡터 유효성 검증
      if (!this.validateVector(vector)) {
        logger.error(`❌ 벡터에 유효하지 않은 값 포함: ${dataset.issue_record_id}`);
        throw new Error('Vector contains NaN, Infinity, or non-numeric values');
      }

      logger.info(`📊 벡터 정보: 차원=${vector.length}, 범위=[${Math.min(...vector).toFixed(4)}, ${Math.max(...vector).toFixed(4)}]`);

      // Payload 준비 - 모든 배열을 JSON 문자열로 변환
      const payload = {
        issueRecordId: dataset.issue_record_id,
        patternData: JSON.stringify(dataset),
        title: (dataset.metadata?.title || '').substring(0, 500), // 길이 제한
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

      logger.info(`📦 Payload 크기: ${JSON.stringify(payload).length} bytes`);

      const point = {
        id,
        vector,
        payload
      };

      logger.info(`💾 Qdrant에 저장 시도 중... (컬렉션: ${this.codePatternCollectionName})`);

      await this.client.upsert(this.codePatternCollectionName, {
        wait: true,
        points: [point]
      });

      logger.info(`✅ 패턴 저장 완료: ${dataset.issue_record_id}`);
    } catch (error) {
      logger.error(`❌ 패턴 저장 오류 (${dataset.issue_record_id}):`);
      logger.error(`   메시지: ${error.message}`);
      logger.error(`   상태 코드: ${error.status || 'N/A'}`);

      if (error.data) {
        logger.error('   상세 오류:', JSON.stringify(error.data, null, 2));
      }

      // 스택 트레이스 출력
      if (error.stack) {
        logger.error('   스택:', error.stack.split('\n').slice(0, 3).join('\n'));
      }

      throw error;
    }
  }

  /**
   * 벡터 유효성 검증
   */
  validateVector(vector) {
    if (!Array.isArray(vector) || vector.length === 0) {
      return false;
    }

    return vector.every(v => {
      return typeof v === 'number' &&
        !isNaN(v) &&
        isFinite(v);
    });
  }

  async searchSimilarPatterns(queryVector, limit = 5, threshold = 0.7) {
    try {
      // 검색 벡터 검증
      if (!this.validateVector(queryVector)) {
        logger.error('❌ 검색 벡터가 유효하지 않음');
        return [];
      }

      logger.info(`🔍 검색 시작: 차원=${queryVector.length}, threshold=${threshold}, limit=${limit}`);
      logger.info(`🔍 벡터 샘플: [${queryVector.slice(0, 5).map(v => v.toFixed(4)).join(', ')}...]`);

      const searchResult = await this.client.search(this.codePatternCollectionName, {
        vector: queryVector,
        limit,
        score_threshold: threshold,
        with_payload: true,
        with_vector: false  // 결과에 벡터 포함 안 함 (성능 향상)
      });

      logger.info(`✅ 검색 완료: ${searchResult.length}개 결과 발견`);

      if (searchResult.length > 0) {
        logger.info(`   최고 점수: ${searchResult[0].score.toFixed(4)}`);
        logger.info(`   최저 점수: ${searchResult[searchResult.length - 1].score.toFixed(4)}`);
      }

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
      if (error.data) {
        logger.error('   상세:', JSON.stringify(error.data, null, 2));
      }
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
          title: point.payload.title,
          anti_pattern: point.payload.antiPatternCode ? {
            code_template: point.payload.antiPatternCode,
            pattern_signature: {
              semantic_signature: point.payload.semanticSignature?.split(',') || []
            }
          } : null,
          recommended_pattern: point.payload.recommendedPatternCode ? {
            code_template: point.payload.recommendedPatternCode
          } : null
        };
      });
    } catch (error) {
      logger.error('전체 패턴 조회 오류:', error.message);
      return [];
    }
  }

  async storeGuideline(guideline) {
    try {
      const id = uuidv4();

      // ────────────────────────────────────────────────────────────────────
      // antiPatterns 처리 (신규)
      // ────────────────────────────────────────────────────────────────────
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

      // ────────────────────────────────────────────────────────────────────
      // goodPatterns 처리 (신규)
      // ────────────────────────────────────────────────────────────────────
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

      // ────────────────────────────────────────────────────────────────────
      // 레거시 patterns 처리 (기존 호환)
      // ────────────────────────────────────────────────────────────────────
      const patternsArray = (guideline.patterns || []).map(p => {
        if (typeof p === 'string') return p;
        if (p instanceof RegExp) return p.source;
        if (typeof p === 'object' && p.pattern) {
          return p.description ? `${p.pattern} (${p.description})` : p.pattern;
        }
        return JSON.stringify(p);
      });

      // 벡터 준비 및 차원 검증
      let vector = guideline.embedding || this.createDummyVector();
      if (vector.length !== this.vectorDimensions) {
        console.warn(`⚠️ 벡터 차원 불일치: ${vector.length} -> ${this.vectorDimensions} (더미 벡터 사용)`);
        vector = this.createDummyVector();
      }

      // 벡터 검증 및 정규화
      if (!this.validateVector(vector)) {
        console.warn(`⚠️ 가이드라인 벡터 유효하지 않음, 더미 벡터 사용`);
        vector = this.createDummyVector();
      }

      const point = {
        id,
        vector,
        payload: {
          ruleId: guideline.ruleId,
          ruleTitle: guideline.title,
          category: guideline.category,
          checkType: guideline.checkType,
          description: guideline.description || '',
          keywords: JSON.stringify(guideline.keywords || []),
          severity: guideline.severity,
          examples: JSON.stringify(guideline.examples || {}),

          // 패턴 필드
          antiPatterns: JSON.stringify(antiPatternsArray),
          goodPatterns: JSON.stringify(goodPatternsArray),
          astHints: JSON.stringify(guideline.astHints || {}),
          patterns: JSON.stringify(patternsArray),  // 레거시 호환

          // 메시지/메타
          message: guideline.message || '',
          parentChapter: guideline.parentChapter || '',
          isActive: guideline.isActive !== false,

          // ═══════════════════════════════════════════════════════════
          // 🆕 v3.1 신규 필드 (Unified Schema)
          // ═══════════════════════════════════════════════════════════

          /** 원래 checkType (마이그레이션 추적용) */
          originalCheckType: guideline.originalCheckType || null,

          /** AST 검사 기준 자연어 설명 (LLM용) */
          astDescription: guideline.astDescription || null,

          /** LLM 체크포인트 목록 */
          checkPoints: JSON.stringify(guideline.checkPoints || []),

          /** 태그 기반 필터링 조건 */
          tagCondition: guideline.tagCondition || null,

          /** 필수 태그 (v3.0) */
          requiredTags: JSON.stringify(guideline.requiredTags || []),

          /** 제외 태그 (v3.0) */
          excludeTags: JSON.stringify(guideline.excludeTags || [])
        }
      };

      await this.client.upsert(this.guidelineCollectionName, {
        wait: true,
        points: [point]
      });

      logger.info(`✅ 가이드라인 저장 완료: ${guideline.ruleId}`);
      logger.info(`   - checkType: ${guideline.checkType}`);
      logger.info(`   - antiPatterns: ${antiPatternsArray.length}, goodPatterns: ${goodPatternsArray.length}`);
      if (guideline.astDescription) {
        logger.info(`   - astDescription: ${guideline.astDescription.substring(0, 50)}...`);
      }
      if (guideline.checkPoints?.length > 0) {
        logger.info(`   - checkPoints: ${guideline.checkPoints.length}개`);
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


  async searchGuidelines(filters = {}) {
    try {
      const must = [];

      if (filters.category) {
        must.push({ key: 'category', match: { value: filters.category } });
      }

      if (filters.checkType) {
        must.push({ key: 'checkType', match: { value: filters.checkType } });
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

      return scrollResult.points.map(point => ({
        // 기본 필드
        ruleId: point.payload.ruleId,
        id: point.payload.ruleId,  // 하위 호환
        title: point.payload.ruleTitle,
        category: point.payload.category,
        checkType: point.payload.checkType,
        description: point.payload.description,
        keywords: this.parseJSON(point.payload.keywords),
        severity: point.payload.severity,
        examples: this.parseExamples(point.payload.examples),

        // 패턴 필드
        antiPatterns: this.parsePatternArray(point.payload.antiPatterns),
        goodPatterns: this.parsePatternArray(point.payload.goodPatterns),
        astHints: this.parseJSON(point.payload.astHints) || {},
        patterns: this.parseJSON(point.payload.patterns),  // 레거시 호환

        // 메시지/메타
        message: point.payload.message,
        isActive: point.payload.isActive,

        // ═══════════════════════════════════════════════════════════
        // 🆕 v3.1 신규 필드 (Unified Schema)
        // ═══════════════════════════════════════════════════════════

        /** 원래 checkType (마이그레이션 추적용) */
        originalCheckType: point.payload.originalCheckType || null,

        /** AST 검사 기준 자연어 설명 (LLM용) */
        astDescription: point.payload.astDescription || null,

        /** LLM 체크포인트 목록 */
        checkPoints: this.parseJSON(point.payload.checkPoints) || [],

        /** 태그 기반 필터링 조건 */
        tagCondition: point.payload.tagCondition || null,

        /** 필수 태그 (v3.0) */
        requiredTags: this.parseJSON(point.payload.requiredTags) || [],

        /** 제외 태그 (v3.0) */
        excludeTags: this.parseJSON(point.payload.excludeTags) || []
      }));
    } catch (error) {
      logger.error('가이드라인 검색 오류:', error.message);
      return [];
    }
  }

  async searchGuidelinesByKeywords(keywords, limit = 10) {
    try {
      const should = keywords.map(keyword => ({
        key: 'keywords',
        match: { text: keyword }
      }));

      const scrollResult = await this.client.scroll(this.guidelineCollectionName, {
        filter: { should },
        limit,
        with_payload: true,
        with_vector: false
      });

      return scrollResult.points.map(point => ({
        ruleId: point.payload.ruleId,
        id: point.payload.ruleId,  // 하위 호환
        title: point.payload.ruleTitle,
        category: point.payload.category,
        checkType: point.payload.checkType,
        description: point.payload.description,
        keywords: this.parseJSON(point.payload.keywords),
        severity: point.payload.severity,
        examples: this.parseExamples(point.payload.examples),

        // ✅ 신규 필드
        antiPatterns: this.parsePatternArray(point.payload.antiPatterns),
        goodPatterns: this.parsePatternArray(point.payload.goodPatterns),
        astHints: this.parseJSON(point.payload.astHints) || {},

        // 레거시 호환
        patterns: this.parseJSON(point.payload.patterns),

        message: point.payload.message
      }));
    } catch (error) {
      logger.error('키워드 기반 가이드라인 검색 오류:', error.message);
      return [];
    }
  }

  async updateGuidelineStatus(ruleId, isActive) {
    try {
      const searchResult = await this.client.scroll(this.guidelineCollectionName, {
        filter: {
          must: [{ key: 'ruleId', match: { value: ruleId } }]
        },
        limit: 1,
        with_payload: true
      });

      if (searchResult.points.length === 0) {
        throw new Error(`가이드라인을 찾을 수 없습니다: ${ruleId}`);
      }

      const point = searchResult.points[0];

      await this.client.setPayload(this.guidelineCollectionName, {
        payload: { isActive },
        points: [point.id]
      });

      logger.info(`✅ 가이드라인 상태 업데이트 완료: ${ruleId} -> ${isActive}`);
    } catch (error) {
      logger.error(`가이드라인 상태 업데이트 오류 (${ruleId}):`, error.message);
      throw error;
    }
  }

  async deleteGuideline(ruleId) {
    try {
      const searchResult = await this.client.scroll(this.guidelineCollectionName, {
        filter: {
          must: [{ key: 'ruleId', match: { value: ruleId } }]
        },
        limit: 1
      });

      if (searchResult.points.length === 0) {
        throw new Error(`가이드라인을 찾을 수 없습니다: ${ruleId}`);
      }

      const point = searchResult.points[0];

      await this.client.delete(this.guidelineCollectionName, {
        points: [point.id]
      });

      logger.info(`✅ 가이드라인 삭제 완료: ${ruleId}`);
    } catch (error) {
      logger.error(`가이드라인 삭제 오류 (${ruleId}):`, error.message);
      throw error;
    }
  }

  async searchByASTPattern(astSignature, limit = 5) {
    try {
      const scrollResult = await this.client.scroll(this.codePatternCollectionName, {
        filter: {
          must: [{
            key: 'astSignature',
            match: { text: astSignature }
          }]
        },
        limit,
        with_payload: true,
        with_vector: false
      });

      return scrollResult.points.map(point => ({
        issueRecordId: point.payload.issueRecordId,
        title: point.payload.title,
        category: point.payload.category,
        astSignature: point.payload.astSignature,
        cyclomaticComplexity: point.payload.cyclomaticComplexity,
        maxDepth: point.payload.maxDepth
      }));
    } catch (error) {
      logger.error('AST 패턴 검색 오류:', error.message);
      return [];
    }
  }

  async searchByComplexity(minComplexity, maxComplexity, limit = 10) {
    try {
      const scrollResult = await this.client.scroll(this.codePatternCollectionName, {
        filter: {
          must: [
            {
              key: 'cyclomaticComplexity',
              range: {
                gte: minComplexity,
                lte: maxComplexity
              }
            }
          ]
        },
        limit,
        with_payload: true,
        with_vector: false
      });

      return scrollResult.points.map(point => ({
        issueRecordId: point.payload.issueRecordId,
        title: point.payload.title,
        category: point.payload.category,
        cyclomaticComplexity: point.payload.cyclomaticComplexity,
        maxDepth: point.payload.maxDepth,
        qualityScore: point.payload.qualityScore
      }));
    } catch (error) {
      logger.error('복잡도 기반 검색 오류:', error.message);
      return [];
    }
  }

  async deletePattern(patternId) {
    try {
      await this.client.delete(this.codePatternCollectionName, {
        points: [patternId]
      });
      logger.info(`✅ 패턴 삭제 완료: ${patternId}`);
    } catch (error) {
      logger.error(`패턴 삭제 오류 (${patternId}):`, error.message);
      throw error;
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

  parseExamples(examplesString) {
    try {
      return JSON.parse(examplesString || '{}');
    } catch (error) {
      return {};
    }
  }

  parseJSON(jsonString) {
    try {
      return JSON.parse(jsonString || '[]');
    } catch (error) {
      return [];
    }
  }

  /**
 * 패턴 배열을 JSON에서 파싱하고 RegExp 객체로 변환
 * 
 * guidelineChecker.checkRegexRule()이 기대하는 형식:
 * [ { regex: RegExp, description: string }, ... ]
 * 
 * @param {string} jsonStr - JSON 문자열
 * @returns {Array<{regex: RegExp, description: string}>}
 */
  parsePatternArray(jsonStr) {
    if (!jsonStr) return [];

    try {
      const patterns = JSON.parse(jsonStr);
      if (!Array.isArray(patterns)) return [];

      return patterns.map(p => {
        try {
          // 객체 형태: { pattern: "...", flags: "g", description: "..." }
          if (typeof p === 'object' && p.pattern) {
            return {
              regex: new RegExp(p.pattern, p.flags || 'g'),
              description: p.description || ''
            };
          }
          // 문자열만 있는 경우
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

  async getSystemStats() {
    try {
      const patternInfo = await this.client.getCollection(this.codePatternCollectionName);
      const guidelineInfo = await this.client.getCollection(this.guidelineCollectionName);

      return {
        codePatterns: patternInfo.points_count || 0,
        guidelines: guidelineInfo.points_count || 0,
        totalObjects: (patternInfo.points_count || 0) + (guidelineInfo.points_count || 0)
      };
    } catch (error) {
      logger.error('시스템 상태 조회 오류:', error.message);
      return { codePatterns: 0, guidelines: 0, totalObjects: 0 };
    }
  }

  createDummyVector() {
    // 벡터가 없을 경우 더미 벡터 생성 (모든 값이 0)
    return new Array(this.vectorDimensions).fill(0);
  }

  // ============================================================
  // 1. 컬렉션 내 모든 패턴 삭제
  // ============================================================

  /**
   * CodePattern 컬렉션의 모든 데이터 삭제
   * 
   * @async
   * @returns {Promise<{deleted: number}>} 삭제된 포인트 수
   */
  async clearAllPatterns() {
    try {
      const collectionInfo = await this.client.getCollection(this.codePatternCollectionName);
      const pointsCount = collectionInfo.points_count || 0;

      if (pointsCount === 0) {
        logger.info('📭 삭제할 패턴이 없습니다.');
        return { deleted: 0 };
      }

      logger.info(`🗑️  ${pointsCount}개 패턴 삭제 시작...`);

      // 모든 포인트 삭제 (빈 필터 = 전체 선택)
      await this.client.delete(this.codePatternCollectionName, {
        filter: {
          must: []
        }
      });

      logger.info(`✅ ${pointsCount}개 패턴 삭제 완료`);
      return { deleted: pointsCount };

    } catch (error) {
      logger.error('❌ 패턴 전체 삭제 오류:', error.message);
      throw error;
    }
  }

  // ============================================================
  // 2. 특정 issueRecordId 목록으로 패턴 존재 여부 확인
  // ============================================================

  /**
   * 특정 issueRecordId들이 이미 저장되어 있는지 확인
   * 
   * @async
   * @param {string[]} issueRecordIds - 확인할 issueRecordId 배열
   * @returns {Promise<{exists: boolean, existingIds: string[], count: number}>}
   */
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

  // ============================================================
  // 3. 배치 패턴 저장 (기존 데이터 확인/삭제 옵션 포함)
  // ============================================================

  /**
   * 여러 패턴을 배치로 저장
   * 
   * @async
   * @param {Object[]} datasets - 저장할 패턴 데이터셋 배열
   * @param {Object} options - 저장 옵션
   * @param {boolean} options.clearExisting - true면 저장 전 기존 데이터 모두 삭제
   * @param {boolean} options.skipExisting - true면 이미 존재하는 패턴은 건너뛰기
   * @param {number} options.batchSize - 한 번에 저장할 배치 크기 (기본: 10)
   * @returns {Promise<{success: number, failed: number, skipped: number, errors: Array}>}
   */
  async batchStorePatterns(datasets, options = {}) {
    const {
      clearExisting = false,
      skipExisting = false,
      batchSize = 10
    } = options;

    const result = {
      success: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };

    try {
      logger.info(`\n${'='.repeat(60)}`);
      logger.info(`📦 배치 패턴 저장 시작: ${datasets.length}개`);
      logger.info(`   옵션: clearExisting=${clearExisting}, skipExisting=${skipExisting}`);
      logger.info(`${'='.repeat(60)}`);

      // 1. 기존 데이터 삭제 옵션 처리
      if (clearExisting) {
        logger.info('\n🗑️  기존 패턴 전체 삭제 중...');
        const clearResult = await this.clearAllPatterns();
        logger.info(`   삭제 완료: ${clearResult.deleted}개`);
      }

      // 2. 기존 데이터 건너뛰기 옵션 처리
      let datasetsToStore = datasets;
      if (skipExisting && !clearExisting) {
        const issueRecordIds = datasets.map(d => d.issue_record_id);
        const existCheck = await this.checkPatternsExist(issueRecordIds);

        if (existCheck.exists) {
          logger.info(`\n⚠️  이미 존재하는 패턴 발견: ${existCheck.count}개`);
          logger.info(`   건너뛸 ID: ${existCheck.existingIds.join(', ')}`);

          datasetsToStore = datasets.filter(
            d => !existCheck.existingIds.includes(d.issue_record_id)
          );
          result.skipped = existCheck.count;
        }
      }

      if (datasetsToStore.length === 0) {
        logger.info('\n📭 저장할 새 패턴이 없습니다.');
        return result;
      }

      // 3. 배치 단위로 저장
      logger.info(`\n💾 ${datasetsToStore.length}개 패턴 저장 시작...`);

      for (let i = 0; i < datasetsToStore.length; i += batchSize) {
        const batch = datasetsToStore.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(datasetsToStore.length / batchSize);

        logger.info(`\n📦 배치 ${batchNum}/${totalBatches} 처리 중... (${batch.length}개)`);

        const points = [];
        for (const dataset of batch) {
          try {
            const point = await this.preparePatternPoint(dataset);
            if (point) {
              points.push(point);
            }
          } catch (error) {
            result.failed++;
            result.errors.push({
              issueRecordId: dataset.issue_record_id,
              error: error.message
            });
            logger.error(`   ❌ ${dataset.issue_record_id}: ${error.message}`);
          }
        }

        if (points.length > 0) {
          try {
            await this.client.upsert(this.codePatternCollectionName, {
              wait: true,
              points
            });
            result.success += points.length;
            logger.info(`   ✅ ${points.length}개 저장 완료`);
          } catch (error) {
            result.failed += points.length;
            result.errors.push({
              batch: batchNum,
              error: error.message
            });
            logger.error(`   ❌ 배치 저장 실패: ${error.message}`);
          }
        }
      }

      // 4. 결과 요약
      logger.info(`\n${'='.repeat(60)}`);
      logger.info(`📊 배치 저장 결과:`);
      logger.info(`   ✅ 성공: ${result.success}개`);
      logger.info(`   ⏭️  건너뜀: ${result.skipped}개`);
      logger.info(`   ❌ 실패: ${result.failed}개`);
      logger.info(`${'='.repeat(60)}\n`);

      return result;

    } catch (error) {
      logger.error('❌ 배치 저장 오류:', error.message);
      throw error;
    }
  }

  // ============================================================
  // 4. 패턴 포인트 준비 헬퍼 메서드
  // ============================================================

  /**
   * 단일 패턴 데이터셋을 Qdrant 포인트로 변환
   * @private
   */
  async preparePatternPoint(dataset) {
    const id = uuidv4();

    let vector = dataset.embeddings?.combined_embedding;

    if (!vector || !Array.isArray(vector)) {
      logger.warn(`⚠️ 벡터가 없어 더미 벡터 생성: ${dataset.issue_record_id}`);
      vector = this.createDummyVector();
    }

    if (vector.length !== this.vectorDimensions) {
      logger.warn(`⚠️ 벡터 차원 불일치, 더미 벡터로 대체: ${dataset.issue_record_id}`);
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

  // ============================================================
  // 5. 패턴 개수 조회
  // ============================================================

  /**
   * CodePattern 컬렉션의 현재 포인트 수 조회
   * @async
   * @returns {Promise<number>}
   */
  async getPatternCount() {
    try {
      const collectionInfo = await this.client.getCollection(this.codePatternCollectionName);
      return collectionInfo.points_count || 0;
    } catch (error) {
      logger.error('❌ 패턴 수 조회 오류:', error.message);
      return 0;
    }
  }
}