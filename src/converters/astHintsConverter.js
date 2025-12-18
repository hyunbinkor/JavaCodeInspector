/**
 * AST Hints Converter
 * 
 * AST 검사 힌트를 LLM이 이해할 수 있는 자연어로 변환합니다.
 * 
 * 주요 기능:
 * 1. astHints → astDescription (자연어 설명)
 * 2. astHints → checkPoints (체크포인트 배열)
 * 3. 규칙 컨텍스트 기반 설명 보강
 * 
 * 사용 예시:
 * ```javascript
 * const converter = new AstHintsConverter();
 * const result = converter.convert({
 *   nodeTypes: ['CatchClause'],
 *   checkEmpty: true
 * }, { title: '빈 catch 블록 금지' });
 * 
 * // result:
 * // {
 * //   astDescription: "catch 블록을 검사합니다. 해당 블록이 비어있으면 위반입니다. ...",
 * //   checkPoints: ["catch 블록 내부에 실행 코드가 있는가?", ...]
 * // }
 * ```
 * 
 * @module AstHintsConverter
 * @version 1.0.0
 */

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ES Module에서 __dirname 얻기
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * AST Hints Converter 클래스
 */
export class AstHintsConverter {
  /**
   * 생성자
   * @param {Object} options - 옵션
   * @param {string} options.mappingsPath - ast-node-mappings.json 경로
   */
  constructor(options = {}) {
    this.mappingsPath = options.mappingsPath || 
      join(__dirname, '../../config/ast-node-mappings.json');
    
    this.mappings = this.loadMappings();
  }

  /**
   * 매핑 파일 로드
   * @returns {Object} 매핑 데이터
   */
  loadMappings() {
    try {
      if (existsSync(this.mappingsPath)) {
        const content = readFileSync(this.mappingsPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      console.warn(`⚠️ 매핑 파일 로드 실패: ${error.message}`);
    }
    
    // 폴백: 기본 매핑 사용
    return this.getDefaultMappings();
  }

  /**
   * 기본 매핑 (폴백용)
   */
  getDefaultMappings() {
    return {
      nodeTypes: {
        ClassDeclaration: { name: '클래스 선언' },
        MethodDeclaration: { name: '메서드 선언' },
        FieldDeclaration: { name: '필드 선언' },
        VariableDeclaration: { name: '변수 선언' },
        CatchClause: { name: 'catch 블록' },
        TryStatement: { name: 'try 블록' },
        IfStatement: { name: 'if 조건문' },
        ForStatement: { name: 'for 반복문' },
        WhileStatement: { name: 'while 반복문' }
      },
      checkConditions: {
        checkEmpty: {
          true: { description: '해당 블록이 비어있으면 위반입니다' }
        }
      },
      namingPatterns: {
        PascalCase: { description: 'PascalCase 명명 규칙을 따라야 합니다' },
        camelCase: { description: 'camelCase 명명 규칙을 따라야 합니다' }
      }
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // 메인 변환 메서드
  // ═══════════════════════════════════════════════════════════════════

  /**
   * AST Hints를 자연어로 변환 (메인 엔트리포인트)
   * 
   * @param {Object} astHints - AST 검사 힌트
   * @param {Object} context - 규칙 컨텍스트 (title, category, description 등)
   * @returns {Object} { astDescription, checkPoints }
   */
  convert(astHints, context = {}) {
    if (!astHints || Object.keys(astHints).length === 0) {
      return {
        astDescription: null,
        checkPoints: []
      };
    }

    const descriptionParts = [];
    const checkPoints = [];

    // 1. 검사 대상 노드 설명
    if (astHints.nodeTypes && astHints.nodeTypes.length > 0) {
      const nodeDesc = this.convertNodeTypes(astHints.nodeTypes);
      descriptionParts.push(nodeDesc.description);
      checkPoints.push(...nodeDesc.checkPoints);
    }

    // 2. 검사 조건 설명
    const conditionDesc = this.convertCheckConditions(astHints, context);
    if (conditionDesc.description) {
      descriptionParts.push(conditionDesc.description);
    }
    checkPoints.push(...conditionDesc.checkPoints);

    // 3. 명명 규칙 설명
    if (astHints.namingPattern) {
      const namingDesc = this.convertNamingPattern(astHints.namingPattern);
      descriptionParts.push(namingDesc.description);
      checkPoints.push(...namingDesc.checkPoints);
    }

    // 4. 필수 어노테이션 설명
    if (astHints.requiredAnnotations && astHints.requiredAnnotations.length > 0) {
      const annotationDesc = this.convertRequiredAnnotations(astHints.requiredAnnotations);
      descriptionParts.push(annotationDesc.description);
      checkPoints.push(...annotationDesc.checkPoints);
    }

    // 5. 금지/필수 패턴 설명
    if (astHints.forbiddenPatterns || astHints.requiredPatterns) {
      const patternDesc = this.convertPatternConstraints(astHints);
      if (patternDesc.description) {
        descriptionParts.push(patternDesc.description);
      }
      checkPoints.push(...patternDesc.checkPoints);
    }

    // 6. 문맥 기반 보강 설명 추가
    const contextualHint = this.getContextualHint(astHints, context);
    if (contextualHint) {
      descriptionParts.push(contextualHint);
    }

    // 결과 조합
    const astDescription = descriptionParts.length > 0 
      ? descriptionParts.join(' ') 
      : null;

    // 중복 제거
    const uniqueCheckPoints = [...new Set(checkPoints)];

    return {
      astDescription,
      checkPoints: uniqueCheckPoints
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // 노드 타입 변환
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 노드 타입 배열을 자연어로 변환
   * @param {string[]} nodeTypes - AST 노드 타입 배열
   * @returns {Object} { description, checkPoints }
   */
  convertNodeTypes(nodeTypes) {
    const nodeNames = nodeTypes.map(type => this.getNodeTypeName(type));
    
    const description = `${nodeNames.join(', ')}을(를) 검사합니다.`;
    const checkPoints = nodeTypes.map(type => {
      const name = this.getNodeTypeName(type);
      return `${name}이(가) 규칙을 준수하는가?`;
    });

    return { description, checkPoints };
  }

  /**
   * 단일 노드 타입의 한글 이름 반환
   * @param {string} nodeType - AST 노드 타입
   * @returns {string} 한글 이름
   */
  getNodeTypeName(nodeType) {
    const mapping = this.mappings.nodeTypes?.[nodeType];
    return mapping?.name || nodeType;
  }

  /**
   * 노드 타입의 상세 설명 반환
   * @param {string} nodeType - AST 노드 타입
   * @returns {string|null} 상세 설명
   */
  getNodeTypeDescription(nodeType) {
    const mapping = this.mappings.nodeTypes?.[nodeType];
    return mapping?.description || null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 검사 조건 변환
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 검사 조건들을 자연어로 변환
   * @param {Object} astHints - AST 힌트 객체
   * @param {Object} context - 규칙 컨텍스트
   * @returns {Object} { description, checkPoints }
   */
  convertCheckConditions(astHints, context = {}) {
    const descriptions = [];
    const checkPoints = [];

    // checkEmpty
    if (astHints.checkEmpty !== undefined) {
      const result = this.convertCheckEmpty(astHints.checkEmpty, astHints.nodeTypes);
      descriptions.push(result.description);
      checkPoints.push(...result.checkPoints);
    }

    // minBodyStatements
    if (astHints.minBodyStatements !== undefined) {
      const result = this.convertMinBodyStatements(astHints.minBodyStatements);
      descriptions.push(result.description);
      checkPoints.push(...result.checkPoints);
    }

    // maxBodyStatements
    if (astHints.maxBodyStatements !== undefined) {
      const result = this.convertMaxBodyStatements(astHints.maxBodyStatements);
      descriptions.push(result.description);
      checkPoints.push(...result.checkPoints);
    }

    // maxLineCount
    if (astHints.maxLineCount !== undefined) {
      const result = this.convertMaxLineCount(astHints.maxLineCount);
      descriptions.push(result.description);
      checkPoints.push(...result.checkPoints);
    }

    // maxCyclomaticComplexity
    if (astHints.maxCyclomaticComplexity !== undefined) {
      const result = this.convertMaxComplexity(astHints.maxCyclomaticComplexity);
      descriptions.push(result.description);
      checkPoints.push(...result.checkPoints);
    }

    // maxNestingDepth
    if (astHints.maxNestingDepth !== undefined) {
      const result = this.convertMaxNestingDepth(astHints.maxNestingDepth);
      descriptions.push(result.description);
      checkPoints.push(...result.checkPoints);
    }

    // maxParameters
    if (astHints.maxParameters !== undefined) {
      const result = this.convertMaxParameters(astHints.maxParameters);
      descriptions.push(result.description);
      checkPoints.push(...result.checkPoints);
    }

    // requiresLogging
    if (astHints.requiresLogging) {
      const result = this.convertRequiresLogging();
      descriptions.push(result.description);
      checkPoints.push(...result.checkPoints);
    }

    // requiresNullCheck
    if (astHints.requiresNullCheck) {
      const result = this.convertRequiresNullCheck();
      descriptions.push(result.description);
      checkPoints.push(...result.checkPoints);
    }

    return {
      description: descriptions.join(' '),
      checkPoints
    };
  }

  /**
   * checkEmpty 조건 변환
   */
  convertCheckEmpty(value, nodeTypes = []) {
    const mapping = this.mappings.checkConditions?.checkEmpty?.[String(value)];
    
    if (value === true) {
      const nodeContext = nodeTypes.length > 0 
        ? this.getNodeTypeName(nodeTypes[0]) 
        : '블록';
      
      return {
        description: mapping?.description || '해당 블록이 비어있으면 위반입니다.',
        checkPoints: [
          `${nodeContext} 내부에 실행 코드가 있는가?`,
          mapping?.checkPoint || '블록이 비어있지 않은가?'
        ]
      };
    } else {
      return {
        description: mapping?.description || '해당 블록이 비어있어야 합니다.',
        checkPoints: ['블록이 비어있는가?']
      };
    }
  }

  /**
   * minBodyStatements 조건 변환
   */
  convertMinBodyStatements(value) {
    const template = this.mappings.checkConditions?.minBodyStatements;
    const description = template?.description?.replace('{value}', value) ||
      `블록 내부에 최소 ${value}개 이상의 statement가 필요합니다.`;
    
    return {
      description,
      checkPoints: [`블록에 ${value}개 이상의 statement가 있는가?`]
    };
  }

  /**
   * maxBodyStatements 조건 변환
   */
  convertMaxBodyStatements(value) {
    const template = this.mappings.checkConditions?.maxBodyStatements;
    const description = template?.description?.replace('{value}', value) ||
      `블록 내부 statement가 ${value}개를 초과하면 위반입니다.`;
    
    return {
      description,
      checkPoints: [`블록의 statement 수가 ${value}개 이하인가?`]
    };
  }

  /**
   * maxLineCount 조건 변환
   */
  convertMaxLineCount(value) {
    const template = this.mappings.checkConditions?.maxLineCount;
    const description = template?.description?.replace('{value}', value) ||
      `코드가 ${value}줄을 초과하면 위반입니다.`;
    
    return {
      description,
      checkPoints: [`코드 라인 수가 ${value}줄 이하인가?`]
    };
  }

  /**
   * maxCyclomaticComplexity 조건 변환
   */
  convertMaxComplexity(value) {
    const template = this.mappings.checkConditions?.maxCyclomaticComplexity;
    const description = template?.description?.replace('{value}', value) ||
      `순환 복잡도가 ${value}를 초과하면 위반입니다.`;
    
    return {
      description,
      checkPoints: [
        `순환 복잡도가 ${value} 이하인가?`,
        '조건문/반복문이 과도하게 중첩되어 있지 않은가?'
      ]
    };
  }

  /**
   * maxNestingDepth 조건 변환
   */
  convertMaxNestingDepth(value) {
    const template = this.mappings.checkConditions?.maxNestingDepth;
    const description = template?.description?.replace('{value}', value) ||
      `중첩 깊이가 ${value}를 초과하면 위반입니다.`;
    
    return {
      description,
      checkPoints: [
        `중첩 깊이가 ${value} 이하인가?`,
        'early return이나 guard clause로 중첩을 줄일 수 있는가?'
      ]
    };
  }

  /**
   * maxParameters 조건 변환
   */
  convertMaxParameters(value) {
    const template = this.mappings.checkConditions?.maxParameters;
    const description = template?.description?.replace('{value}', value) ||
      `파라미터가 ${value}개를 초과하면 위반입니다.`;
    
    return {
      description,
      checkPoints: [`파라미터 수가 ${value}개 이하인가?`]
    };
  }

  /**
   * requiresLogging 조건 변환
   */
  convertRequiresLogging() {
    const template = this.mappings.checkConditions?.requiresLogging?.true;
    
    return {
      description: template?.description || '해당 블록에서 반드시 로깅을 해야 합니다.',
      checkPoints: [
        '로깅 코드가 포함되어 있는가?',
        'logger.info(), logger.error() 등의 호출이 있는가?'
      ]
    };
  }

  /**
   * requiresNullCheck 조건 변환
   */
  convertRequiresNullCheck() {
    const template = this.mappings.checkConditions?.requiresNullCheck?.true;
    
    return {
      description: template?.description || 'null 체크가 필요합니다.',
      checkPoints: [
        'null 체크를 수행하고 있는가?',
        'NullPointerException 발생 가능성이 있는가?'
      ]
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // 명명 규칙 변환
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 명명 패턴을 자연어로 변환
   * @param {string|Object} namingPattern - 명명 패턴
   * @returns {Object} { description, checkPoints }
   */
  convertNamingPattern(namingPattern) {
    // 문자열인 경우 (예: "PascalCase", "camelCase")
    if (typeof namingPattern === 'string') {
      const mapping = this.mappings.namingPatterns?.[namingPattern];
      
      if (mapping) {
        return {
          description: mapping.description,
          checkPoints: [mapping.checkPoint || `${namingPattern} 형식을 따르는가?`]
        };
      }
      
      return {
        description: `${namingPattern} 명명 규칙을 따라야 합니다.`,
        checkPoints: [`${namingPattern} 형식을 따르는가?`]
      };
    }

    // 객체인 경우 (예: { type: "prefixWith", value: "get" })
    if (typeof namingPattern === 'object') {
      return this.convertNamingPatternObject(namingPattern);
    }

    return { description: '', checkPoints: [] };
  }

  /**
   * 명명 패턴 객체를 자연어로 변환
   */
  convertNamingPatternObject(pattern) {
    const { type, value, regex } = pattern;
    const mapping = this.mappings.namingPatterns?.[type];

    if (mapping) {
      const description = mapping.description.replace('{value}', value || regex || '');
      const checkPoint = mapping.checkPoint?.replace('{value}', value || regex || '') ||
        `명명 규칙을 따르는가?`;
      
      return { description, checkPoints: [checkPoint] };
    }

    // 기본 처리
    if (type === 'prefixWith') {
      return {
        description: `${value} 접두사로 시작해야 합니다.`,
        checkPoints: [`${value}로 시작하는가?`]
      };
    }

    if (type === 'suffixWith') {
      return {
        description: `${value} 접미사로 끝나야 합니다.`,
        checkPoints: [`${value}로 끝나는가?`]
      };
    }

    if (type === 'matchesRegex' || regex) {
      return {
        description: `정규식 패턴을 따라야 합니다.`,
        checkPoints: ['명명 규칙 패턴에 맞는가?']
      };
    }

    return { description: '', checkPoints: [] };
  }

  // ═══════════════════════════════════════════════════════════════════
  // 어노테이션 변환
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 필수 어노테이션을 자연어로 변환
   * @param {string[]} annotations - 어노테이션 배열
   * @returns {Object} { description, checkPoints }
   */
  convertRequiredAnnotations(annotations) {
    const descriptions = [];
    const checkPoints = [];

    for (const annotation of annotations) {
      const mapping = this.mappings.requiredAnnotations?.[annotation];
      
      if (mapping) {
        descriptions.push(mapping.description);
        checkPoints.push(mapping.checkPoint || `${annotation} 어노테이션이 있는가?`);
      } else {
        descriptions.push(`${annotation} 어노테이션이 필요합니다.`);
        checkPoints.push(`${annotation} 어노테이션이 있는가?`);
      }
    }

    return {
      description: descriptions.join(' '),
      checkPoints
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // 패턴 제약 변환
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 금지/필수 패턴 제약을 자연어로 변환
   * @param {Object} astHints - AST 힌트 객체
   * @returns {Object} { description, checkPoints }
   */
  convertPatternConstraints(astHints) {
    const descriptions = [];
    const checkPoints = [];

    // 금지 패턴
    if (astHints.forbiddenPatterns && astHints.forbiddenPatterns.length > 0) {
      const forbidden = astHints.forbiddenPatterns.join(', ');
      descriptions.push(`다음 패턴은 사용이 금지됩니다: ${forbidden}.`);
      
      for (const pattern of astHints.forbiddenPatterns) {
        checkPoints.push(`${pattern}을(를) 사용하고 있지 않은가?`);
      }
    }

    // 필수 패턴
    if (astHints.requiredPatterns && astHints.requiredPatterns.length > 0) {
      const required = astHints.requiredPatterns.join(', ');
      descriptions.push(`다음 패턴이 반드시 있어야 합니다: ${required}.`);
      
      for (const pattern of astHints.requiredPatterns) {
        checkPoints.push(`${pattern}이(가) 포함되어 있는가?`);
      }
    }

    return {
      description: descriptions.join(' '),
      checkPoints
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // 문맥 기반 힌트
  // ═══════════════════════════════════════════════════════════════════

  /**
   * 문맥 기반 추가 설명 생성
   * @param {Object} astHints - AST 힌트
   * @param {Object} context - 규칙 컨텍스트
   * @returns {string|null} 추가 설명
   */
  getContextualHint(astHints, context = {}) {
    const { nodeTypes = [], checkEmpty, maxLineCount, maxCyclomaticComplexity, maxNestingDepth } = astHints;
    const contextualHints = this.mappings.contextualHints || {};

    // 빈 블록 컨텍스트
    if (checkEmpty === true && nodeTypes.length > 0) {
      const nodeType = nodeTypes[0];
      const hint = contextualHints.emptyBlock?.[nodeType];
      if (hint) return hint;
    }

    // 너무 긴 코드 컨텍스트
    if (maxLineCount && nodeTypes.length > 0) {
      const nodeType = nodeTypes[0];
      const hint = contextualHints.tooLong?.[nodeType];
      if (hint) return hint;
    }

    // 높은 복잡도 컨텍스트
    if (maxCyclomaticComplexity && nodeTypes.includes('MethodDeclaration')) {
      const hint = contextualHints.highComplexity?.MethodDeclaration;
      if (hint) return hint;
    }

    // 깊은 중첩 컨텍스트
    if (maxNestingDepth) {
      const hint = contextualHints.deepNesting?.default;
      if (hint) return hint;
    }

    return null;
  }

  // ═══════════════════════════════════════════════════════════════════
  // 유틸리티 메서드
  // ═══════════════════════════════════════════════════════════════════

  /**
   * astHints에서 keywords 자동 추출
   * @param {Object} astHints - AST 힌트
   * @returns {string[]} 키워드 배열
   */
  extractKeywords(astHints) {
    const keywords = new Set();

    // nodeTypes에서 키워드 추출
    if (astHints.nodeTypes) {
      for (const nodeType of astHints.nodeTypes) {
        // CamelCase를 단어로 분리
        const words = nodeType.match(/[A-Z][a-z]+/g) || [];
        words.forEach(w => keywords.add(w.toLowerCase()));
        
        // 관련 Java 키워드 추가
        const mapping = this.mappings.nodeTypes?.[nodeType];
        if (mapping?.examples) {
          // 예시에서 키워드 추출
          const exampleKeywords = this.extractKeywordsFromExamples(mapping.examples);
          exampleKeywords.forEach(k => keywords.add(k));
        }
      }
    }

    // 어노테이션에서 키워드 추출
    if (astHints.requiredAnnotations) {
      astHints.requiredAnnotations.forEach(ann => {
        keywords.add(ann.replace('@', ''));
      });
    }

    // 명명 패턴에서 키워드 추출
    if (astHints.namingPattern) {
      if (typeof astHints.namingPattern === 'string') {
        keywords.add(astHints.namingPattern);
      } else if (astHints.namingPattern.value) {
        keywords.add(astHints.namingPattern.value);
      }
    }

    return Array.from(keywords);
  }

  /**
   * 예시 코드에서 키워드 추출
   * @private
   */
  extractKeywordsFromExamples(examples) {
    const keywords = new Set();
    
    for (const example of examples) {
      // Java 키워드 추출
      const javaKeywords = example.match(/\b(public|private|protected|class|interface|void|String|int|long|boolean|try|catch|throw|new|return|if|for|while)\b/g);
      if (javaKeywords) {
        javaKeywords.forEach(k => keywords.add(k));
      }
      
      // 어노테이션 추출
      const annotations = example.match(/@\w+/g);
      if (annotations) {
        annotations.forEach(a => keywords.add(a.replace('@', '')));
      }
    }

    return Array.from(keywords);
  }

  /**
   * 변환 결과 검증
   * @param {Object} result - 변환 결과
   * @returns {boolean} 유효 여부
   */
  validateResult(result) {
    if (!result) return false;
    
    // astDescription이 있으면 최소 길이 체크
    if (result.astDescription && result.astDescription.length < 10) {
      return false;
    }
    
    // checkPoints가 있으면 배열인지 체크
    if (result.checkPoints && !Array.isArray(result.checkPoints)) {
      return false;
    }
    
    return true;
  }
}

export default AstHintsConverter;