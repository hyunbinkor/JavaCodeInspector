/**
 * 통합 Vector DB 클라이언트 (VectorClient) v4.0
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
 * 
 * 3. 시스템 관리:
 *    - initializeSchema() - 스키마/컬렉션 초기화
 *    - checkConnection() - 연결 상태 확보
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
 * @module VectorClient
 * @version 4.0.0
 * @requires WeaviateAdapter - Weaviate 어댑터
 * @requires QdrantAdapter - Qdrant 어댑터 (v4.0)
 * @requires config - 시스템 설정 (provider, similarity threshold 등)
 */
import { config } from '../config/config.js';
import { WeaviateAdapter } from './adapters/weaviateAdapter.js';
import { QdrantAdapter } from './adapters/qdrantAdapter.js';
import logger from '../utils/loggerUtils.js'

/**
 * 통합 Vector DB 클라이언트 클래스 (v4.0)
 * 
 * Weaviate와 Qdrant를 설정에 따라 선택적으로 사용하는 통합 인터페이스.
 * 외부에서는 항상 VectorClient만 사용하면 되며, 내부적으로 적절한 adapter를 호출.
 * 
 * @class
 */
export class VectorClient {
    /**
     * 생성자: Provider 기반 Adapter 초기화
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
     */
    async initializeSchema() {
        logger.info('📋 Vector DB 스키마 초기화 중...');
        return await this.adapter.initializeSchema();
    }

    /**
     * 연결 상태 확인
     */
    async checkConnection() {
        return await this.adapter.checkConnection();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CodePattern 관리
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * CodePattern 저장
     */
    async storePattern(dataset) {
        return await this.adapter.storePattern(dataset);
    }

    /**
     * 벡터 유사도 기반 패턴 검색
     */
    async searchSimilarPatterns(queryVector, limit = 5, threshold = null) {
        const similarityThreshold = threshold ?? config.vector.similarityThreshold;
        return await this.adapter.searchSimilarPatterns(queryVector, limit, similarityThreshold);
    }

    /**
     * 모든 패턴 조회
     */
    async getAllPatterns(limit = 100) {
        return await this.adapter.getAllPatterns(limit);
    }

    /**
     * 모든 패턴 삭제
     */
    async clearAllPatterns() {
        return await this.adapter.clearAllPatterns();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Guideline 관리
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Guideline 저장
     */
    async storeGuideline(guideline) {
        return await this.adapter.storeGuideline(guideline);
    }

    /**
     * Guideline 검색 (필터 조건)
     * 
     * v4.0: checkType 배열 지원
     * @example
     * // 단일 checkType
     * await searchGuidelines({ checkType: 'pure_regex' });
     * // 다중 checkType
     * await searchGuidelines({ checkType: ['pure_regex', 'llm_with_regex'] });
     */
    async searchGuidelines(filters = {}) {
        return await this.adapter.searchGuidelines(filters);
    }
}