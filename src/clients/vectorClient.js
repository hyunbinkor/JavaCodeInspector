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