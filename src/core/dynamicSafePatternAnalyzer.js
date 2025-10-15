import { JavaASTParser } from '../ast/javaAstParser.js';
import { LLMService } from '../clients/llmService.js';
import { WeaviateClient } from '../clients/weaviateClient.js';
import { config } from '../config.js';

/**
 * 동적 안전 패턴 분석기
 * Weaviate VectorDB에 저장된 코드 패턴을 로드하여
 * 안전한 구현 패턴과 문제가 있는 안티패턴으로 분류하고,
 * 소스 코드 분석 시 이를 활용하여 이슈를 탐지하고 권장사항을 제시
 */
export class DynamicSafePatternAnalyzer {
  constructor() {
    this.astParser = new JavaASTParser();
    this.llmService = new LLMService();
    this.vectorClient = new WeaviateClient();
    this.safePatternCache = new Map(); // 카테고리별 안전한 패턴 저장 (category -> pattern)
    this.antiPatternCache = new Map(); // 문제 패턴 저장 (uniqueKey -> pattern)
  }

  async initialize() {
    console.log('🚀 동적 패턴 분석기 초기화 중...');

    const isConnected = await this.llmService.checkConnection();
    if (!isConnected) {
      throw new Error('LLM 서비스 연결 실패');
    }

    // VectorDB에서 모든 패턴을 가져와 안전/문제 패턴으로 분류하여 캐시에 저장
    await this.loadAndClassifyPatterns();

    console.log('✅ 동적 패턴 분석기 초기화 완료');
    console.log(`  📊 안전한 패턴: ${this.safePatternCache.size}개`);
    console.log(`  ⚠️  문제 패턴: ${this.antiPatternCache.size}개`);
  }

  /**
   * Weaviate 스키마의 다양한 필드명 형식을 정규화
   * (snake_case, camelCase, properties 래핑 등 모두 처리)
   */
  normalizePatternFields(raw) {
    const p = raw || {};
    // Weaviate가 properties로 래핑하는 경우 대비
    const props = p.properties || p;

    // 다양한 필드명 변형에 대응하여 통일된 값 추출
    const issueRecordId =
      props.issue_record_id || props.issueRecordId || props.id || props.uuid;

    const metadata = props.metadata || {};
    const title =
      metadata.title || props.title || props.metadata_title || props.name;

    const category =
      props.category || metadata.category || props.type || props.kind;

    const recommended =
      props.recommended_pattern || props.recommendedPattern || props.recPattern;

    const anti =
      props.anti_pattern || props.antiPattern || props.badPattern;

    return { issueRecordId, title, category, recommended, anti, raw: props };
  }

  /**
   * VectorDB에서 모든 패턴을 조회하여
   * recommended_pattern이 있으면 안전한 패턴 캐시에,
   * anti_pattern이 있으면 문제 패턴 캐시에 분류하여 저장
   */
  async loadAndClassifyPatterns() {
    try {
      const allPatterns = await this.vectorClient.getAllPatterns();
      console.log(`🔍 로드된 전체 패턴: ${allPatterns.length}개`);

      for (const pattern of allPatterns) {
        const { issueRecordId, title, category, recommended, anti } =
          this.normalizePatternFields(pattern);

        console.log(`📋 처리 중인 패턴: ${title || issueRecordId} (${category})`);

        // recommended_pattern의 code_template이 존재하면 안전한 패턴으로 등록
        if (recommended && recommended.code_template) {
          console.log(`  ✅ 안전한 패턴으로 분류: ${category}`);
          const safePattern = this.extractSafePattern({ category, recommended_pattern: recommended, metadata: { title } });
          if (safePattern) this.safePatternCache.set(category, safePattern);
        }

        // anti_pattern의 code_template이 존재하면 문제 패턴으로 등록
        if (anti && anti.code_template) {
          console.log(`  ⚠️ 문제 패턴으로 분류: ${category}`);
          const key = `${category}_${issueRecordId || title || Math.random().toString(36).slice(2)}`;
          const antiPattern = this.extractAntiPattern({ category, anti_pattern: anti, metadata: { title }, issue_record_id: issueRecordId });
          if (antiPattern) this.antiPatternCache.set(key, antiPattern);
        }

        if (!(recommended && recommended.code_template) && !(anti && anti.code_template)) {
          console.log(`  ⚠️ 패턴에 recommended_pattern 또는 anti_pattern 정보 없음`);
        }
      }

      console.log('📋 패턴 분류 완료');
      console.log(`  ✅ 안전한 패턴: ${this.safePatternCache.size}개`);
      console.log(`  ⚠️ 문제 패턴: ${this.antiPatternCache.size}개`);

      // 분류된 패턴 목록 출력 (디버깅용)
      if (this.safePatternCache.size > 0) {
        console.log('  📋 안전한 패턴 목록:');
        for (const [category, pattern] of this.safePatternCache) {
          console.log(`    - ${category}: ${pattern.patternName}`);
        }
      }

      if (this.antiPatternCache.size > 0) {
        console.log('  📋 문제 패턴 목록:');
        for (const [key, pattern] of this.antiPatternCache) {
          console.log(`    - ${key}: ${pattern.title}`);
        }
      }

    } catch (error) {
      console.warn('⚠️ 패턴 로드 실패, 기본 패턴 사용:', error.message);
      this.initializeFallbackPatterns();
    }
  }

  /**
   * recommended_pattern 객체에서 안전한 구현 정보를 추출하여
   * 탐지 규칙, 시그니처, 베스트 프랙티스 등을 포함한 객체로 변환
   */
  extractSafePattern(pattern) {
    const recommendedPattern = pattern.recommended_pattern;
    const category = pattern.category;

    if (!recommendedPattern.code_template) {
      return null;
    }

    return {
      category: category,
      patternName: recommendedPattern.pattern_name || 'safe_pattern',
      codeTemplate: recommendedPattern.code_template,
      detectionRules: this.generateDetectionRules(recommendedPattern, category),
      bestPractices: recommendedPattern.implementation_guide?.best_practices || [],
      frameworkNotes: recommendedPattern.implementation_guide?.framework_specific_notes || [],

      // 코드에서 이 패턴을 찾기 위한 키워드, 정규식 등의 시그니처
      signatures: this.extractPatternSignatures(recommendedPattern.code_template, category)
    };
  }

  /**
   * anti_pattern 객체에서 문제가 있는 구현 정보를 추출하여
   * 시그니처와 문제점 특성을 포함한 객체로 변환
   */
  extractAntiPattern(pattern) {
    const antiPattern = pattern.anti_pattern;
    const category = pattern.category;

    if (!antiPattern.code_template) {
      return null;
    }

    return {
      category: category,
      title: pattern.metadata?.title || 'anti_pattern',
      codeTemplate: antiPattern.code_template,
      severity: pattern.metadata?.severity || 'MEDIUM',
      signatures: this.extractPatternSignatures(antiPattern.code_template, category),
      problematicCharacteristics: antiPattern.problematic_characteristics || {}
    };
  }

  /**
   * 코드 템플릿과 카테고리를 분석하여
   * 패턴 매칭에 사용할 키워드, 정규식, 구조적 특징을 추출
   */
  extractPatternSignatures(codeTemplate, category) {
    const signatures = {
      keywords: [],
      patterns: [],
      structures: []
    };

    switch (category) {
      case 'resource_management':
        signatures.keywords = this.extractKeywords(codeTemplate, [
          'try-with-resources', 'try \\(', 'Connection', 'close\\(\\)',
          'PreparedStatement', 'ResultSet', 'finally', 'AutoCloseable'
        ]);
        signatures.patterns = [
          /try\s*\([^)]*(?:Connection|Statement|ResultSet)[^)]*\)/,
          /\.close\s*\(\s*\)/,
          /finally\s*\{[^}]*\.close\s*\(\s*\)/
        ];
        break;

      case 'security_vulnerability':
        signatures.keywords = this.extractKeywords(codeTemplate, [
          'PreparedStatement', 'setString', 'setInt', '\\?', 'parameterized',
          'bind', 'placeholder'
        ]);
        signatures.patterns = [
          /PreparedStatement.*setString\s*\(\s*\d+/,
          /prepareStatement.*\?\s*[,)]/,
          /(?!.*\+.*executeQuery)/
        ];
        break;

      case 'performance_issue':
        signatures.keywords = this.extractKeywords(codeTemplate, [
          'JOIN', 'batch', 'IN \\(', 'ArrayList', 'HashMap', 'LinkedList'
        ]);
        signatures.patterns = [
          /(?:INNER|LEFT|RIGHT)?\s*JOIN/i,
          /IN\s*\([^)]*\?\s*[,)]/,
          /batch/i
        ];
        break;

      case 'exception_handling':
        signatures.keywords = this.extractKeywords(codeTemplate, [
          'logger\\.', 'log\\.', 'catch', 'throw', '@Transactional',
          'try', 'finally'
        ]);
        signatures.patterns = [
          /logger\.(error|warn|info|debug)/,
          /@Transactional/,
          /catch\s*\([^)]*Exception[^)]*\)/
        ];
        break;
    }

    return signatures;
  }

  /**
   * 코드 템플릿에서 주어진 키워드 패턴들과 매칭되는 모든 키워드를 추출
   * (정규식 패턴 리스트를 순회하며 매칭 수행, 중복 제거)
   */
  extractKeywords(codeTemplate, keywordPatterns) {
    const keywords = [];
    keywordPatterns.forEach(pattern => {
      const regex = new RegExp(pattern, 'gi');
      const matches = codeTemplate.match(regex);
      if (matches) {
        keywords.push(...matches);
      }
    });
    return [...new Set(keywords)];
  }

  /**
   * recommended_pattern의 code_template을 분석하여
   * 실제 코드에서 이 패턴을 탐지하기 위한 정규식 기반 규칙을 생성
   * (try-with-resources, PreparedStatement, JOIN, logger 사용 등)
   */
  generateDetectionRules(recommendedPattern, category) {
    const rules = [];

    const codeTemplate = recommendedPattern.code_template;

    if (codeTemplate.includes('try (') && category === 'resource_management') {
      rules.push({
        type: 'try_with_resources',
        pattern: /try\s*\([^)]*(?:Connection|Statement|ResultSet|Stream|Reader|Writer)[^)]*\)/,
        description: 'Try-with-resources 자동 리소스 관리'
      });
    }

    if (codeTemplate.includes('PreparedStatement') && codeTemplate.includes('setString')) {
      rules.push({
        type: 'parameterized_query',
        pattern: /PreparedStatement.*setString\s*\(\s*\d+/,
        description: 'PreparedStatement 파라미터 바인딩'
      });
    }

    if (codeTemplate.includes('JOIN') || codeTemplate.includes('batch')) {
      rules.push({
        type: 'optimized_query',
        pattern: /(?:JOIN|batch|IN\s*\()/i,
        description: 'JOIN 쿼리 또는 배치 처리'
      });
    }

    if (codeTemplate.includes('logger.') && category === 'exception_handling') {
      rules.push({
        type: 'proper_logging',
        pattern: /logger\.(error|warn|info|debug)/,
        description: 'Logger를 통한 적절한 예외 처리'
      });
    }

    if (codeTemplate.includes('@Transactional')) {
      rules.push({
        type: 'transaction_management',
        pattern: /@Transactional/,
        description: '@Transactional 트랜잭션 관리'
      });
    }

    return rules;
  }

  /**
   * 소스 코드를 분석하여 캐시된 안전한 패턴들 중 어떤 것이 구현되어 있는지 확인
   * (각 패턴의 detectionRules를 순회하며 매칭 수행)
   */
  checkForSafePracticesDynamic(sourceCode) {
    const safePractices = [];

    for (const [category, safePattern] of this.safePatternCache) {
      const detectedPatterns = this.matchSafePattern(sourceCode, safePattern);
      safePractices.push(...detectedPatterns);
    }

    return safePractices;
  }

  /**
   * 특정 안전한 패턴의 탐지 규칙들을 소스 코드에 적용하여
   * 매칭되는 패턴들의 목록을 반환
   */
  matchSafePattern(sourceCode, safePattern) {
    const matchedPatterns = [];

    for (const rule of safePattern.detectionRules) {
      if (rule.pattern.test(sourceCode)) {
        matchedPatterns.push({
          type: rule.type,
          category: safePattern.category,
          description: rule.description,
          patternName: safePattern.patternName,
          confidence: 0.9
        });
      }
    }

    return matchedPatterns;
  }

  /**
   * 특정 카테고리의 안전한 구현이 탐지된 패턴 목록에 포함되어 있는지 확인
   */
  isCategorySafelyImplementedDynamic(category, detectedSafePractices) {
    return detectedSafePractices.some(practice => practice.category === category);
  }

  /**
   * VectorDB 검색 결과로 받은 유사 패턴들을
   * recommended_pattern/anti_pattern 존재 여부에 따라 분류
   * (하나의 패턴이 둘 다 가질 수 있으므로 독립적으로 처리)
   */
  classifySimilarPatterns(similarPatterns) {
    console.log(`\n🔍 유사 패턴 분류 시작 (총 ${similarPatterns.length}개)`);

    const classification = {
      safePatterns: [],
      antiPatterns: []
    };

    similarPatterns.forEach((pattern, index) => {
      console.log(`📋 패턴 ${index + 1} 분석: ${pattern.metadata?.title || pattern.issue_record_id}`);
      console.log(`  카테고리: ${pattern.category}`);
      console.log(`  recommended_pattern 존재: ${pattern.recommended_pattern ? 'YES' : 'NO'}`);
      console.log(`  anti_pattern 존재: ${pattern.anti_pattern ? 'YES' : 'NO'}`);

      // recommended_pattern.code_template이 있으면 안전한 패턴으로 추가
      if (pattern.recommended_pattern && pattern.recommended_pattern.code_template) {
        console.log(`  ✅ 안전한 패턴 정보 추가`);
        classification.safePatterns.push({
          ...pattern,
          type: 'safe_pattern'
        });
      }

      // anti_pattern.code_template이 있으면 문제 패턴으로 추가 (독립적)
      if (pattern.anti_pattern && pattern.anti_pattern.code_template) {
        console.log(`  ⚠️ 문제 패턴으로 분류`);
        classification.antiPatterns.push({
          ...pattern,
          type: 'anti_pattern'
        });
      }

      // 둘 다 없으면 하위 호환성을 위해 문제 패턴으로 간주
      if (!pattern.recommended_pattern && !pattern.anti_pattern) {
        console.log(`  ⚠️ 패턴 정보 없음, 기본적으로 문제 패턴으로 분류`);
        classification.antiPatterns.push({
          ...pattern,
          type: 'anti_pattern'
        });
      }
    });

    console.log(`📊 분류 결과:`);
    console.log(`  ✅ 안전한 패턴: ${classification.safePatterns.length}개`);
    console.log(`  ⚠️ 문제 패턴: ${classification.antiPatterns.length}개`);

    return classification;
  }

  /**
   * 주어진 문제 패턴 목록을 소스 코드와 매칭하여
   * 실제로 코드에 존재하는 이슈들을 탐지
   */
  async findIssuesUsingDynamicPatterns(sourceCode, antiPatterns) {
    console.log(`\n🔍 동적 패턴 매칭 시작 (문제 패턴 ${antiPatterns.length}개 검사)`);
    const issues = [];

    for (const pattern of antiPatterns) {
      console.log(`📋 패턴 검사 중: ${pattern.metadata?.title || pattern.title} (${pattern.category})`);

      const matches = await this.matchAntiPattern(sourceCode, pattern);
      console.log(`  발견된 매치: ${matches.length}개`);

      if (matches.length > 0) {
        issues.push(...matches);
        matches.forEach((match, idx) => {
          console.log(`    ${idx + 1}. 라인 ${match.startLine}: ${match.description}`);
        });
      }
    }

    console.log(`📊 동적 패턴 매칭 결과: ${issues.length}개 이슈 발견`);
    return issues;
  }

  /**
   * 문제 패턴을 소스 코드와 매칭
   * 1. pattern_signature의 regex_patterns로 매칭 시도
   * 2. 카테고리별 특화된 추가 검사 수행
   */
  async matchAntiPattern(sourceCode, antiPattern) {
    const matches = [];
    const lines = sourceCode.split('\n');

    // anti_pattern.pattern_signature에 정의된 정규식 패턴으로 매칭
    const signatures = antiPattern.anti_pattern?.pattern_signature || {};

    if (signatures.regex_patterns && Array.isArray(signatures.regex_patterns)) {
      console.log(`  정규식 패턴 검사: ${signatures.regex_patterns.length}개`);

      for (const regexPattern of signatures.regex_patterns) {
        try {
          const regex = new RegExp(regexPattern, 'gm');
          let match;

          while ((match = regex.exec(sourceCode)) !== null) {
            const lineNum = this.getLineNumberFromIndex(sourceCode, match.index);

            matches.push({
              type: antiPattern.category,
              startLine: lineNum,
              endLine: lineNum,
              confidence: 0.8,
              description: antiPattern.metadata?.title || 'Pattern match',
              matchedText: match[0],
              patternId: antiPattern.issue_record_id,
              severity: antiPattern.metadata?.severity || 'MEDIUM'
            });
          }
        } catch (error) {
          console.warn(`    정규식 오류: ${regexPattern} - ${error.message}`);
        }
      }
    }

    // 카테고리별로 특화된 추가 검사 수행
    const additionalMatches = await this.performCategorySpecificMatching(sourceCode, antiPattern);
    matches.push(...additionalMatches);

    return matches;
  }

  /**
   * 카테고리별로 실제 문제 코드를 탐지하기 위한 구체적인 로직 수행
   * - resource_management: close() 누락, try-with-resources 미사용 탐지
   * - security_vulnerability: SQL Injection 위험 패턴 탐지
   * - performance_issue: N+1 쿼리 문제 탐지
   * - exception_handling: printStackTrace() 등 부적절한 예외 처리 탐지
   */
  async performCategorySpecificMatching(sourceCode, antiPattern) {
    const matches = [];
    const lines = sourceCode.split('\n');
    const category = antiPattern.category;

    switch (category) {
      case 'resource_management':
        // getConnection()이 있지만 close()나 try-with-resources가 없는 경우 탐지
        lines.forEach((line, index) => {
          const trimmed = line.trim();
          if (trimmed.includes('getConnection()') && !trimmed.startsWith('//')) {
            const contextLines = lines.slice(Math.max(0, index - 3), Math.min(lines.length, index + 10));
            const hasClose = contextLines.some(l => l.includes('.close()'));
            const hasTryWithResources = contextLines.some(l => /try\s*\([^)]*Connection[^)]*\)/.test(l));

            if (!hasClose && !hasTryWithResources) {
              matches.push({
                type: 'connection_leak',
                startLine: index + 1,
                endLine: index + 1,
                confidence: 0.9,
                description: 'Database Connection이 닫히지 않아 리소스 누수 위험',
                matchedText: trimmed
              });
            }
          }
        });
        break;

      case 'security_vulnerability':
        // 문자열 연결로 SQL을 생성하는 위험한 패턴 탐지
        lines.forEach((line, index) => {
          const trimmed = line.trim();
          if ((/String\s+sql\s*=.*\+\s*\w+/.test(trimmed) &&
            !/FROM|JOIN|ORDER|GROUP|SELECT|INSERT|UPDATE|DELETE/.test(trimmed.split('+')[1])) ||
            /executeUpdate.*\+\s*\w+/.test(trimmed)) {
            matches.push({
              type: 'sql_injection',
              startLine: index + 1,
              endLine: index + 1,
              confidence: 0.95,
              description: 'SQL Injection 취약점: 문자열 연결로 SQL 생성',
              matchedText: trimmed
            });
          }
        });
        break;

      case 'performance_issue':
        // ResultSet 루프 내에서 추가 DB 호출이 있는 N+1 쿼리 문제 탐지
        let inLoop = false;
        let loopStart = -1;

        lines.forEach((line, index) => {
          const trimmed = line.trim();

          if (/while\s*\(.*rs\.next\(\)/.test(trimmed)) {
            inLoop = true;
            loopStart = index + 1;
          }

          if (inLoop && trimmed.includes('}')) {
            const loopContent = lines.slice(loopStart - 1, index + 1).join('\n');
            if (loopContent.includes('getConnection()') || loopContent.includes('executeQuery')) {
              matches.push({
                type: 'n_plus_one',
                startLine: loopStart,
                endLine: index + 1,
                confidence: 0.85,
                description: 'N+1 쿼리 성능 문제',
                details: '루프 내에서 개별 데이터베이스 쿼리 실행'
              });
            }
            inLoop = false;
          }
        });
        break;

      case 'exception_handling':
        // printStackTrace() 사용으로 인한 부적절한 예외 처리 탐지
        lines.forEach((line, index) => {
          const trimmed = line.trim();
          if (trimmed.includes('printStackTrace()')) {
            matches.push({
              type: 'poor_exception_handling',
              startLine: index + 1,
              endLine: index + 1,
              confidence: 0.8,
              description: 'printStackTrace() 사용으로 부적절한 예외 처리',
              matchedText: trimmed
            });
          }
        });
        break;
    }

    return matches;
  }

  /**
   * 텍스트 내 특정 인덱스 위치가 몇 번째 라인인지 계산
   */
  getLineNumberFromIndex(text, index) {
    return text.substring(0, index).split('\n').length;
  }

  /**
   * 특정 카테고리에 대한 권장사항 생성
   * - 구현된 안전한 패턴 목록
   * - 아직 구현되지 않은 권장사항
   * - 베스트 프랙티스 및 코드 예제 제공
   */
  generateRecommendations(category, detectedSafePractices) {
    const safePattern = this.safePatternCache.get(category);
    if (!safePattern) {
      return this.getDefaultRecommendations(category);
    }

    const recommendations = {
      category: category,
      implemented: detectedSafePractices.filter(p => p.category === category),
      missing: [],
      suggestions: safePattern.bestPractices || [],
      codeExample: safePattern.codeTemplate,
      frameworkNotes: safePattern.frameworkNotes || []
    };

    // 구현된 패턴의 타입을 Set으로 관리
    const implementedTypes = new Set(recommendations.implemented.map(p => p.type));
    const allRequiredTypes = safePattern.detectionRules.map(r => r.type);

    // 필요하지만 아직 구현되지 않은 패턴 찾기
    recommendations.missing = allRequiredTypes.filter(type => !implementedTypes.has(type))
      .map(type => {
        const rule = safePattern.detectionRules.find(r => r.type === type);
        return rule ? rule.description : type;
      });

    return recommendations;
  }

  /**
   * 캐시에 패턴이 없을 때 사용할 카테고리별 기본 권장사항
   */
  getDefaultRecommendations(category) {
    const defaultRecommendations = {
      'resource_management': ['리소스 자동 관리 구현', 'try-with-resources 사용'],
      'security_vulnerability': ['입력값 검증', '파라미터화된 쿼리 사용'],
      'performance_issue': ['쿼리 최적화', '배치 처리 고려'],
      'exception_handling': ['적절한 로깅', '예외 전파']
    };

    return {
      category: category,
      implemented: [],
      missing: defaultRecommendations[category] || [],
      suggestions: defaultRecommendations[category] || [],
      codeExample: '// 패턴 정보 없음',
      frameworkNotes: []
    };
  }

  /**
   * VectorDB에서 패턴을 다시 로드하여 캐시 갱신
   * (새로운 패턴이 추가되었을 때 호출)
   */
  async refreshPatternCache() {
    console.log('🔄 패턴 캐시 갱신 중...');
    this.safePatternCache.clear();
    this.antiPatternCache.clear();
    await this.loadAndClassifyPatterns();
  }

  /**
   * VectorDB 연결 실패 시 사용할 최소한의 기본 안전 패턴 설정
   */
  initializeFallbackPatterns() {
    const fallbackSafePatterns = [
      {
        category: 'resource_management',
        patternName: 'try_with_resources',
        detectionRules: [{
          type: 'try_with_resources',
          pattern: /try\s*\([^)]*(?:Connection|Statement|ResultSet)[^)]*\)/,
          description: 'Try-with-resources 자동 리소스 관리'
        }]
      },
      {
        category: 'security_vulnerability',
        patternName: 'parameterized_queries',
        detectionRules: [{
          type: 'parameterized_queries',
          pattern: /PreparedStatement.*setString\s*\(\s*\d+/,
          description: 'PreparedStatement 파라미터 바인딩'
        }]
      }
    ];

    fallbackSafePatterns.forEach(pattern => {
      this.safePatternCache.set(pattern.category, pattern);
    });
  }
}