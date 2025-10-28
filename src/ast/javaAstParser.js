import javaParser from 'java-parser';
// import logger from '../utils/loggerUtils';

export class JavaASTParser {
  constructor() {
    this.parser = javaParser;
    
    // 레거시 프레임워크에서 자주 사용되는 기본 클래스들
    this.frameworkClasses = [
      'BaseService', 'DataAccessLayer', 'ConnectionManager',
      'BusinessProcessor', 'AbstractController', 'ServiceImpl'
    ];
    
    // 명시적으로 close()를 호출해야 하는 리소스 타입들
    this.resourceTypes = [
      'Connection', 'PreparedStatement', 'ResultSet', 'Statement',
      'FileInputStream', 'FileOutputStream', 'BufferedReader', 'BufferedWriter',
      'Socket', 'ServerSocket', 'HttpURLConnection'
    ];
    
    // 보안 취약점이 발생할 수 있는 메서드들
    this.securitySensitiveApis = [
      'executeQuery', 'executeUpdate', 'execute',
      'getWriter', 'sendRedirect', 'setAttribute',
      'encrypt', 'decrypt', 'hash'
    ];
  }

  parseJavaCode(javaCode) {
    try {
      // java-parser 라이브러리가 완전하지 않아 정규식 기반 분석 사용
      // logger.info('Java 코드 분석 중...');
      const fallbackAnalysis = this.fallbackAnalysis(javaCode);
      
      return {
        success: true,
        ast: null,
        analysis: fallbackAnalysis,
        error: null
      };
    } catch (error) {
      console.warn('Java 코드 분석 실패:', error.message);
      
      // 에러 발생 시 빈 구조를 가진 분석 결과 반환
      const emptyAnalysis = this.createEmptyAnalysis();
      
      return {
        success: false,
        ast: null,
        analysis: emptyAnalysis,
        error: error.message
      };
    }
  }

  createEmptyAnalysis() {
    // 분석 실패 시 반환할 기본 구조체
    return {
      nodeTypes: [],
      nodeCount: 0,
      maxDepth: 1,
      cyclomaticComplexity: 1,
      classDeclarations: [],
      methodDeclarations: [],
      variableDeclarations: [],
      methodInvocations: [],
      constructorCalls: [],
      controlStructures: [],
      exceptionHandling: [],
      annotations: [],
      inheritancePatterns: [],
      resourceLifecycles: [],
      resourceLeakRisks: [],
      securityPatterns: [],
      sqlInjectionRisks: [],
      performanceIssues: [],
      loopAnalysis: [],
      codeSmells: [],
      designPatterns: []
    };
  }

  extractASTPatterns(ast, originalCode) {
    // AST를 순회하며 코드 패턴 정보를 추출하는 visitor 생성
    const visitor = new ASTPatternVisitor(
      this.frameworkClasses,
      this.resourceTypes,
      this.securitySensitiveApis
    );
    
    // AST 트리를 깊이 우선 탐색으로 순회
    this.traverseAST(ast, visitor);
    
    return {
      // 전체 노드 구조 통계
      nodeTypes: visitor.nodeTypes,
      nodeCount: visitor.nodeCount,
      maxDepth: visitor.maxDepth,
      cyclomaticComplexity: visitor.cyclomaticComplexity,
      
      // 클래스, 메서드, 변수 선언 정보
      classDeclarations: visitor.classDeclarations,
      methodDeclarations: visitor.methodDeclarations,
      variableDeclarations: visitor.variableDeclarations,
      
      // 메서드 호출 및 생성자 호출 패턴
      methodInvocations: visitor.methodInvocations,
      constructorCalls: visitor.constructorCalls,
      
      // if, for, while 등 제어문 사용 현황
      controlStructures: visitor.controlStructures,
      exceptionHandling: visitor.exceptionHandling,
      
      // 어노테이션 및 상속 관계
      annotations: visitor.annotations,
      inheritancePatterns: visitor.inheritancePatterns,
      
      // 리소스 생성/해제 추적
      resourceLifecycles: visitor.resourceLifecycles,
      resourceLeakRisks: visitor.resourceLeakRisks,
      
      // SQL 인젝션 등 보안 위험 패턴
      securityPatterns: visitor.securityPatterns,
      sqlInjectionRisks: visitor.sqlInjectionRisks,
      
      // N+1 쿼리 등 성능 문제 패턴
      performanceIssues: visitor.performanceIssues,
      loopAnalysis: visitor.loopAnalysis,
      
      // 코드 냄새 및 디자인 패턴
      codeSmells: visitor.codeSmells,
      designPatterns: visitor.designPatterns
    };
  }

  traverseAST(node, visitor, depth = 0) {
    if (!node || typeof node !== 'object') {
      return;
    }

    // visitor의 visit 메서드 호출하여 현재 노드 처리
    visitor.visit(node, depth);
    
    // children 속성이 배열인 경우 모든 자식 노드 재귀 방문
    if (node.children && Array.isArray(node.children)) {
      node.children.forEach(child => {
        this.traverseAST(child, visitor, depth + 1);
      });
    }
    
    // location을 제외한 모든 객체/배열 속성을 재귀 탐색
    Object.keys(node).forEach(key => {
      if (key !== 'children' && key !== 'location') {
        const value = node[key];
        if (Array.isArray(value)) {
          value.forEach(item => {
            if (typeof item === 'object' && item !== null) {
              this.traverseAST(item, visitor, depth + 1);
            }
          });
        } else if (typeof value === 'object' && value !== null) {
          this.traverseAST(value, visitor, depth + 1);
        }
      }
    });
  }

  fallbackAnalysis(javaCode) {
    // AST 파싱 실패 시 정규식으로 기본적인 코드 분석 수행
    return {
      nodeTypes: this.extractNodeTypesRegex(javaCode),
      nodeCount: this.countNodesRegex(javaCode),
      maxDepth: this.estimateDepthRegex(javaCode),
      cyclomaticComplexity: this.calculateComplexityRegex(javaCode),
  
      classDeclarations: this.extractClassesRegex(javaCode),
      methodDeclarations: this.extractMethodsRegex(javaCode),
      variableDeclarations: this.extractVariablesRegex(javaCode),
      methodInvocations: this.extractMethodCallsRegex(javaCode),
      annotations: this.extractAnnotationsRegex(javaCode),
  
      controlStructures: [],
      exceptionHandling: [],
      inheritancePatterns: [],
      resourceLifecycles: this.analyzeResourcesRegex(javaCode),
      resourceLeakRisks: [],
      securityPatterns: this.analyzeSecurityRegex(javaCode),
      sqlInjectionRisks: [],
      performanceIssues: this.analyzePerformanceRegex(javaCode),
      loopAnalysis: [],
      codeSmells: [],
      designPatterns: []
    };
  }
  

  vectorizeAST(astAnalysis) {
    // AST 분석 결과를 128차원 수치 벡터로 변환 (ML 모델 입력용)
    const vector = new Array(128).fill(0);
    let index = 0;
    
    // 0-31: 노드 타입별 빈도 분포 (ClassDeclaration, MethodDeclaration 등)
    const nodeTypeDistribution = this.calculateNodeTypeDistribution(astAnalysis.nodeTypes);
    Object.values(nodeTypeDistribution).slice(0, 32).forEach(value => {
      if (index < 32) vector[index++] = value;
    });
    
    // 32-47: 코드 구조 복잡도 지표 (0~1 범위로 정규화)
    vector[index++] = Math.min(astAnalysis.maxDepth / 10.0, 1.0);
    vector[index++] = Math.min(astAnalysis.cyclomaticComplexity / 20.0, 1.0);
    vector[index++] = Math.min(astAnalysis.nodeCount / 100.0, 1.0);
    vector[index++] = Math.min(astAnalysis.methodDeclarations.length / 20.0, 1.0);
    vector[index++] = Math.min(astAnalysis.classDeclarations.length / 5.0, 1.0);
    
    // 48-63: 제어 구조별 사용 빈도 (if, for, while, switch, try)
    const controlStructureTypes = ['if', 'for', 'while', 'switch', 'try'];
    controlStructureTypes.forEach(type => {
      const count = astAnalysis.controlStructures.filter(cs => cs.type === type).length;
      if (index < 80) vector[index++] = Math.min(count / 10.0, 1.0);
    });
    
    // 64-79: 프레임워크 활용 패턴 (어노테이션, 상속, 리소스 관리)
    vector[index++] = astAnalysis.annotations.length > 0 ? 1.0 : 0.0;
    vector[index++] = astAnalysis.inheritancePatterns.length > 0 ? 1.0 : 0.0;
    vector[index++] = astAnalysis.resourceLifecycles.length > 0 ? 1.0 : 0.0;
    
    // 80-95: 잠재적 위험 패턴 점수 (리소스 누수, SQL 인젝션 등)
    vector[index++] = Math.min(astAnalysis.resourceLeakRisks.length / 5.0, 1.0);
    vector[index++] = Math.min(astAnalysis.sqlInjectionRisks.length / 3.0, 1.0);
    vector[index++] = Math.min(astAnalysis.securityPatterns.length / 5.0, 1.0);
    vector[index++] = Math.min(astAnalysis.performanceIssues.length / 5.0, 1.0);
    
    // 96-127: 코드 품질 지표 (코드 냄새, 디자인 패턴 활용)
    vector[index++] = Math.min(astAnalysis.codeSmells.length / 10.0, 1.0);
    vector[index++] = astAnalysis.designPatterns.length > 0 ? 1.0 : 0.0;
    
    return vector;
  }

  generateASTSignature(astAnalysis) {
    // AST 구조를 3가지 관점의 시그니처로 변환 (코드 검색/비교용)
    const signature = {
      // 구조적 시그니처: 노드 구성, 깊이, 복잡도
      structural: {
        nodePattern: this.generateNodePattern(astAnalysis.nodeTypes),
        depthPattern: astAnalysis.maxDepth,
        complexityPattern: astAnalysis.cyclomaticComplexity
      },
      
      // 의미론적 시그니처: 리소스 사용, 보안 패턴, 프레임워크 활용
      semantic: {
        resourcePattern: this.generateResourcePattern(astAnalysis.resourceLifecycles),
        securityPattern: this.generateSecurityPattern(astAnalysis.securityPatterns),
        frameworkPattern: this.generateFrameworkPattern(astAnalysis.annotations, astAnalysis.inheritancePatterns)
      },
      
      // 행동 패턴 시그니처: 메서드 호출 순서, 제어 흐름, 예외 처리
      behavioral: {
        methodCallPattern: this.generateMethodCallPattern(astAnalysis.methodInvocations),
        controlFlowPattern: this.generateControlFlowPattern(astAnalysis.controlStructures),
        exceptionPattern: this.generateExceptionPattern(astAnalysis.exceptionHandling)
      }
    };
    
    return signature;
  }

  calculateNodeTypeDistribution(nodeTypes) {
    // 각 노드 타입의 출현 비율 계산
    const distribution = {};
    const total = nodeTypes.length;
    
    nodeTypes.forEach(type => {
      distribution[type] = (distribution[type] || 0) + 1;
    });
    
    Object.keys(distribution).forEach(type => {
      distribution[type] = distribution[type] / total;
    });
    
    return distribution;
  }

  generateNodePattern(nodeTypes) {
    // 상위 10개 노드를 화살표로 연결한 패턴 문자열 생성
    return nodeTypes.slice(0, 10).join('->');
  }

  generateResourcePattern(resourceLifecycles) {
    // "리소스타입:생명주기단계" 형식의 패턴 문자열 생성
    return resourceLifecycles.map(r => `${r.type}:${r.stage}`).join(',');
  }

  generateSecurityPattern(securityPatterns) {
    // 보안 패턴 타입들을 쉼표로 연결한 문자열 생성
    return securityPatterns.map(p => p.type).join(',');
  }

  generateFrameworkPattern(annotations, inheritance) {
    // 어노테이션(@Service 등)과 상속 관계를 결합한 패턴 생성
    const patterns = [
      ...annotations.map(a => `@${a.name}`),
      ...inheritance.map(i => `extends:${i.parentClass}`)
    ];
    return patterns.join(',');
  }

  generateMethodCallPattern(methodInvocations) {
    // 상위 5개 메서드 호출을 "객체.메서드" 형식으로 연결
    return methodInvocations
      .slice(0, 5)
      .map(m => `${m.target || 'this'}.${m.method}`)
      .join('->');
  }

  generateControlFlowPattern(controlStructures) {
    // 제어 구조 타입들을 순서대로 화살표로 연결
    return controlStructures.map(cs => cs.type).join('->');
  }

  generateExceptionPattern(exceptionHandling) {
    // 예외 처리 타입들을 쉼표로 연결한 문자열 생성
    return exceptionHandling.map(eh => eh.type).join(',');
  }

  extractNodeTypesRegex(code) {
    // 정규식으로 주요 구문 타입 추출 (class, method, if, for 등)
    const patterns = {
      'ClassDeclaration': /class\s+\w+/g,
      'MethodDeclaration': /\w+\s*\([^)]*\)\s*\{/g,
      'VariableDeclaration': /\w+\s+\w+\s*=/g,
      'IfStatement': /if\s*\(/g,
      'ForStatement': /for\s*\(/g,
      'WhileStatement': /while\s*\(/g,
      'TryStatement': /try\s*\{/g
    };
    
    const nodeTypes = [];
    Object.entries(patterns).forEach(([type, pattern]) => {
      const matches = code.match(pattern) || [];
      matches.forEach(() => nodeTypes.push(type));
    });
    
    return nodeTypes;
  }

  countNodesRegex(code) {
    // 정규식으로 추출한 노드 타입의 총 개수 계산
    return this.extractNodeTypesRegex(code).length;
  }

  estimateDepthRegex(code) {
    // 중괄호 쌍으로 코드 블록의 최대 중첩 깊이 계산
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

  calculateComplexityRegex(code) {
    // if, for, while 등 분기 구문 개수로 순환 복잡도 추정
    const complexityPatterns = /if|for|while|switch|case|catch|\?\s*:/g;
    const matches = code.match(complexityPatterns) || [];
    return matches.length + 1;
  }

  extractClassesRegex(code) {
    // 클래스 선언문에서 이름, 상속, 구현 인터페이스 추출
    const classPattern = /(?:public\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+([\w,\s]+))?/g;
    const classes = [];
    let match;
    
    while ((match = classPattern.exec(code)) !== null) {
      classes.push({
        name: match[1],
        extends: match[2] || null,
        implements: match[3] ? match[3].split(',').map(i => i.trim()) : []
      });
    }
    
    return classes;
  }

  extractMethodsRegex(code) {
    // 메서드 선언문에서 반환 타입, 이름, 매개변수 추출
    const methodPattern = /(?:public|private|protected)?\s*(?:static)?\s*(\w+)\s+(\w+)\s*\(([^)]*)\)/g;
    const methods = [];
    let match;
    
    while ((match = methodPattern.exec(code)) !== null) {
      methods.push({
        returnType: match[1],
        name: match[2],
        parameters: match[3].trim()
      });
    }
    
    return methods;
  }

  extractVariablesRegex(code) {
    // 변수 선언문에서 타입, 이름, 초기화 여부 추출
    const varPattern = /(?:private|public|protected)?\s*(\w+)\s+(\w+)\s*(?:=([^;]+))?;/g;
    const variables = [];
    let match;
    
    while ((match = varPattern.exec(code)) !== null) {
      variables.push({
        type: match[1],
        name: match[2],
        hasInitializer: !!match[3]
      });
    }
    
    return variables;
  }

  extractMethodCallsRegex(code) {
    // "객체.메서드(" 패턴으로 메서드 호출 추출
    const callPattern = /(\w+)\.(\w+)\s*\(/g;
    const calls = [];
    let match;
    
    while ((match = callPattern.exec(code)) !== null) {
      calls.push({
        target: match[1],
        method: match[2]
      });
    }
    
    return calls;
  }

  extractAnnotationsRegex(code) {
    // @어노테이션 패턴으로 어노테이션 추출
    const annotationPattern = /@(\w+)(?:\([^)]*\))?/g;
    const annotations = [];
    let match;
    
    while ((match = annotationPattern.exec(code)) !== null) {
      annotations.push({
        name: match[1]
      });
    }
    
    return annotations;
  }

  analyzeResourcesRegex(code) {
    // Connection, FileStream 등 리소스의 생성/해제 패턴 분석
    const resources = [];
    
    this.resourceTypes.forEach(resourceType => {
      const pattern = new RegExp(`${resourceType}\\s+(\\w+)\\s*=`, 'g');
      let match;
      
      while ((match = pattern.exec(code)) !== null) {
        const varName = match[1];
        
        // try-with-resources 구문 내에 있는지 확인
        const tryWithResourcesPattern = new RegExp(`try\\s*\\([^)]*${varName}[^)]*\\)`, 'g');
        const inTryWithResources = tryWithResourcesPattern.test(code);
        
        // 명시적 close() 호출이 있는지 확인
        const closePattern = new RegExp(`${varName}\\.close\\(\\)`, 'g');
        const hasCloseCall = closePattern.test(code);
        
        resources.push({
          type: resourceType,
          variable: varName,
          inTryWithResources,
          hasCloseCall,
          riskLevel: (!inTryWithResources && !hasCloseCall) ? 'HIGH' : 'LOW'
        });
      }
    });
    
    return resources;
  }

  analyzeSecurityRegex(code) {
    // SQL 인젝션, XSS 등 보안 취약점 패턴 탐지
    const securityIssues = [];
    
    // SQL 쿼리에서 문자열 연결(+) 사용 시 SQL 인젝션 위험
    if (code.includes('executeQuery') || code.includes('executeUpdate')) {
      const sqlConcatPattern = /["'].*\+.*["']/g;
      if (sqlConcatPattern.test(code)) {
        securityIssues.push({
          type: 'sql_injection',
          description: 'String concatenation in SQL query',
          severity: 'HIGH'
        });
      }
    }
    
    // 사용자 입력을 인코딩 없이 직접 출력 시 XSS 위험
    if (code.includes('getWriter') && code.includes('println')) {
      securityIssues.push({
        type: 'xss',
        description: 'Direct output without encoding',
        severity: 'MEDIUM'
      });
    }
    
    return securityIssues;
  }

  analyzePerformanceRegex(code) {
    // 루프 내 데이터베이스 쿼리 등 성능 문제 패턴 탐지
    const performanceIssues = [];
    
    // 반복문 안에서 데이터베이스 쿼리 실행 시 N+1 문제 발생
    const loopWithQueryPattern = /(for|while)\s*\([^)]*\)\s*\{[^}]*(?:executeQuery|find|get)[^}]*\}/g;
    if (loopWithQueryPattern.test(code)) {
      performanceIssues.push({
        type: 'n_plus_one_query',
        description: 'Database query inside loop',
        severity: 'HIGH'
      });
    }
    
    return performanceIssues;
  }
}

class ASTPatternVisitor {
  constructor(frameworkClasses, resourceTypes, securitySensitiveApis) {
    this.frameworkClasses = frameworkClasses;
    this.resourceTypes = resourceTypes;
    this.securitySensitiveApis = securitySensitiveApis;
    
    // AST 순회하며 수집할 데이터 저장소
    this.nodeTypes = [];
    this.nodeCount = 0;
    this.maxDepth = 0;
    this.cyclomaticComplexity = 1;
    
    this.classDeclarations = [];
    this.methodDeclarations = [];
    this.variableDeclarations = [];
    
    this.methodInvocations = [];
    this.constructorCalls = [];
    
    this.controlStructures = [];
    this.exceptionHandling = [];
    
    this.annotations = [];
    this.inheritancePatterns = [];
    
    this.resourceLifecycles = [];
    this.resourceLeakRisks = [];
    
    this.securityPatterns = [];
    this.sqlInjectionRisks = [];
    
    this.performanceIssues = [];
    this.loopAnalysis = [];
    
    this.codeSmells = [];
    this.designPatterns = [];
    
    // AST 순회 중 현재 컨텍스트 추적
    this.currentClass = null;
    this.currentMethod = null;
    this.inLoop = false;
    this.resources = new Map(); // 변수명 -> {type, declared, closed, inTryWithResources}
  }

  visit(node, depth) {
    if (!node || !node.type) return;
    
    // 노드 개수와 최대 깊이 업데이트
    this.nodeCount++;
    this.maxDepth = Math.max(this.maxDepth, depth);
    this.nodeTypes.push(node.type);
    
    // 노드 타입에 따라 해당 처리 메서드 호출
    switch (node.type) {
      case 'ClassDeclaration':
        this.visitClassDeclaration(node);
        break;
      case 'MethodDeclaration':
        this.visitMethodDeclaration(node);
        break;
      case 'VariableDeclaration':
        this.visitVariableDeclaration(node);
        break;
      case 'MethodInvocation':
        this.visitMethodInvocation(node);
        break;
      case 'IfStatement':
        this.visitIfStatement(node);
        break;
      case 'ForStatement':
      case 'WhileStatement':
        this.visitLoopStatement(node);
        break;
      case 'TryStatement':
        this.visitTryStatement(node);
        break;
      case 'Annotation':
        this.visitAnnotation(node);
        break;
    }
  }

  visitClassDeclaration(node) {
    // 클래스 정보 추출 및 현재 클래스 컨텍스트 설정
    this.currentClass = {
      name: node.name?.name || 'Unknown',
      superClass: node.superClass?.name || null,
      interfaces: node.interfaces?.map(i => i.name) || []
    };
    
    this.classDeclarations.push(this.currentClass);
    
    // 부모 클래스가 프레임워크 클래스인지 확인하여 상속 패턴 기록
    if (this.currentClass.superClass) {
      this.inheritancePatterns.push({
        childClass: this.currentClass.name,
        parentClass: this.currentClass.superClass,
        isFrameworkClass: this.frameworkClasses.includes(this.currentClass.superClass)
      });
    }
  }

  visitMethodDeclaration(node) {
    // 메서드 정보 추출 및 현재 메서드 컨텍스트 설정
    this.currentMethod = {
      name: node.name?.name || 'Unknown',
      returnType: node.returnType?.name || 'void',
      parameters: node.parameters?.length || 0,
      modifiers: node.modifiers || []
    };
    
    this.methodDeclarations.push(this.currentMethod);
  }

  visitVariableDeclaration(node) {
    if (node.type && node.declarators) {
      node.declarators.forEach(declarator => {
        const varInfo = {
          name: declarator.name?.name || 'Unknown',
          type: node.type.name || 'Unknown',
          hasInitializer: !!declarator.initializer,
          isResource: this.resourceTypes.includes(node.type.name),
          context: this.currentMethod?.name || this.currentClass?.name || 'global'
        };
        
        this.variableDeclarations.push(varInfo);
        
        // Connection, FileStream 등 리소스 타입 변수는 별도 추적
        if (varInfo.isResource) {
          this.resources.set(varInfo.name, {
            type: varInfo.type,
            declared: true,
            closed: false,
            inTryWithResources: false
          });
        }
      });
    }
  }

  visitMethodInvocation(node) {
    // 메서드 호출 정보를 추출하고 루프 내 호출 여부 기록
    const methodCall = {
      method: node.name?.name || 'Unknown',
      target: node.target?.name || null,
      arguments: node.arguments?.length || 0,
      context: this.currentMethod?.name || 'Unknown',
      inLoop: this.inLoop
    };
    
    this.methodInvocations.push(methodCall);
    
    // executeQuery 등 보안 민감 API 호출 패턴 분석
    this.analyzeSecurityPattern(methodCall);
    
    // 루프 내 DB 쿼리 등 성능 문제 패턴 분석
    this.analyzePerformancePattern(methodCall);
    
    // close() 메서드 호출로 리소스 해제 추적
    this.analyzeResourceManagement(methodCall);
  }

  visitIfStatement(node) {
    // if문은 순환 복잡도를 1 증가시킴
    this.cyclomaticComplexity++;
    this.controlStructures.push({
      type: 'if',
      hasElse: !!node.elseStatement,
      context: this.currentMethod?.name || 'Unknown'
    });
  }

  visitLoopStatement(node) {
    // 루프문은 순환 복잡도를 1 증가시키고 루프 컨텍스트 설정
    this.cyclomaticComplexity++;
    const wasInLoop = this.inLoop;
    this.inLoop = true;
    
    this.controlStructures.push({
      type: node.type.toLowerCase().replace('statement', ''),
      context: this.currentMethod?.name || 'Unknown'
    });
    
    this.loopAnalysis.push({
      type: node.type,
      hasComplexBody: this.estimateLoopComplexity(node),
      context: this.currentMethod?.name || 'Unknown'
    });
    
    // 루프 처리 완료 후 이전 루프 상태로 복원
    this.inLoop = wasInLoop;
  }

  visitTryStatement(node) {
    // try-catch-finally 구조 분석 및 try-with-resources 확인
    const tryInfo = {
      type: 'try_catch',
      hasResources: !!(node.resources && node.resources.length > 0),
      catchCount: node.catches?.length || 0,
      hasFinally: !!node.finallyBlock,
      context: this.currentMethod?.name || 'Unknown'
    };
    
    this.exceptionHandling.push(tryInfo);
    
    // try-with-resources 구문의 리소스 변수는 자동 해제됨을 표시
    if (tryInfo.hasResources) {
      node.resources.forEach(resource => {
        if (resource.name) {
          const resourceName = resource.name.name;
          if (this.resources.has(resourceName)) {
            this.resources.get(resourceName).inTryWithResources = true;
          }
        }
      });
    }
  }

  visitAnnotation(node) {
    // @Service, @Override 등 어노테이션 정보 추출
    this.annotations.push({
      name: node.name?.name || 'Unknown',
      context: this.currentMethod?.name || this.currentClass?.name || 'Unknown'
    });
  }

  analyzeSecurityPattern(methodCall) {
    // executeQuery, encrypt 등 보안 민감 API 호출 기록
    if (this.securitySensitiveApis.includes(methodCall.method)) {
      this.securityPatterns.push({
        type: 'sensitive_api_call',
        method: methodCall.method,
        context: methodCall.context
      });
      
      // SQL 실행 메서드는 SQL 인젝션 잠재 위험으로 기록
      if (['executeQuery', 'executeUpdate', 'execute'].includes(methodCall.method)) {
        this.sqlInjectionRisks.push({
          method: methodCall.method,
          context: methodCall.context,
          riskLevel: 'MEDIUM'
        });
      }
    }
  }

  analyzePerformancePattern(methodCall) {
    // 루프 안에서 DB 쿼리 실행 시 N+1 문제로 기록
    if (methodCall.inLoop && ['executeQuery', 'find', 'get'].includes(methodCall.method)) {
      this.performanceIssues.push({
        type: 'n_plus_one_query',
        method: methodCall.method,
        context: methodCall.context,
        severity: 'HIGH'
      });
    }
  }

  analyzeResourceManagement(methodCall) {
    // close() 메서드 호출 시 해당 리소스를 해제됨으로 표시
    if (methodCall.method === 'close' && methodCall.target) {
      if (this.resources.has(methodCall.target)) {
        this.resources.get(methodCall.target).closed = true;
      }
    }
  }

  estimateLoopComplexity(node) {
    // 루프 본문의 복잡도 추정 (실제 구현에서는 더 정교한 분석 필요)
    return false;
  }

  finalize() {
    // AST 순회 완료 후 리소스 누수 위험 최종 분석
    this.resources.forEach((resourceInfo, varName) => {
      // try-with-resources도 없고 close()도 호출 안 된 경우 누수 위험
      if (!resourceInfo.inTryWithResources && !resourceInfo.closed) {
        this.resourceLeakRisks.push({
          variable: varName,
          type: resourceInfo.type,
          riskLevel: 'HIGH',
          reason: 'No close() call and not in try-with-resources'
        });
      }
    });
  }
}