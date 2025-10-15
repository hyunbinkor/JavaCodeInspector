import dotenv from 'dotenv';

dotenv.config();

export const config = {
  // Vector DB 통합 설정
  vector: {
    provider: process.env.VECTOR_PROVIDER || 'weaviate', // 'weaviate' 또는 'qdrant'
    
    // Weaviate 설정
    weaviate: {
      url: process.env.WEAVIATE_URL || 'http://localhost:8080',
      apiKey: process.env.WEAVIATE_API_KEY,
      // 로컬 환경에서의 API 인증 여부 설정
      useAuth: process.env.WEAVIATE_USE_AUTH === 'true',
      // Ollama 모델 통합을 위한 설정
      ollamaEndpoint: process.env.OLLAMA_EMBEDDINGS_URL || 'http://ollama:11434',
      embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text'
    },
    
    // Qdrant 설정
    qdrant: {
      url: process.env.QDRANT_URL || 'http://localhost:6333',
      apiKey: process.env.QDRANT_API_KEY,
      collectionNamePattern: process.env.QDRANT_COLLECTION_NAME_PATTERN || 'code_{type}',
      // Qdrant 벡터 차원 설정
      vectorDimensions: parseInt(process.env.QDRANT_VECTOR_DIMENSIONS) || 480,
      // 벡터 인덱스 설정
      indexParams: {
        m: parseInt(process.env.QDRANT_INDEX_M) || 16,
        ef_construct: parseInt(process.env.QDRANT_INDEX_EF_CONSTRUCT) || 100
      }
    },

    // 공통 설정
    maxRetries: parseInt(process.env.VECTOR_MAX_RETRIES) || 3,
    retryDelay: parseInt(process.env.VECTOR_RETRY_DELAY) || 1000,
    similarityThreshold: parseFloat(process.env.VECTOR_SIMILARITY_THRESHOLD) || 0.7,
    // 클래스/컬렉션 이름 설정
    codePatternName: process.env.VECTOR_CODE_PATTERN_NAME || 'CodePattern',
    guidelineName: process.env.VECTOR_GUIDELINE_NAME || 'CodingGuideline'
  },

  // LLM 통합 설정
  llm: {
    provider: process.env.LLM_PROVIDER || 'bedrock', // 'bedrock' 또는 'ollama'
    
    // Bedrock 설정 (Claude, DeepSeek-R1 지원)
    bedrock: {
      region: process.env.BEDROCK_REGION || 'us-east-1',
      modelId: process.env.BEDROCK_MODEL_ID || 'arn:aws:bedrock:us-east-1:484907498824:inference-profile/us.anthropic.claude-sonnet-4-20250514-v1:0',
      maxTokens: parseInt(process.env.BEDROCK_MAX_TOKENS) || 4000,
      temperature: parseFloat(process.env.BEDROCK_TEMPERATURE) || 0.1,
      // DeepSeek-R1 모델 자동 감지
      isDeepSeekR1: false // 자동으로 설정됨
    },
    
    // Ollama 설정 (안정성 강화)
    ollama: {
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://103.196.86.239:12942',
      model: process.env.OLLAMA_MODEL || 'qwen3-coder:30b',
      maxTokens: parseInt(process.env.OLLAMA_MAX_TOKENS) || 4000,
      temperature: parseFloat(process.env.OLLAMA_TEMPERATURE) || 0.1,
      timeout: parseInt(process.env.OLLAMA_TIMEOUT) || 180000, // 3분 타임아웃
      
      // 안정성을 위한 추가 설정
      maxRequestSize: parseInt(process.env.OLLAMA_MAX_REQUEST_SIZE) || 8000,      // 최대 요청 크기 (문자)
      chunkSize: parseInt(process.env.OLLAMA_CHUNK_SIZE) || 2000,                 // 청크 분할 크기
      defaultTimeout: parseInt(process.env.OLLAMA_DEFAULT_TIMEOUT) || 90000,      // 기본 타임아웃 (90초)
      backoffMultiplier: parseInt(process.env.OLLAMA_BACKOFF_MULTIPLIER) || 2000, // 재시도 간격 (밀리초)
      
      // ECONNRESET 오류 대응 설정
      connectionRetryDelay: parseInt(process.env.OLLAMA_CONNECTION_RETRY_DELAY) || 2000,  // 연결 재시도 지연
      maxConnectionRetries: parseInt(process.env.OLLAMA_MAX_CONNECTION_RETRIES) || 5,     // 최대 연결 재시도
      enableKeepAlive: process.env.OLLAMA_ENABLE_KEEPALIVE !== 'false',                  // Keep-Alive 활성화
      keepAliveTimeout: parseInt(process.env.OLLAMA_KEEPALIVE_TIMEOUT) || 30000          // Keep-Alive 타임아웃
    },
    
    // 공통 설정 (안정성 강화)
    maxRetries: parseInt(process.env.LLM_MAX_RETRIES) || 2,
    maxContinuationAttempts: parseInt(process.env.LLM_MAX_CONTINUATION_ATTEMPTS) || 5,
    
    // 대용량 요청 처리 설정
    enableChunking: process.env.LLM_ENABLE_CHUNKING !== 'false',                 // 청킹 활성화
    chunkOverlapSize: parseInt(process.env.LLM_CHUNK_OVERLAP_SIZE) || 100,       // 청크 겹침 크기
    maxChunksPerRequest: parseInt(process.env.LLM_MAX_CHUNKS_PER_REQUEST) || 5   // 요청당 최대 청크 수
  },
  
  app: {
    logLevel: process.env.LOG_LEVEL || 'info',
    batchSize: parseInt(process.env.BATCH_SIZE) || 10,
    
    // 성능 최적화 설정
    enableParallelProcessing: process.env.ENABLE_PARALLEL_PROCESSING !== 'false',
    maxParallelTasks: parseInt(process.env.MAX_PARALLEL_TASKS) || 3,
    
    // 오류 복구 설정
    enableGracefulDegradation: process.env.ENABLE_GRACEFUL_DEGRADATION !== 'false',
    fallbackToSimpleAnalysis: process.env.FALLBACK_TO_SIMPLE_ANALYSIS !== 'false'
  }
};

export const PATTERN_CATEGORIES = {
  RESOURCE_MANAGEMENT: 'resource_management',
  SECURITY_VULNERABILITY: 'security_vulnerability', 
  PERFORMANCE_ISSUE: 'performance_issue',
  FRAMEWORK_MISUSE: 'framework_misuse',
  BUSINESS_LOGIC_ERROR: 'business_logic_error',
  EXCEPTION_HANDLING: 'exception_handling',
  CONCURRENCY_ISSUE: 'concurrency_issue',
  ARCHITECTURE_VIOLATION: 'architecture_violation'
};

export const SEVERITY_LEVELS = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM', 
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL'
};

// Ollama 전용 최적화 설정
export const OLLAMA_OPTIMIZATION = {
  // 요청 크기별 토큰 조정
  TOKEN_ADJUSTMENT: {
    SMALL_REQUEST: { threshold: 1000, tokens: 2000 },    // 1KB 이하
    MEDIUM_REQUEST: { threshold: 5000, tokens: 1500 },   // 5KB 이하  
    LARGE_REQUEST: { threshold: 10000, tokens: 1000 },   // 10KB 이하
    XLARGE_REQUEST: { threshold: 15000, tokens: 500 }    // 15KB 이상
  },
  
  // 배치 처리 설정
  BATCH_PROCESSING: {
    DEFAULT_BATCH_SIZE: 2,           // 기본 배치 크기
    MAX_BATCH_SIZE: 3,              // 최대 배치 크기
    MIN_BATCH_SIZE: 1,              // 최소 배치 크기
    BATCH_TIMEOUT_MULTIPLIER: 1.5   // 배치 타임아웃 배율
  },
  
  // 재시도 전략
  RETRY_STRATEGY: {
    EXPONENTIAL_BACKOFF: true,       // 지수 백오프 사용
    MAX_BACKOFF_DELAY: 10000,       // 최대 백오프 지연 (10초)
    JITTER_ENABLED: true,           // 지터 활성화
    CONNECTION_ERROR_MULTIPLIER: 2   // 연결 오류시 지연 배수
  }
};

// 환경별 설정 검증
export function validateConfig() {
  const errors = [];
  
  // LLM 제공자 검증
  if (!['ollama', 'bedrock'].includes(config.llm.provider)) {
    errors.push(`지원하지 않는 LLM 제공자: ${config.llm.provider}`);
  }
  
  // Ollama 설정 검증
  if (config.llm.provider === 'ollama') {
    if (!config.llm.ollama.baseUrl) {
      errors.push('Ollama baseUrl이 설정되지 않았습니다');
    }
    if (!config.llm.ollama.model) {
      errors.push('Ollama model이 설정되지 않았습니다');
    }
  }
  
  // Bedrock 설정 검증
  if (config.llm.provider === 'bedrock') {
    if (!config.llm.bedrock.modelId) {
      errors.push('Bedrock modelId가 설정되지 않았습니다');
    }
    if (!config.llm.bedrock.region) {
      errors.push('Bedrock region이 설정되지 않았습니다');
    }
  }

  // Vector DB 제공자 검증
  if (!['weaviate', 'qdrant'].includes(config.vector.provider)) {
    errors.push(`지원하지 않는 Vector DB 제공자: ${config.vector.provider}`);
  }

  // Weaviate 설정 검증
  if (config.vector.provider === 'weaviate') {
    if (!config.vector.weaviate.url) {
      errors.push('Weaviate URL이 설정되지 않았습니다');
    }
  }

  // Qdrant 설정 검증
  if (config.vector.provider === 'qdrant') {
    if (!config.vector.qdrant.url) {
      errors.push('Qdrant URL이 설정되지 않았습니다');
    }
    if (!config.vector.qdrant.vectorDimensions || config.vector.qdrant.vectorDimensions < 1) {
      errors.push('Qdrant vectorDimensions가 올바르지 않습니다');
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

// 설정 초기화 및 검증
const validation = validateConfig();
if (!validation.isValid) {
  console.error('❌ Config 검증 실패:');
  validation.errors.forEach(error => console.error(`  - ${error}`));
  process.exit(1);
}

// 성공 메시지 출력
console.log('='.repeat(60));
console.log('✅ Config 검증 완료');
console.log('='.repeat(60));

// LLM 설정 출력
console.log(`\n📊 LLM 제공자: ${config.llm.provider.toUpperCase()}`);
if (config.llm.provider === 'ollama') {
  console.log(`  📡 서버: ${config.llm.ollama.baseUrl}`);
  console.log(`  🤖 모델: ${config.llm.ollama.model}`);
  console.log(`  ⏱️  타임아웃: ${config.llm.ollama.timeout}ms`);
  console.log(`  🔄 최대 재시도: ${config.llm.maxRetries}회`);
  
  if (config.llm.enableChunking) {
    console.log(`  📦 청킹: 활성화 (크기: ${config.llm.ollama.chunkSize}자)`);
  }
} else if (config.llm.provider === 'bedrock') {
  console.log(`  🌎 리전: ${config.llm.bedrock.region}`);
  console.log(`  🤖 모델: ${config.llm.bedrock.modelId.split('/').pop()}`);
  console.log(`  🎯 최대 토큰: ${config.llm.bedrock.maxTokens}`);
  console.log(`  🌡️  Temperature: ${config.llm.bedrock.temperature}`);
}

// Vector DB 설정 출력
console.log(`\n📊 Vector DB 제공자: ${config.vector.provider.toUpperCase()}`);
if (config.vector.provider === 'weaviate') {
  console.log(`  📡 서버: ${config.vector.weaviate.url}`);
  console.log(`  🔑 인증 모드: ${config.vector.weaviate.useAuth ? '사용' : '미사용'}`);
  console.log(`  🧩 Embedding: ${config.vector.weaviate.embeddingModel}`);
  console.log(`  📝 CodePattern 클래스: ${config.vector.codePatternName}`);
  console.log(`  📋 Guideline 클래스: ${config.vector.guidelineName}`);
} else if (config.vector.provider === 'qdrant') {
  console.log(`  📡 서버: ${config.vector.qdrant.url}`);
  console.log(`  🔑 인증: ${config.vector.qdrant.apiKey ? 'API Key 사용' : '미사용'}`);
  console.log(`  📊 벡터 차원: ${config.vector.qdrant.vectorDimensions}`);
  console.log(`  🎯 인덱스 파라미터: M=${config.vector.qdrant.indexParams.m}, EF=${config.vector.qdrant.indexParams.ef_construct}`);
  console.log(`  📝 CodePattern 컬렉션: ${config.vector.qdrant.collectionNamePattern.replace('{type}', 'pattern')}`);
  console.log(`  📋 Guideline 컬렉션: ${config.vector.qdrant.collectionNamePattern.replace('{type}', 'guideline')}`);
}

// 공통 Vector DB 설정
console.log(`  🔄 최대 재시도: ${config.vector.maxRetries}회`);
console.log(`  📏 유사도 임계값: ${config.vector.similarityThreshold}`);

// 애플리케이션 설정
console.log(`\n⚙️  애플리케이션 설정:`);
console.log(`  📦 배치 크기: ${config.app.batchSize}`);
console.log(`  🔀 병렬 처리: ${config.app.enableParallelProcessing ? '활성화' : '비활성화'} (최대 ${config.app.maxParallelTasks}개)`);
console.log(`  🛡️  Graceful Degradation: ${config.app.enableGracefulDegradation ? '활성화' : '비활성화'}`);

console.log('='.repeat(60));
console.log('🚀 시스템 준비 완료!\n');