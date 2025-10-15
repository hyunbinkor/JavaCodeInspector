import { JavaASTParser } from '../ast/javaAstParser.js';

export class CodeEmbeddingGenerator {
  constructor() {
    // 각 임베딩 레이어의 차원 수 정의
    this.syntacticDim = 128;    // 구문 구조 벡터 크기
    this.semanticDim = 256;     // 의미론적 패턴 벡터 크기
    this.frameworkDim = 64;     // 프레임워크 사용 벡터 크기
    this.contextDim = 32;       // 비즈니스 컨텍스트 벡터 크기
    
    // Java 코드 분석을 위한 AST 파서 인스턴스
    this.astParser = new JavaASTParser();
    
    // 프레임워크별 주요 어노테이션 목록
    this.frameworkVocabulary = {
      spring: ['@Component', '@Service', '@Repository', '@Controller', '@Autowired'],
      hibernate: ['@Entity', '@Table', '@Column', '@Id', '@GeneratedValue'],
      custom: ['@DatabaseTransaction', '@BusinessLogic', '@CacheEnabled']
    };
    
    // 비즈니스 도메인 식별을 위한 키워드
    this.businessKeywords = [
      'user', 'account', 'payment', 'order', 'transaction', 'product',
      'customer', 'invoice', 'shipping', 'billing', 'authentication'
    ];
  }

  async embedAstStructure(codePattern) {
    try {
      // JavaASTParser로 코드를 파싱하여 AST 생성
      const astResult = this.astParser.parseJavaCode(codePattern);
      
      if (astResult.success && astResult.analysis) {
        // AST 분석 결과를 128차원 벡터로 변환하여 반환
        return this.astParser.vectorizeAST(astResult.analysis);
      } else {
        // AST 파싱 실패 시 정규식 기반의 간단한 벡터 생성
        console.warn('AST 파싱 실패, 폴백 분석 사용:', astResult.error);
        return this.fallbackAstEmbedding(codePattern);
      }
    } catch (error) {
      console.warn('AST 임베딩 생성 오류:', error.message);
      return this.fallbackAstEmbedding(codePattern);
    }
  }

  fallbackAstEmbedding(codePattern) {
    // AST 파싱 실패 시 정규식으로 기본 구문 패턴 분석
    const embedding = new Array(this.syntacticDim).fill(0);
    
    const nodeTypes = this.extractNodeTypes(codePattern);
    const complexity = this.calculateComplexity(codePattern);
    
    // 0-63차원: 주요 구문 요소(class, method, if, for 등)의 출현 빈도
    const nodeTypeVocab = [
      'class', 'method', 'variable', 'if', 'for', 'while', 
      'try', 'catch', 'throw', 'return', 'assignment'
    ];
    
    nodeTypeVocab.forEach((nodeType, index) => {
      if (index < 64) {
        const count = (codePattern.toLowerCase().match(new RegExp(nodeType, 'g')) || []).length;
        embedding[index] = Math.min(count / 10.0, 1.0);
      }
    });
    
    // 64-66차원: 중첩 깊이, 분기 수, 라인 수 등 구조적 메트릭
    embedding[64] = Math.min(complexity.depth / 10.0, 1.0);
    embedding[65] = Math.min(complexity.branches / 20.0, 1.0);
    embedding[66] = Math.min(complexity.lines / 100.0, 1.0);
    
    return embedding;
  }

  async embedCodeSemantics(codePattern) {
    try {
      // AST 기반으로 정확한 의미론적 패턴 분석 시도
      const astResult = this.astParser.parseJavaCode(codePattern);
      
      if (astResult.success && astResult.analysis) {
        return this.astBasedSemanticEmbedding(astResult.analysis, codePattern);
      } else {
        // AST 실패 시 정규식 기반 의미 분석으로 대체
        return this.regexBasedSemanticEmbedding(codePattern);
      }
    } catch (error) {
      console.warn('의미론적 임베딩 생성 오류:', error.message);
      return this.regexBasedSemanticEmbedding(codePattern);
    }
  }

  astBasedSemanticEmbedding(astAnalysis, codePattern) {
    // AST 분석 결과를 256차원 의미 벡터로 변환
    const embedding = new Array(this.semanticDim).fill(0);
    let index = 0;
    
    // 0-7차원: CRUD 패턴 점수 (메서드명 기반 분석)
    const crudPatterns = this.analyzeCrudPatterns(astAnalysis.methodDeclarations);
    Object.values(crudPatterns).forEach(score => {
      if (index < 8) embedding[index++] = score;
    });
    
    // 8-23차원: 리소스 관리 패턴 (생성/해제/누수 위험)
    embedding[index++] = Math.min(astAnalysis.resourceLifecycles.length / 5.0, 1.0);
    embedding[index++] = Math.min(astAnalysis.resourceLeakRisks.length / 3.0, 1.0);
    embedding[index++] = astAnalysis.exceptionHandling.length > 0 ? 1.0 : 0.0;
    embedding[index++] = astAnalysis.annotations.length > 0 ? 1.0 : 0.0;
    
    // 24-39차원: 보안 취약점 패턴 (SQL 인젝션, XSS 등)
    embedding[index++] = Math.min(astAnalysis.securityPatterns.length / 3.0, 1.0);
    embedding[index++] = Math.min(astAnalysis.sqlInjectionRisks.length / 2.0, 1.0);
    
    // 40-55차원: 성능 문제 패턴 (N+1 쿼리, 루프 복잡도 등)
    embedding[index++] = Math.min(astAnalysis.performanceIssues.length / 3.0, 1.0);
    embedding[index++] = Math.min(astAnalysis.loopAnalysis.length / 5.0, 1.0);
    
    // 56-87차원: 코드 품질 지표 (냄새, 디자인 패턴, 복잡도)
    embedding[index++] = Math.min(astAnalysis.codeSmells.length / 5.0, 1.0);
    embedding[index++] = astAnalysis.designPatterns.length > 0 ? 1.0 : 0.0;
    embedding[index++] = Math.min(astAnalysis.cyclomaticComplexity / 20.0, 1.0);
    embedding[index++] = Math.min(astAnalysis.maxDepth / 10.0, 1.0);
    
    // 88-255차원: 텍스트 기반 분석으로 나머지 차원 채우기
    const textEmbedding = this.regexBasedSemanticEmbedding(codePattern);
    for (let i = index; i < this.semanticDim; i++) {
      embedding[i] = textEmbedding[i] || 0;
    }
    
    return embedding;
  }

  analyzeCrudPatterns(methodDeclarations) {
    // 메서드명에서 CRUD 작업 의도 추출 (0.0~1.0 점수)
    const patterns = { create: 0, read: 0, update: 0, delete: 0 };
    
    methodDeclarations.forEach(method => {
      const methodName = method.name.toLowerCase();
      
      // Create 패턴: create, insert, add, save 등
      if (['create', 'insert', 'add', 'save'].some(keyword => methodName.includes(keyword))) {
        patterns.create = Math.min(patterns.create + 0.25, 1.0);
      }
      // Read 패턴: get, find, read, select, retrieve 등
      if (['get', 'find', 'read', 'select', 'retrieve'].some(keyword => methodName.includes(keyword))) {
        patterns.read = Math.min(patterns.read + 0.25, 1.0);
      }
      // Update 패턴: update, modify, edit, change 등
      if (['update', 'modify', 'edit', 'change'].some(keyword => methodName.includes(keyword))) {
        patterns.update = Math.min(patterns.update + 0.25, 1.0);
      }
      // Delete 패턴: delete, remove, destroy 등
      if (['delete', 'remove', 'destroy'].some(keyword => methodName.includes(keyword))) {
        patterns.delete = Math.min(patterns.delete + 0.25, 1.0);
      }
    });
    
    return patterns;
  }

  regexBasedSemanticEmbedding(codePattern) {
    // 정규식과 키워드 매칭으로 256차원 의미 벡터 생성
    const embedding = new Array(this.semanticDim).fill(0);
    const codeLower = codePattern.toLowerCase();
    
    // 0-3차원: CRUD 작업 키워드 매칭 점수
    const crudPatterns = {
      create: ['create', 'insert', 'add', 'new'],
      read: ['get', 'find', 'read', 'select', 'retrieve'],
      update: ['update', 'modify', 'edit', 'change', 'set'],
      delete: ['delete', 'remove', 'destroy', 'drop']
    };
    
    let index = 0;
    Object.entries(crudPatterns).forEach(([pattern, keywords]) => {
      const score = keywords.reduce((sum, keyword) => {
        return sum + (codeLower.includes(keyword) ? 1 : 0);
      }, 0);
      embedding[index++] = Math.min(score / keywords.length, 1.0);
    });
    
    // 4-7차원: 리소스 타입별 사용 패턴 (DB, 파일, 네트워크, 컬렉션)
    const resourcePatterns = {
      database: ['connection', 'statement', 'resultset', 'query', 'sql'],
      file: ['file', 'stream', 'reader', 'writer', 'path'],
      network: ['socket', 'http', 'url', 'request', 'response'],
      collection: ['list', 'map', 'set', 'array', 'collection']
    };
    
    Object.entries(resourcePatterns).forEach(([category, keywords]) => {
      const score = keywords.reduce((sum, keyword) => {
        return sum + (codeLower.includes(keyword) ? 1 : 0);
      }, 0);
      embedding[index++] = Math.min(score / keywords.length, 1.0);
    });
    
    // 8차원 이후: 보안 위험 패턴 점수 추가
    const riskPatterns = this.detectSemanticPatterns(codePattern);
    Object.values(riskPatterns).forEach((score, i) => {
      if (index < this.semanticDim) {
        embedding[index++] = score;
      }
    });
    
    return embedding;
  }

  async embedFrameworkUsage(codePattern) {
    // 프레임워크 어노테이션 및 클래스 사용 패턴을 64차원 벡터로 변환
    const embedding = new Array(this.frameworkDim).fill(0);
    const codeLower = codePattern.toLowerCase();
    
    let index = 0;
    
    // 0-7차원: Spring 프레임워크 어노테이션 존재 여부
    const springAnnotations = [
      '@component', '@service', '@repository', '@controller',
      '@autowired', '@transactional', '@requestmapping', '@getmapping'
    ];
    
    springAnnotations.forEach((annotation) => {
      if (index < 16) {
        embedding[index++] = codeLower.includes(annotation) ? 1.0 : 0.0;
      }
    });
    
    // 8-12차원: JPA/Hibernate 어노테이션 존재 여부
    const jpaAnnotations = [
      '@entity', '@table', '@column', '@id', '@generatedvalue'
    ];
    
    jpaAnnotations.forEach((annotation) => {
      if (index < 32) {
        embedding[index++] = codeLower.includes(annotation) ? 1.0 : 0.0;
      }
    });
    
    // 13차원 이후: 사내 커스텀 프레임워크 패턴 존재 여부
    const customPatterns = [
      '@databasetransaction', '@businesslogic', '@cacheenabled',
      'baseservice', 'dataaccesslayer'
    ];
    
    customPatterns.forEach((pattern) => {
      if (index < this.frameworkDim) {
        embedding[index++] = codeLower.includes(pattern) ? 1.0 : 0.0;
      }
    });
    
    return embedding;
  }

  async embedBusinessContext(codePattern) {
    // 비즈니스 도메인 및 로직 복잡도를 32차원 벡터로 변환
    const embedding = new Array(this.contextDim).fill(0);
    const codeLower = codePattern.toLowerCase();
    
    // 0-7차원: 비즈니스 도메인 분류 (사용자 관리, 금융, 주문, 콘텐츠)
    const businessDomains = {
      user_management: ['user', 'account', 'profile', 'authentication', 'login'],
      financial: ['payment', 'transaction', 'money', 'balance', 'transfer'],
      order_processing: ['order', 'cart', 'checkout', 'shipping', 'product'],
      content_management: ['article', 'post', 'comment', 'publish', 'content']
    };
    
    let index = 0;
    Object.entries(businessDomains).forEach(([domain, keywords]) => {
      if (index < 8) {
        const score = keywords.reduce((sum, keyword) => {
          return sum + (codeLower.includes(keyword) ? 1 : 0);
        }, 0);
        embedding[index++] = Math.min(score / keywords.length, 1.0);
      }
    });
    
    // 8차원 이후: 비즈니스 로직 복잡도 키워드 존재 여부
    const complexityKeywords = ['validate', 'process', 'calculate', 'transform'];
    complexityKeywords.forEach((keyword) => {
      if (index < this.contextDim) {
        embedding[index++] = codeLower.includes(keyword) ? 1.0 : 0.0;
      }
    });
    
    return embedding;
  }

  combineEmbeddings(embeddings) {
    // 4가지 임베딩 벡터를 하나로 결합 (총 480차원)
    const combined = [
      ...embeddings.syntactic,    // 128차원
      ...embeddings.semantic,     // 256차원
      ...embeddings.framework,    // 64차원
      ...embeddings.context       // 32차원
    ];
    
    // L2 정규화로 벡터 크기를 1로 통일 (코사인 유사도 계산 용이)
    const norm = Math.sqrt(combined.reduce((sum, val) => sum + val * val, 0));
    if (norm > 0) {
      return combined.map(val => val / norm);
    }
    
    return combined;
  }

  extractNodeTypes(code) {
    // 정규식으로 주요 구문 요소 추출
    const nodeTypes = [];
    
    const patterns = {
      'class': /class\s+\w+/g,
      'method': /\w+\s*\([^)]*\)\s*\{/g,
      'variable': /\w+\s+\w+\s*=/g,
      'if': /if\s*\(/g,
      'for': /for\s*\(/g,
      'while': /while\s*\(/g
    };
    
    Object.entries(patterns).forEach(([type, pattern]) => {
      const matches = code.match(pattern) || [];
      for (let i = 0; i < matches.length; i++) {
        nodeTypes.push(type);
      }
    });
    
    return nodeTypes;
  }

  calculateComplexity(code) {
    // 코드의 기본 복잡도 지표 계산
    const lines = code.split('\n').length;
    const depth = this.calculateNestingDepth(code);
    const branches = (code.match(/if|for|while|switch/g) || []).length;
    
    return { lines, depth, branches };
  }

  calculateNestingDepth(code) {
    // 중괄호 쌍으로 최대 중첩 깊이 계산
    let maxDepth = 0;
    let currentDepth = 0;
    
    for (const char of code) {
      if (char === '{') {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      } else if (char === '}') {
        currentDepth--;
      }
    }
    
    return maxDepth;
  }

  detectSemanticPatterns(code) {
    // 코드에서 잠재적 위험 패턴 탐지 및 점수 산출
    const patterns = {};
    const codeLower = code.toLowerCase();
    
    // 리소스 누수 위험: Connection 생성 후 close() 없음
    if (codeLower.includes('getconnection') && !codeLower.includes('close')) {
      patterns.resource_leak_risk = 0.8;
    }
    
    // SQL 인젝션 위험: 쿼리에 문자열 연결(+) 사용
    if (codeLower.includes('executequery') && code.includes('+')) {
      patterns.sql_injection_risk = 0.9;
    }
    
    // N+1 쿼리 위험: 루프 내에서 쿼리 실행
    if ((codeLower.includes('for') || codeLower.includes('while')) && 
        codeLower.includes('query')) {
      patterns.n_plus_one_risk = 0.7;
    }
    
    return patterns;
  }
}