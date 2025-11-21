import dotenv from 'dotenv';
import logger from './utils/loggerUtils.js';

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
      apiKey: process.env.QDRANT_API_KEY,
      collectionNamePattern: process.env.QDRANT_COLLECTION_NAME_PATTERN || 'code_{type}',
      vectorDimensions: parseInt(process.env.QDRANT_VECTOR_DIMENSIONS) || 480,
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
    provider: ENVIRONMENT === 'internal' ? 'vllm' : 
              (process.env.LLM_PROVIDER || 'ollama'),
    
    // Bedrock 설정 (사용 시)
    bedrock: {
      region: process.env.BEDROCK_REGION || 'us-east-1',
      modelId: process.env.BEDROCK_MODEL_ID || 'arn:aws:bedrock:us-east-1:484907498824:inference-profile/us.anthropic.claude-sonnet-4-20250514-v1:0',
      maxTokens: parseInt(process.env.BEDROCK_MAX_TOKENS) || 4000,
      temperature: parseFloat(process.env.BEDROCK_TEMPERATURE) || 0.1,
      isDeepSeekR1: false
    },
    
    // Ollama 설정 (외부망)
    ollama: {
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://115.41.241.155:3333',
      model: process.env.OLLAMA_MODEL || 'qwen3-coder:30b',
      maxTokens: parseInt(process.env.OLLAMA_MAX_TOKENS) || 4000,
      temperature: parseFloat(process.env.OLLAMA_TEMPERATURE) || 0.1,
      timeout: parseInt(process.env.OLLAMA_TIMEOUT) || 180000,
      
      // 안정성 설정
      maxRequestSize: parseInt(process.env.OLLAMA_MAX_REQUEST_SIZE) || 8000,
      chunkSize: parseInt(process.env.OLLAMA_CHUNK_SIZE) || 2000,
      defaultTimeout: parseInt(process.env.OLLAMA_DEFAULT_TIMEOUT) || 90000,
      backoffMultiplier: parseInt(process.env.OLLAMA_BACKOFF_MULTIPLIER) || 2000,
      
      // ECONNRESET 대응
      connectionRetryDelay: parseInt(process.env.OLLAMA_CONNECTION_RETRY_DELAY) || 2000,
      maxConnectionRetries: parseInt(process.env.OLLAMA_MAX_CONNECTION_RETRIES) || 5,
      enableKeepAlive: process.env.OLLAMA_ENABLE_KEEPALIVE !== 'false',
      keepAliveTimeout: parseInt(process.env.OLLAMA_KEEPALIVE_TIMEOUT) || 30000
    },
    
    // vLLM 설정 (내부망)
    vllm: {
      baseUrl: process.env.VLLM_BASE_URL || 'http://localhost:8000',
      model: process.env.VLLM_MODEL || 'Qwen/Qwen2.5-Coder-30B-Instruct',
      maxTokens: parseInt(process.env.VLLM_MAX_TOKENS || '4000', 10),
      temperature: parseFloat(process.env.VLLM_TEMPERATURE || '0.1'),
      timeout: parseInt(process.env.VLLM_TIMEOUT || '180000', 10)
    },

    // 공통 설정
    maxRetries: parseInt(process.env.LLM_MAX_RETRIES) || 3,
    maxContinuationAttempts: parseInt(process.env.LLM_MAX_CONTINUATION_ATTEMPTS) || 5,
    
    // 대용량 요청 처리
    enableChunking: process.env.LLM_ENABLE_CHUNKING !== 'false',
    chunkOverlapSize: parseInt(process.env.LLM_CHUNK_OVERLAP_SIZE) || 100,
    maxChunksPerRequest: parseInt(process.env.LLM_MAX_CHUNKS_PER_REQUEST) || 5
  },
  
  // ============================================
  // 문서 추출 설정 (신규 추가)
  // ============================================
  document: {
    // 지원 형식 (PDF, DOCX만 - DOC는 제외)
    supportedFormats: (process.env.DOCUMENT_SUPPORTED_FORMATS || 'pdf,docx')
      .split(',')
      .map(f => f.trim().toLowerCase()),
    
    // 기본 형식
    defaultFormat: (process.env.DOCUMENT_DEFAULT_FORMAT || 'pdf').toLowerCase(),
    
    // DOCX 옵션
    docx: {
      // 순수 텍스트 추출 (mammoth.extractRawText)
      extractRawText: process.env.DOCX_EXTRACT_RAW_TEXT !== 'false',
      // 헤더/푸터 포함
      includeHeaders: process.env.DOCX_INCLUDE_HEADERS !== 'false',
      // 각주 포함
      includeFootnotes: process.env.DOCX_INCLUDE_FOOTNOTES !== 'false'
    },
    
    // PDF 옵션
    pdf: {
      parser: process.env.PDF_PARSER || 'pdf2json'
    },
    
    // 텍스트 정규화
    normalize: {
      whitespace: process.env.DOCUMENT_NORMALIZE_WHITESPACE !== 'false',
      removePageNumbers: process.env.DOCUMENT_REMOVE_PAGE_NUMBERS === 'true',
      minTextLength: parseInt(process.env.DOCUMENT_MIN_TEXT_LENGTH) || 100
    }
  },
  
  app: {
    logLevel: process.env.LOG_LEVEL || 'info',
    batchSize: parseInt(process.env.BATCH_SIZE) || 10,
    
    // 성능 최적화
    enableParallelProcessing: process.env.ENABLE_PARALLEL_PROCESSING !== 'false',
    maxParallelTasks: parseInt(process.env.MAX_PARALLEL_TASKS) || 3,
    
    // 오류 복구
    enableGracefulDegradation: process.env.ENABLE_GRACEFUL_DEGRADATION !== 'false',
    fallbackToSimpleAnalysis: process.env.FALLBACK_TO_SIMPLE_ANALYSIS !== 'false'
  },

  /**
   * 현재 활성화된 LLM 설정 반환
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

// 설정 초기화 및 검증
const validation = validateConfig();
if (!validation.isValid) {
  logger.error('❌ Config 검증 실패:');
  validation.errors.forEach(error => logger.error(`  - ${error}`));
  process.exit(1);
}

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

// 문서 설정 출력 (신규)
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