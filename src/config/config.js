import dotenv from 'dotenv';
import logger from '../utils/loggerUtils.js';

dotenv.config();

/**
 * 통합 설정 파일 (config.js)
 * 
 * 환경별 자동 감지 및 설정 적용:
 * - external (외부망): Ollama
 * - internal (내부망): vLLM
 * 
 * 환경 설정 방법:
 * 1. NODE_ENV 환경변수: NODE_ENV=internal node main.js
 * 2. .env 파일: ENVIRONMENT=internal
 * 3. 기본값: external (Ollama)
 */

// 환경 감지 (우선순위: NODE_ENV > .env > 기본값)
const ENVIRONMENT = process.env.NODE_ENV || process.env.ENVIRONMENT || 'external';

export const config = {
  // 현재 환경
  environment: ENVIRONMENT,

  // ===== 🆕 Enhanced Embedding 설정 (신규) =====
  embedding: {
    // Enhanced 모드 활성화 (LLM 기반 의미론적 임베딩 + 카테고리별 가중치)
    enableEnhancedEmbedding: process.env.ENABLE_ENHANCED_EMBEDDING === 'true',

    // LLM 기반 의미론적 임베딩 활성화 (gpt-oss:120b 사용)
    // false: 정규식 기반 (기존 방식)
    // true: LLM 기반 (고품질, 느림)
    enableLLMEmbedding: process.env.ENABLE_LLM_EMBEDDING === 'true',

    // 메타 정보 기반 비즈니스 컨텍스트 임베딩 활성화
    // false: 기본 비즈니스 임베딩 32차원
    // true: 메타 정보 포함 64차원
    enableMetaInfo: process.env.ENABLE_META_INFO === 'true',

    // 임베딩 차원 설정
    dimensions: {
      syntactic: 128,    // 구문적 임베딩 (AST 구조)
      semantic: 256,     // 의미론적 임베딩 (코드 의미)
      framework: 64,     // 프레임워크 임베딩 (Spring/JPA)
      context: process.env.ENABLE_ENHANCED_EMBEDDING === 'true' ? 64 : 32  // 비즈니스 컨텍스트
    },

    // 가중치 설정 파일 경로
    weightsPath: process.env.EMBEDDING_WEIGHTS_PATH || './config/embedding-weights.json',

    // Threshold 설정 파일 경로
    thresholdsPath: process.env.EMBEDDING_THRESHOLDS_PATH || './config/category-thresholds.json',

    // 개발가이드 문서 경로 (LLM 컨텍스트용)
    guidelineDocPath: process.env.GUIDELINE_DOC_PATH || './asset/development_guide.json',

    // 메타 정보 파일 경로
    metaInfoPath: process.env.META_INFO_PATH || './asset/meta_info.json',

    // 캐싱 설정
    cacheEnabled: process.env.EMBEDDING_CACHE_ENABLED !== 'false',  // 기본 true
    cacheTTL: parseInt(process.env.EMBEDDING_CACHE_TTL) || 3600,  // 1시간

    // LLM 호출 설정
    llmTimeout: parseInt(process.env.EMBEDDING_LLM_TIMEOUT) || 30000,  // 30초
    llmBatchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE) || 5,
    llmModel: process.env.EMBEDDING_LLM_MODEL || 'gpt-oss:120b',

    // 품질 관리
    minQualityScore: parseInt(process.env.EMBEDDING_MIN_QUALITY_SCORE) || 50,  // 0-100

    // 폴백 설정
    enableFallback: process.env.EMBEDDING_ENABLE_FALLBACK !== 'false',  // LLM 실패 시 정규식으로
  },

  // Vector DB 통합 설정
  vector: {
    provider: process.env.VECTOR_PROVIDER || 'qdrant', // 'weaviate' 또는 'qdrant'

    // Weaviate 설정
    weaviate: {
      url: process.env.WEAVIATE_URL || 'http://localhost:8080',
      apiKey: process.env.WEAVIATE_API_KEY,
      useAuth: process.env.WEAVIATE_USE_AUTH === 'true',
      ollamaEndpoint: process.env.OLLAMA_EMBEDDINGS_URL || 'http://ollama:11434',
      embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text'
    },

    // Qdrant 설정
    qdrant: {
      url: process.env.QDRANT_URL || 'http://localhost:6333',
      host: 'qdrant-llm.apps.ocd1.shinhancard.dv',
      port: 443,
      https: true,
      apiKey: process.env.QDRANT_API_KEY,
      collectionNamePattern: process.env.QDRANT_COLLECTION_NAME_PATTERN || 'code_{type}',
      vectorDimensions: process.env.ENABLE_ENHANCED_EMBEDDING === 'true' ? 512 : 480,  // Enhanced: 512, 기본: 480
      indexParams: {
        m: parseInt(process.env.QDRANT_INDEX_M) || 16,
        ef_construct: parseInt(process.env.QDRANT_INDEX_EF_CONSTRUCT) || 100
      }
    },

    // 공통 설정
    maxRetries: parseInt(process.env.VECTOR_MAX_RETRIES) || 3,
    retryDelay: parseInt(process.env.VECTOR_RETRY_DELAY) || 1000,
    similarityThreshold: parseFloat(process.env.VECTOR_SIMILARITY_THRESHOLD) || 0.7,
    codePatternName: process.env.VECTOR_CODE_PATTERN_NAME || 'CodePattern',
    guidelineName: process.env.VECTOR_GUIDELINE_NAME || 'CodingGuideline'
  },

  // LLM 통합 설정 (환경별 자동 전환)
  llm: {
    // Provider 자동 선택 (external: ollama, internal: vllm)
    provider: ENVIRONMENT === 'internal' ? 'vllm' : process.env.LLM_PROVIDER || 'ollama',

    // Ollama 설정 (외부망)
    ollama: {
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      model: process.env.OLLAMA_MODEL || 'qwen2.5-coder:32b',
      timeout: parseInt(process.env.OLLAMA_TIMEOUT) || 180000,
      maxRequestSize: parseInt(process.env.OLLAMA_MAX_REQUEST_SIZE) || 8000,
      chunkSize: parseInt(process.env.OLLAMA_CHUNK_SIZE) || 7000
    },

    // vLLM 설정 (내부망)
    vllm: {
      baseUrl: process.env.VLLM_BASE_URL || 'http://localhost:8000',
      model: process.env.VLLM_MODEL || 'qwen2.5-coder-32b-instruct',
      timeout: parseInt(process.env.VLLM_TIMEOUT) || 180000,
      maxRequestSize: parseInt(process.env.VLLM_MAX_REQUEST_SIZE) || 8000
    },

    // AWS Bedrock 설정 (선택적)
    bedrock: {
      region: process.env.AWS_REGION || 'us-east-1',
      modelId: process.env.BEDROCK_MODEL_ID || 'anthropic.claude-3-5-sonnet-20241022-v2:0',
      maxTokens: parseInt(process.env.BEDROCK_MAX_TOKENS) || 4096,
      temperature: parseFloat(process.env.BEDROCK_TEMPERATURE) || 0.1
    },

    // 공통 설정
    maxRetries: parseInt(process.env.LLM_MAX_RETRIES) || 2,
    retryDelay: parseInt(process.env.LLM_RETRY_DELAY) || 2000,
    temperature: parseFloat(process.env.LLM_TEMPERATURE) || 0.1,
    enableChunking: process.env.LLM_ENABLE_CHUNKING === 'true',
    batchSize: parseInt(process.env.LLM_BATCH_SIZE) || 3
  },

  // 문서 추출 설정
  document: {
    supportedFormats: ['pdf', 'docx'],
    defaultFormat: 'docx',
    pdf: {
      parser: 'pdf-parse'
    },
    docx: {
      extractPureText: true
    }
  },

  // 애플리케이션 설정
  app: {
    batchSize: parseInt(process.env.APP_BATCH_SIZE) || 10,
    maxParallelTasks: parseInt(process.env.APP_MAX_PARALLEL_TASKS) || 5,
    enableParallelProcessing: process.env.APP_ENABLE_PARALLEL === 'true',
    enableGracefulDegradation: process.env.APP_ENABLE_GRACEFUL_DEGRADATION !== 'false'
  },

  /**
   * 활성화된 LLM 설정 반환
   * 
   * @returns {Object} 활성 LLM 설정
   */
  get currentLLM() {
    if (this.llm.provider === 'ollama') {
      return this.llm.ollama;
    } else if (this.llm.provider === 'vllm') {
      return this.llm.vllm;
    } else if (this.llm.provider === 'bedrock') {
      return this.llm.bedrock;
    }
    return this.llm.ollama; // 기본값
  }
};


// 성공 메시지 출력
logger.info('='.repeat(60));
logger.info('✅ Config 검증 완료');
logger.info('='.repeat(60));

// 환경 정보 출력
logger.info(`\n🌍 실행 환경: ${config.environment.toUpperCase()}`);
if (config.environment === 'internal') {
  logger.info('  ⚠️  내부망 모드 - vLLM 사용');
} else {
  logger.info('  🌐 외부망 모드 - Ollama 사용');
}

// LLM 설정 출력
logger.info(`\n🔊 LLM Provider: ${config.llm.provider.toUpperCase()}`);
if (config.llm.provider === 'ollama') {
  logger.info(`  🔗 서버: ${config.llm.ollama.baseUrl}`);
  logger.info(`  🤖 모델: ${config.llm.ollama.model}`);
  logger.info(`  ⏱️  타임아웃: ${config.llm.ollama.timeout}ms`);
  logger.info(`  🔄 최대 재시도: ${config.llm.maxRetries}회`);

  if (config.llm.enableChunking) {
    logger.info(`  📦 청킹: 활성화 (크기: ${config.llm.ollama.chunkSize}자)`);
  }
} else if (config.llm.provider === 'vllm') {
  logger.info(`  🔗 서버: ${config.llm.vllm.baseUrl}`);
  logger.info(`  🤖 모델: ${config.llm.vllm.model}`);
  logger.info(`  ⏱️  타임아웃: ${config.llm.vllm.timeout}ms`);
  logger.info(`  🔄 최대 재시도: ${config.llm.maxRetries}회`);
} else if (config.llm.provider === 'bedrock') {
  logger.info(`  🌎 리전: ${config.llm.bedrock.region}`);
  logger.info(`  🤖 모델: ${config.llm.bedrock.modelId.split('/').pop()}`);
  logger.info(`  🎯 최대 토큰: ${config.llm.bedrock.maxTokens}`);
  logger.info(`  🌡️  Temperature: ${config.llm.bedrock.temperature}`);
}

// Vector DB 설정 출력
logger.info(`\n🗄️  Vector DB Provider: ${config.vector.provider.toUpperCase()}`);
if (config.vector.provider === 'weaviate') {
  logger.info(`  🔗 서버: ${config.vector.weaviate.url}`);
  logger.info(`  🔐 인증 모드: ${config.vector.weaviate.useAuth ? '사용' : '미사용'}`);
  logger.info(`  🧩 Embedding: ${config.vector.weaviate.embeddingModel}`);
  logger.info(`  📁 CodePattern 클래스: ${config.vector.codePatternName}`);
  logger.info(`  📋 Guideline 클래스: ${config.vector.guidelineName}`);
} else if (config.vector.provider === 'qdrant') {
  logger.info(`  🔗 서버: ${config.vector.qdrant.url}`);
  logger.info(`  🔐 인증: ${config.vector.qdrant.apiKey ? 'API Key 사용' : '미사용'}`);
  logger.info(`  📊 벡터 차원: ${config.vector.qdrant.vectorDimensions}`);
  logger.info(`  🎯 인덱스 파라미터: M=${config.vector.qdrant.indexParams.m}, EF=${config.vector.qdrant.indexParams.ef_construct}`);
  logger.info(`  📁 CodePattern 컬렉션: ${config.vector.qdrant.collectionNamePattern.replace('{type}', 'pattern')}`);
  logger.info(`  📋 Guideline 컬렉션: ${config.vector.qdrant.collectionNamePattern.replace('{type}', 'guideline')}`);
}

// 공통 Vector DB 설정
logger.info(`  🔄 최대 재시도: ${config.vector.maxRetries}회`);
logger.info(`  📏 유사도 임계값: ${config.vector.similarityThreshold}`);

// ===== 🆕 Enhanced Embedding 설정 출력 =====
if (config.embedding.enableEnhancedEmbedding) {
  logger.info(`\n✨ Enhanced Embedding 설정:`);
  logger.info(`  🎯 모드: Enhanced (LLM 기반)`);
  logger.info(`  🤖 LLM 임베딩: ${config.embedding.enableLLMEmbedding ? '활성화' : '비활성화'}`);
  logger.info(`  🏢 메타 정보: ${config.embedding.enableMetaInfo ? '활성화' : '비활성화'}`);
  logger.info(`  📊 총 차원: ${config.embedding.dimensions.syntactic + config.embedding.dimensions.semantic + config.embedding.dimensions.framework + config.embedding.dimensions.context}차원`);
  logger.info(`     - 구문적: ${config.embedding.dimensions.syntactic}차원`);
  logger.info(`     - 의미론적: ${config.embedding.dimensions.semantic}차원`);
  logger.info(`     - 프레임워크: ${config.embedding.dimensions.framework}차원`);
  logger.info(`     - 컨텍스트: ${config.embedding.dimensions.context}차원`);
  logger.info(`  ⚙️  가중치: ${config.embedding.weightsPath}`);
  logger.info(`  🎚️  Threshold: ${config.embedding.thresholdsPath}`);
  logger.info(`  📖 가이드라인: ${config.embedding.guidelineDocPath}`);
  logger.info(`  💾 캐싱: ${config.embedding.cacheEnabled ? '활성화' : '비활성화'}`);
  logger.info(`  📊 최소 품질: ${config.embedding.minQualityScore}/100`);
}

// 문서 설정 출력
logger.info(`\n📄 문서 추출 설정:`);
logger.info(`  📑 지원 형식: ${config.document.supportedFormats.join(', ').toUpperCase()}`);
logger.info(`  📌 기본 형식: ${config.document.defaultFormat.toUpperCase()}`);
if (config.document.supportedFormats.includes('docx')) {
  logger.info(`  📘 DOCX 옵션: 순수 텍스트 추출`);
}
if (config.document.supportedFormats.includes('pdf')) {
  logger.info(`  📕 PDF 파서: ${config.document.pdf.parser}`);
}

// 애플리케이션 설정
logger.info(`\n⚙️  애플리케이션 설정:`);
logger.info(`  📦 배치 크기: ${config.app.batchSize}`);
logger.info(`  🔀 병렬 처리: ${config.app.enableParallelProcessing ? '활성화' : '비활성화'} (최대 ${config.app.maxParallelTasks}개)`);
logger.info(`  🛡️  Graceful Degradation: ${config.app.enableGracefulDegradation ? '활성화' : '비활성화'}`);

logger.info('='.repeat(60));
logger.info('🚀 시스템 준비 완료!\n');