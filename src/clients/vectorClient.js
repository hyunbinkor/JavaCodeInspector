/**
 * 통합 Vector DB 클라이언트 (VectorClient)
 * 
 * Adapter 패턴 기반 다중 VectorDB 지원
 * - Weaviate: 온프레미스 오픈소스 VectorDB (GraphQL)
 * - Qdrant: 고성능 Rust 기반 VectorDB (REST API)
 * 
 * 설정 기반 Provider 선택:
 * - config.vector.provider = 'weaviate' | 'qdrant'
 * - 런타임 provider 전환 불가 (재시작 필요)
 * 
 * 지원 기능:
 * 
 * 1. CodePattern 관리 (이슈 패턴 저장/검색):
 *    - storePattern() - 패턴 저장 (480차원 임베딩)
 *    - searchSimilarPatterns() - 코사인 유사도 검색 (threshold 0.7+)
 *    - getAllPatterns() - 전체 패턴 조회
 *    - deletePattern() - 패턴 삭제
 *    - searchByASTPattern() - AST 시그니처 검색
 *    - searchByComplexity() - 순환 복잡도 범위 검색
 * 
 * 2. Guideline 관리 (개발가이드 규칙):
 *    - storeGuideline() - 가이드라인 저장
 *    - searchGuidelines() - 필터 기반 검색
 *    - searchGuidelinesByKeywords() - 키워드 검색
 *    - updateGuidelineStatus() - 활성화/비활성화
 *    - deleteGuideline() - 가이드라인 삭제
 *    - batchImportGuidelines() - 배치 import (PDF 추출 결과 저장)
 * 
 * 3. 시스템 관리:
 *    - initializeSchema() - 스키마/컬렉션 초기화
 *    - checkConnection() - 연결 상태 확인
 *    - getSystemStats() - 통계 조회 (패턴 수, 가이드라인 수)
 *    - getProviderInfo() - Provider 정보 반환
 * 
 * 아키텍처 (Adapter 패턴):
 * ```
 * VectorClient (통합 인터페이스)
 *      │
 *      ├─> WeaviateAdapter (Weaviate 전용)
 *      │   ├─ weaviate-ts-client
 *      │   ├─ GraphQL 쿼리
 *      │   └─ Hybrid 검색 (BM25 + Vector)
 *      │
 *      └─> QdrantAdapter (Qdrant 전용)
 *          ├─ @qdrant/js-client-rest
 *          ├─ REST API
 *          └─ HNSW 인덱스
 * ```
 * 
 * 480차원 임베딩 구조:
 * - syntactic_embedding: 128차원 (AST 구조 - 클래스/메서드/변수)
 * - semantic_embedding: 256차원 (코드 의미 - 기능/로직)
 * - framework_embedding: 64차원 (프레임워크 사용 - Spring/MyBatis)
 * - context_embedding: 32차원 (비즈니스 컨텍스트 - 도메인 지식)
 * 
 * 코사인 유사도 임계값 가이드:
 * - 0.95+: 거의 동일 (같은 패턴의 변형)
 * - 0.85~0.95: 매우 유사 (같은 카테고리의 유사 패턴)
 * - 0.70~0.85: 유사 (관련 있는 패턴)
 * - 0.50~0.70: 약간 관련 (참고용)
 * - 0.50 미만: 관련 없음
 * 
 * 하위 호환성 속성/메서드:
 * - codePatternClassName → codePatternName (getter)
 * - guidelineClassName → guidelineName (getter)
 * - getClassObjectCount() → getSystemStats() 기반 구현
 * - parseExamples() → JSON 파싱 유틸리티
 * 
 * 호출 체인 예시:
 * 1. 패턴 저장:
 *    VectorClient.storePattern() 
 *    → adapter.storePattern() 
 *    → (Qdrant) client.upsert() or (Weaviate) GraphQL mutation
 * 
 * 2. 유사 패턴 검색:
 *    VectorClient.searchSimilarPatterns()
 *    → adapter.searchSimilarPatterns()
 *    → (Qdrant) client.search() or (Weaviate) nearVector query
 *    → 코사인 유사도 계산
 *    → threshold 이상 결과만 반환
 * 
 * 3. 배치 import:
 *    VectorClient.batchImportGuidelines()
 *    → for each guideline: storeGuideline()
 *    → adapter.storeGuideline()
 *    → 성공/실패 통계 반환
 * 
 * @module VectorClient
 * @requires WeaviateAdapter - Weaviate 어댑터
 * @requires QdrantAdapter - Qdrant 어댑터
 * @requires config - 시스템 설정 (provider, similarity threshold 등)
 * 
 * # TODO: Node.js → Python 변환
 * # TODO: WeaviateAdapter → weaviate-client (Python)
 * # TODO: QdrantAdapter → qdrant-client (Python)
 * # TODO: 비동기 컨텍스트 매니저 (async with) 지원
 * # TODO: Protocol 타입 힌팅 (Adapter 인터페이스 정의)
 * # NOTE: Provider 전환 시 스키마 호환성 보장 필요
 * # NOTE: 배치 import 시 메모리 사용량 주의 (한 번에 100개 이하 권장)
 * # NOTE: 금융권: 민감 정보 포함된 패턴 암호화 저장 고려
 * # PERFORMANCE: 유사도 검색 시 벡터 정규화 (L2 norm) 필수
 * # PERFORMANCE: 배치 upsert로 대량 저장 최적화 (10개씩 묶어서)
 * # PERFORMANCE: 검색 결과 캐싱 (동일 쿼리 반복 시, TTL 5분)
 * # PERFORMANCE: 인덱스 최적화 (HNSW M=16, EF=200 권장)
 */
import { config } from '../config.js';
import { WeaviateAdapter } from './adapters/weaviateAdapter.js';
import { QdrantAdapter } from './adapters/qdrantAdapter.js';
import logger from '../utils/loggerUtils.js'

/**
 * 통합 Vector DB 클라이언트 클래스
 * 
 * Weaviate와 Qdrant를 설정에 따라 선택적으로 사용하는 통합 인터페이스.
 * 외부에서는 항상 VectorClient만 사용하면 되며, 내부적으로 적절한 adapter를 호출.
 * 
 * 내부 구조:
 * - provider: string - 'weaviate' | 'qdrant' - 사용 중인 VectorDB
 * - adapter: WeaviateAdapter | QdrantAdapter - 실제 구현체
 * - codePatternName: string - CodePattern 컬렉션/클래스 이름
 * - guidelineName: string - Guideline 컬렉션/클래스 이름
 * 
 * 생명주기:
 * 1. new VectorClient() → provider 기반 adapter 초기화
 * 2. await initializeSchema() → 스키마/컬렉션 생성
 * 3. await checkConnection() → 연결 확인
 * 4. 반복 호출: store/search/update/delete 메서드
 * 5. await getSystemStats() → 통계 조회
 * 
 * @class
 * 
 * # TODO: Python 클래스 변환 시 Protocol 타입 사용
 * # TODO: async with 컨텍스트 매니저 구현
 * # PERFORMANCE: Adapter 인스턴스 싱글톤 패턴 (메모리 절약)
 */
export class VectorClient {
  /**
   * 생성자: Provider 기반 Adapter 초기화
   * 
   * 내부 흐름:
   * 1. config.vector.provider 읽기
   * 2. initializeAdapter() 호출 → WeaviateAdapter 또는 QdrantAdapter 생성
   * 3. 컬렉션/클래스 이름 설정 (codePatternName, guidelineName)
   * 4. Provider 정보 콘솔 출력
   * 
   * @constructor
   * @throws {Error} 지원하지 않는 provider인 경우
   * 
   * @example
   * // config.js에서 provider 설정
   * // vector: { provider: 'qdrant', ... }
   * const client = new VectorClient();
   * 
   * # TODO: Python __init__ 변환 시 타입 체크 추가
   */
  constructor() {
    this.provider = config.vector.provider;
    this.adapter = this.initializeAdapter();
    this.codePatternName = config.vector.codePatternName;
    this.guidelineName = config.vector.guidelineName;
    
    logger.info(`\n=== Vector DB 제공자: ${this.provider.toUpperCase()} ===`);
  }

  /**
   * 설정된 provider에 따라 적절한 adapter 초기화
   * 
   * Adapter 선택 로직:
   * - 'weaviate' → new WeaviateAdapter()
   *   - GraphQL 기반
   *   - Hybrid 검색 지원 (BM25 + Vector)
   *   - 온프레미스 배포 용이
   * 
   * - 'qdrant' → new QdrantAdapter()
   *   - REST API 기반
   *   - HNSW 인덱스
   *   - 고성능 벡터 검색
   * 
   * @returns {WeaviateAdapter|QdrantAdapter} 초기화된 adapter 인스턴스
   * @throws {Error} 지원하지 않는 provider인 경우
   * 
   * # TODO: Python 변환 시 Factory 패턴 적용
   */
  initializeAdapter() {
    switch (this.provider) {
      case 'weaviate':
        return new WeaviateAdapter();
      case 'qdrant':
        return new QdrantAdapter();
      default:
        throw new Error(`지원하지 않는 Vector DB provider: ${this.provider}`);
    }
  }

  /**
   * 스키마/컬렉션 초기화
   * 
   * 내부 흐름:
   * 1. adapter.initializeSchema() 호출
   * 2. (Weaviate) GraphQL 스키마 생성 또는 기존 스키마 확인
   * 3. (Qdrant) 컬렉션 생성 또는 기존 컬렉션 확인
   * 4. 인덱스 생성 (category, severity, ruleId 등)
   * 
   * @async
   * @returns {Promise<void>}
   * 
   * @example
   * const client = new VectorClient();
   * await client.initializeSchema();
   * 
   * # TODO: Python 변환 시 asyncio 사용
   * # NOTE: 기존 데이터가 있는 경우 스키마 변경 주의
   */
  async initializeSchema() {
    logger.info('📋 Vector DB 스키마 초기화 중...');
    return await this.adapter.initializeSchema();
  }

  /**
   * 연결 상태 확인
   * 
   * 내부 흐름:
   * 1. adapter.checkConnection() 호출
   * 2. (Weaviate) /v1/.well-known/ready 엔드포인트 확인
   * 3. (Qdrant) /collections 엔드포인트 확인
   * 
   * @async
   * @returns {Promise<boolean>} 연결 성공 여부
   * 
   * # PERFORMANCE: health check를 주기적으로 수행하여 연결 상태 모니터링
   */
  async checkConnection() {
    return await this.adapter.checkConnection();
  }

  /**
   * CodePattern 저장
   * 
   * 내부 흐름:
   * 1. dataset 검증 (embeddings.combined_embedding 존재 확인)
   * 2. adapter.storePattern(dataset) 호출
   * 3. (Qdrant) upsert API 호출 → 벡터 정규화 → payload 저장
   * 4. (Weaviate) GraphQL mutation → 벡터 저장 → 속성 저장
   * 
   * @async
   * @param {Object} dataset - 패턴 데이터셋
   * @param {string} dataset.issue_record_id - 고유 ID
   * @param {Object} dataset.metadata - 메타데이터
   * @param {Object} dataset.anti_pattern - 문제 패턴
   * @param {Object} dataset.recommended_pattern - 권장 패턴
   * @param {Object} dataset.embeddings - 임베딩 벡터
   * @param {Array<number>} dataset.embeddings.combined_embedding - 480차원 벡터
   * @returns {Promise<void>}
   * 
   * # TODO: Python 변환 시 Pydantic 모델 사용
   * # PERFORMANCE: 배치 upsert로 여러 패턴 동시 저장
   */
  async storePattern(dataset) {
    return await this.adapter.storePattern(dataset);
  }

  /**
   * 벡터 유사도 기반 패턴 검색
   * 
   * 내부 흐름:
   * 1. queryVector 검증 (480차원 확인)
   * 2. queryVector 정규화 (L2 norm)
   * 3. adapter.searchSimilarPatterns() 호출
   * 4. 코사인 유사도 계산
   * 5. threshold 이상인 결과만 필터링
   * 6. 유사도 높은 순으로 정렬
   * 
   * @async
   * @param {Array<number>} queryVector - 쿼리 벡터 (480차원)
   * @param {number} limit - 최대 결과 수 (기본값: 5)
   * @param {number|null} threshold - 유사도 임계값 (기본값: config 설정값)
   * @returns {Promise<Array<Object>>} 유사한 패턴 배열
   * 
   * @example
   * const embeddings = await generator.generateEmbeddings(code);
   * const similar = await client.searchSimilarPatterns(
   *   embeddings.combined_embedding,
   *   10,
   *   0.75
   * );
   * 
   * # TODO: Python 변환 시 NumPy 벡터 사용
   * # PERFORMANCE: 벡터 정규화 캐싱 (동일 쿼리 반복 시)
   */
  async searchSimilarPatterns(queryVector, limit = 5, threshold = null) {
    const similarityThreshold = threshold ?? config.vector.similarityThreshold;
    return await this.adapter.searchSimilarPatterns(queryVector, limit, similarityThreshold);
  }

  /**
   * 모든 패턴 조회
   * 
   * 내부 흐름:
   * 1. adapter.getAllPatterns(limit) 호출
   * 2. (Qdrant) scroll API로 대량 조회
   * 3. (Weaviate) GraphQL Get 쿼리
   * 4. 패턴 리스트 반환
   * 
   * @async
   * @param {number} limit - 최대 조회 수 (기본값: 100)
   * @returns {Promise<Array<Object>>} 패턴 배열
   * 
   * # NOTE: limit=100 초과 시 메모리 사용량 주의
   * # PERFORMANCE: 대량 조회 시 페이지네이션 사용
   */
  async getAllPatterns(limit = 100) {
    return await this.adapter.getAllPatterns(limit);
  }

  /**
   * 패턴 삭제
   * 
   * @async
   * @param {string} patternId - 패턴 ID
   * @returns {Promise<void>}
   */
  async deletePattern(patternId) {
    return await this.adapter.deletePattern(patternId);
  }

  /**
   * AST 패턴으로 검색
   * 
   * @async
   * @param {string} astSignature - AST 시그니처
   * @param {number} limit - 최대 결과 수
   * @returns {Promise<Array<Object>>} 매칭되는 패턴 배열
   */
  async searchByASTPattern(astSignature, limit = 5) {
    return await this.adapter.searchByASTPattern(astSignature, limit);
  }

  /**
   * 순환 복잡도 범위로 검색
   * 
   * @async
   * @param {number} minComplexity - 최소 복잡도
   * @param {number} maxComplexity - 최대 복잡도
   * @param {number} limit - 최대 결과 수
   * @returns {Promise<Array<Object>>} 매칭되는 패턴 배열
   */
  async searchByComplexity(minComplexity, maxComplexity, limit = 10) {
    return await this.adapter.searchByComplexity(minComplexity, maxComplexity, limit);
  }

  /**
   * Guideline 저장
   * 
   * @async
   * @param {Object} guideline - 가이드라인 데이터
   * @returns {Promise<void>}
   */
  async storeGuideline(guideline) {
    return await this.adapter.storeGuideline(guideline);
  }

  /**
   * Guideline 검색 (필터 조건)
   * 
   * @async
   * @param {Object} filters - 검색 필터
   * @returns {Promise<Array<Object>>} 가이드라인 배열
   */
  async searchGuidelines(filters = {}) {
    return await this.adapter.searchGuidelines(filters);
  }

  /**
   * 키워드 기반 Guideline 검색
   * 
   * @async
   * @param {Array<string>} keywords - 검색 키워드
   * @param {number} limit - 최대 결과 수
   * @returns {Promise<Array<Object>>} 가이드라인 배열
   */
  async searchGuidelinesByKeywords(keywords, limit = 10) {
    return await this.adapter.searchGuidelinesByKeywords(keywords, limit);
  }

  /**
   * Guideline 상태 업데이트
   * 
   * @async
   * @param {string} ruleId - 규칙 ID
   * @param {boolean} isActive - 활성화 여부
   * @returns {Promise<void>}
   */
  async updateGuidelineStatus(ruleId, isActive) {
    return await this.adapter.updateGuidelineStatus(ruleId, isActive);
  }

  /**
   * Guideline 삭제
   * 
   * @async
   * @param {string} ruleId - 규칙 ID
   * @returns {Promise<void>}
   */
  async deleteGuideline(ruleId) {
    return await this.adapter.deleteGuideline(ruleId);
  }

  /**
   * 배치 Guideline import
   * 
   * PDF 추출 결과를 VectorDB에 대량 저장.
   * 각 가이드라인을 순차적으로 저장하며 성공/실패 통계 수집.
   * 
   * 내부 흐름:
   * 1. guidelines 배열 순회
   * 2. 각 guideline에 대해 storeGuideline() 호출
   * 3. 성공 시 success 카운트 증가
   * 4. 실패 시 failed 카운트 증가 및 에러 정보 수집
   * 5. 최종 결과 반환 (success, failed, errors)
   * 
   * @async
   * @param {Array<Object>} guidelines - 가이드라인 배열
   * @returns {Promise<Object>} 결과 통계 { success, failed, errors }
   * 
   * @example
   * // PDF 추출 후 배치 import
   * const extractor = new GuidelineExtractor();
   * const guidelines = await extractor.extract('rules.pdf');
   * const result = await client.batchImportGuidelines(guidelines);
   * logger.info(`성공: ${result.success}, 실패: ${result.failed}`);
   * 
   * # NOTE: 대량 import 시 메모리 사용량 주의 (한 번에 100개 이하)
   * # PERFORMANCE: 배치 upsert로 최적화 가능 (adapter 구현 필요)
   */
  async batchImportGuidelines(guidelines) {
    logger.info(`📥 가이드라인 배치 import 시작: ${guidelines.length}개`);

    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    for (const guideline of guidelines) {
      try {
        await this.storeGuideline(guideline);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          ruleId: guideline.ruleId,
          error: error.message
        });
        logger.error(`가이드라인 저장 오류 (${guideline.ruleId}):`, error.message);
      }
    }

    logger.info(`✅ 배치 import 완료: 성공 ${results.success}개, 실패 ${results.failed}개`);

    if (results.errors.length > 0) {
      logger.info('실패한 가이드라인들:');
      results.errors.forEach(({ ruleId, error }) => {
        logger.info(`  - ${ruleId}: ${error}`);
      });
    }

    return results;
  }

  /**
   * 시스템 통계 조회
   * 
   * @async
   * @returns {Promise<Object>} 통계 정보 { codePatterns, guidelines }
   */
  async getSystemStats() {
    return await this.adapter.getSystemStats();
  }

  /**
   * 하위 호환성을 위한 별칭 메서드들
   * (기존 코드와의 호환성 유지)
   */
  
  // weaviateClient의 codePatternClassName 속성 호환
  get codePatternClassName() {
    return this.codePatternName;
  }

  // weaviateClient의 guidelineClassName 속성 호환
  get guidelineClassName() {
    return this.guidelineName;
  }

  // parseExamples 메서드 (adapter에서 사용되지만 외부 호출 가능성 대비)
  parseExamples(examplesString) {
    try {
      return JSON.parse(examplesString || '{}');
    } catch (error) {
      return {};
    }
  }

  /**
 * ===== 신규 메서드: 컴포넌트별 유사도 계산과 함께 검색 =====
 * 
 * Enhanced 임베딩 모드에서 사용
 * 전체 유사도뿐만 아니라 각 컴포넌트별 유사도도 함께 반환
 * 
 * @param {Array<number>} queryVector - 쿼리 벡터 (512차원)
 * @param {number} limit - 최대 결과 수
 * @param {number} threshold - 유사도 임계값 (기본값: 0.7)
 * @returns {Promise<Array<Object>>} 검색 결과 (component_scores 포함)
 */
  async searchWithComponentScores(queryVector, limit = 10, threshold = 0.7) {
    logger.info('🔍 컴포넌트별 유사도 검색 시작...');
    
    // 벡터 차원 확인
    const expectedDim = config.embedding?.dimensions?.total || 480;
    if (queryVector.length !== expectedDim) {
      logger.warn(`⚠️ 벡터 차원 불일치: ${queryVector.length} (예상: ${expectedDim})`);
    }
    
    // 기본 검색 (더 많은 후보 가져오기)
    const candidates = await this.adapter.searchSimilarPatterns(
      queryVector, 
      limit * 3,  // 후보를 많이 가져와서 필터링
      threshold * 0.8  // 낮은 threshold로 먼저 가져오기
    );
    
    logger.info(`  📊 후보 패턴: ${candidates.length}개`);
    
    // 각 후보에 대해 컴포넌트별 유사도 계산
    const resultsWithScores = [];
    
    for (const candidate of candidates) {
      try {
        // 저장된 패턴의 임베딩 벡터 가져오기
        const patternVector = this.extractEmbeddingVector(candidate);
        
        if (!patternVector || patternVector.length !== queryVector.length) {
          logger.warn(`  ⚠️ 패턴 ${candidate.id} 벡터 누락 또는 불일치`);
          continue;
        }
        
        // 컴포넌트별 유사도 계산
        const componentScores = this.calculateComponentSimilarities(
          queryVector, 
          patternVector
        );
        
        // 결과에 추가
        resultsWithScores.push({
          ...candidate,
          component_scores: componentScores,
          overall_score: candidate.score
        });
      } catch (error) {
        logger.warn(`  ⚠️ 패턴 ${candidate.id} 처리 실패:`, error.message);
      }
    }
    
    logger.info(`  ✅ 컴포넌트 점수 계산 완료: ${resultsWithScores.length}개`);
    
    // threshold 이상만 필터링
    const filtered = resultsWithScores.filter(r => r.overall_score >= threshold);
    
    // overall_score 기준 정렬
    filtered.sort((a, b) => b.overall_score - a.overall_score);
    
    // limit 개수만 반환
    return filtered.slice(0, limit);
  }

  /**
   * ===== 신규 메서드: 임베딩 벡터 추출 =====
   * 
   * @param {Object} pattern - VectorDB에서 가져온 패턴 객체
   * @returns {Array<number>|null} 임베딩 벡터
   */
  extractEmbeddingVector(pattern) {
    // Qdrant 형식
    if (pattern.vector) {
      return pattern.vector;
    }
    
    // Weaviate 형식
    if (pattern._additional?.vector) {
      return pattern._additional.vector;
    }
    
    // embeddings 필드에 있는 경우
    if (pattern.embeddings?.combined_embedding) {
      return pattern.embeddings.combined_embedding;
    }
    
    logger.warn('  ⚠️ 임베딩 벡터를 찾을 수 없음');
    return null;
  }

  /**
   * ===== 신규 메서드: 컴포넌트별 유사도 계산 =====
   * 
   * @param {Array<number>} queryVector - 쿼리 벡터
   * @param {Array<number>} patternVector - 패턴 벡터
   * @returns {Object} 컴포넌트별 유사도 { syntactic, semantic, framework, context }
   */
  calculateComponentSimilarities(queryVector, patternVector) {
    const dimensions = config.embedding?.dimensions || {
      syntactic: 128,
      semantic: 256,
      framework: 64,
      context: 32
    };
    
    let offset = 0;
    const scores = {};
    
    // Syntactic
    if (dimensions.syntactic > 0) {
      const qSyn = queryVector.slice(offset, offset + dimensions.syntactic);
      const pSyn = patternVector.slice(offset, offset + dimensions.syntactic);
      scores.syntactic = this.cosineSimilarity(qSyn, pSyn);
      offset += dimensions.syntactic;
    }
    
    // Semantic
    if (dimensions.semantic > 0) {
      const qSem = queryVector.slice(offset, offset + dimensions.semantic);
      const pSem = patternVector.slice(offset, offset + dimensions.semantic);
      scores.semantic = this.cosineSimilarity(qSem, pSem);
      offset += dimensions.semantic;
    }
    
    // Framework
    if (dimensions.framework > 0) {
      const qFra = queryVector.slice(offset, offset + dimensions.framework);
      const pFra = patternVector.slice(offset, offset + dimensions.framework);
      scores.framework = this.cosineSimilarity(qFra, pFra);
      offset += dimensions.framework;
    }
    
    // Context (Enhanced 모드일 때만)
    if (dimensions.context && dimensions.context > 0) {
      const qCtx = queryVector.slice(offset, offset + dimensions.context);
      const pCtx = patternVector.slice(offset, offset + dimensions.context);
      scores.context = this.cosineSimilarity(qCtx, pCtx);
    }
    
    return scores;
  }

  /**
   * ===== 신규 메서드: 코사인 유사도 계산 =====
   * 
   * @param {Array<number>} vecA - 벡터 A
   * @param {Array<number>} vecB - 벡터 B
   * @returns {number} 코사인 유사도 (0~1)
   */
  cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) {
      return 0;
    }
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }
    
    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);
    
    if (normA === 0 || normB === 0) {
      return 0;
    }
    
    return dotProduct / (normA * normB);
  }

  /**
   * ===== 신규 메서드: 카테고리별 threshold를 적용한 검색 =====
   * 
   * @param {Array<number>} queryVector - 쿼리 벡터
   * @param {string} category - 카테고리
   * @param {number} limit - 최대 결과 수
   * @param {Object} categoryThresholds - 카테고리별 threshold 설정
   * @returns {Promise<Array<Object>>} 필터링된 검색 결과
   */
  async searchWithCategoryThreshold(queryVector, category, limit, categoryThresholds) {
    logger.info(`🔍 카테고리별 threshold 검색: ${category}`);
    
    // 카테고리별 threshold 가져오기
    const thresholds = categoryThresholds[category] || categoryThresholds['_default'] || {
      syntactic: 0.65,
      semantic: 0.70,
      framework: 0.65,
      overall: 0.70
    };
    
    logger.info(`  📊 Threshold:`, thresholds);
    
    // 컴포넌트 점수와 함께 검색 (후보를 많이 가져오기)
    const candidates = await this.searchWithComponentScores(
      queryVector,
      limit * 3,
      thresholds.overall * 0.8  // 낮은 overall threshold로 먼저 가져오기
    );
    
    // 카테고리별 threshold 적용하여 필터링
    const filtered = candidates.filter(result => {
      const cs = result.component_scores;
      
      return result.overall_score >= thresholds.overall &&
              (cs.syntactic === undefined || cs.syntactic >= thresholds.syntactic) &&
              (cs.semantic === undefined || cs.semantic >= thresholds.semantic) &&
              (cs.framework === undefined || cs.framework >= thresholds.framework);
    });
    
    logger.info(`  ✅ 필터링 결과: ${filtered.length}/${candidates.length}개`);
    
    if (filtered.length > 0) {
      logger.info(`     최고 점수: overall=${filtered[0].overall_score.toFixed(3)}, ` +
                  `semantic=${filtered[0].component_scores.semantic?.toFixed(3) || 'N/A'}`);
    }
    
    // limit 개수만 반환
    return filtered.slice(0, limit);
  }

  /**
   * ===== 신규 메서드: 검색 결과 통계 =====
   * 
   * @param {Array<Object>} results - 검색 결과 (component_scores 포함)
   * @returns {Object} 통계 정보
   */
  getSearchStatistics(results) {
    if (results.length === 0) {
      return {
        count: 0,
        overall_avg: 0,
        component_avg: {}
      };
    }
    
    const stats = {
      count: results.length,
      overall_avg: 0,
      overall_min: 1,
      overall_max: 0,
      component_avg: {},
      component_min: {},
      component_max: {}
    };
    
    // Overall 점수 통계
    for (const result of results) {
      const score = result.overall_score || result.score || 0;
      stats.overall_avg += score;
      stats.overall_min = Math.min(stats.overall_min, score);
      stats.overall_max = Math.max(stats.overall_max, score);
      
      // Component 점수 통계
      if (result.component_scores) {
        for (const [component, score] of Object.entries(result.component_scores)) {
          if (score === undefined) continue;
          
          stats.component_avg[component] = (stats.component_avg[component] || 0) + score;
          stats.component_min[component] = Math.min(stats.component_min[component] || 1, score);
          stats.component_max[component] = Math.max(stats.component_max[component] || 0, score);
        }
      }
    }
    
    // 평균 계산
    stats.overall_avg /= results.length;
    
    for (const component in stats.component_avg) {
      stats.component_avg[component] /= results.length;
    }
      
    return stats;
  }

  /**
   * 모든 패턴 삭제
   * @async
   * @returns {Promise<{deleted: number}>}
   */
  async clearAllPatterns() {
    logger.info('🗑️  모든 패턴 삭제 요청...');
    return await this.adapter.clearAllPatterns();
  }

  /**
   * 패턴 존재 여부 확인
   * @async
   * @param {string[]} issueRecordIds
   * @returns {Promise<{exists: boolean, existingIds: string[], count: number}>}
   */
  async checkPatternsExist(issueRecordIds) {
    return await this.adapter.checkPatternsExist(issueRecordIds);
  }

  /**
   * 배치 패턴 저장
   * @async
   * @param {Object[]} datasets
   * @param {Object} options
   * @returns {Promise<{success: number, failed: number, skipped: number, errors: Array}>}
   */
  async batchStorePatterns(datasets, options = {}) {
    logger.info(`📦 배치 패턴 저장 시작: ${datasets.length}개`);
    return await this.adapter.batchStorePatterns(datasets, options);
  }

  /**
   * 패턴 개수 조회
   * @async
   * @returns {Promise<number>}
   */
  async getPatternCount() {
    return await this.adapter.getPatternCount();
  }
}