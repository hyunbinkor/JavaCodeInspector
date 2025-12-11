/**
 * 태그 추출기 (TagExtractor)
 * 
 * 코드에서 태그를 추출하는 Tier 1 엔진
 * 정규식, AST, AST 컨텍스트 기반 추출 지원
 * 
 * @module profiler/TagExtractor
 * @version 1.0.0
 */

import { getTagDefinitionLoader } from './TagDefinitionLoader.js';
import logger from '../utils/loggerUtils.js';

/**
 * 태그 추출기 클래스
 * 
 * Tier 1 태그 추출 담당:
 * - 정규식 기반 태그 (regex)
 * - AST 기반 태그 (ast)
 * - AST 컨텍스트 기반 태그 (ast_context)
 */
export class TagExtractor {
  constructor() {
    /** @type {TagDefinitionLoader} 태그 정의 로더 */
    this.definitionLoader = null;
    
    /** @type {boolean} 초기화 완료 여부 */
    this.initialized = false;

    /** @type {Map<string, RegExp[]>} 컴파일된 정규식 캐시 */
    this.regexCache = new Map();
  }

  /**
   * 초기화
   * 
   * @returns {Promise<boolean>} 초기화 성공 여부
   */
  async initialize() {
    if (this.initialized) {
      return true;
    }

    try {
      this.definitionLoader = getTagDefinitionLoader();
      await this.definitionLoader.initialize();

      // 정규식 사전 컴파일
      this.precompileRegex();

      this.initialized = true;
      logger.info('✅ TagExtractor 초기화 완료');
      return true;

    } catch (error) {
      logger.error(`❌ TagExtractor 초기화 실패: ${error.message}`);
      return false;
    }
  }

  /**
   * 정규식 사전 컴파일 (성능 최적화)
   */
  precompileRegex() {
    const regexTags = this.definitionLoader.getRegexBasedTags();

    for (const tag of regexTags) {
      const patterns = tag.detection?.patterns || [];
      const flags = tag.detection?.caseSensitive === false ? 'gi' : 'g';
      
      const compiled = patterns.map(pattern => {
        try {
          return new RegExp(pattern, flags);
        } catch (error) {
          logger.warn(`정규식 컴파일 실패 (${tag.name}): ${pattern}`);
          return null;
        }
      }).filter(Boolean);

      this.regexCache.set(tag.name, compiled);
    }

    logger.debug(`정규식 캐시 구축 완료: ${this.regexCache.size}개`);
  }

  /**
   * 코드에서 Tier 1 태그 추출 (메인 메서드)
   * 
   * @param {string} sourceCode - 소스 코드
   * @param {Object} astResult - AST 파싱 결과 (선택)
   * @returns {Promise<Object>} 추출 결과 { tags: Set, details: Map }
   */
  async extractTags(sourceCode, astResult = null) {
    if (!this.initialized) {
      await this.initialize();
    }

    const startTime = Date.now();
    
    /** @type {Set<string>} 추출된 태그 집합 */
    const tags = new Set();
    
    /** @type {Map<string, Object>} 태그별 상세 정보 */
    const details = new Map();

    // 주석과 문자열 제거한 코드 (정규식 검사용)
    const cleanedCode = this.removeCommentsAndStrings(sourceCode);

    // 1. 정규식 기반 태그 추출
    const regexResults = this.extractByRegex(cleanedCode, sourceCode);
    for (const [tagName, detail] of regexResults) {
      tags.add(tagName);
      details.set(tagName, { ...detail, source: 'regex' });
    }

    // 2. AST 기반 태그 추출
    if (astResult?.success && astResult?.analysis) {
      const astResults = this.extractByAST(astResult.analysis);
      for (const [tagName, detail] of astResults) {
        tags.add(tagName);
        details.set(tagName, { ...detail, source: 'ast' });
      }
    }

    // 3. AST 컨텍스트 기반 태그 추출
    if (astResult?.success) {
      const contextResults = this.extractByASTContext(sourceCode, astResult);
      for (const [tagName, detail] of contextResults) {
        tags.add(tagName);
        details.set(tagName, { ...detail, source: 'ast_context' });
      }
    }

    // 4. 메트릭 기반 태그 추출
    const metricResults = this.extractByMetrics(sourceCode, astResult);
    for (const [tagName, detail] of metricResults) {
      tags.add(tagName);
      details.set(tagName, { ...detail, source: 'metric' });
    }

    const elapsed = Date.now() - startTime;
    logger.debug(`Tier 1 태그 추출 완료: ${tags.size}개 (${elapsed}ms)`);

    return {
      tags,
      details,
      stats: {
        totalTags: tags.size,
        extractionTimeMs: elapsed,
        bySource: {
          regex: Array.from(details.values()).filter(d => d.source === 'regex').length,
          ast: Array.from(details.values()).filter(d => d.source === 'ast').length,
          ast_context: Array.from(details.values()).filter(d => d.source === 'ast_context').length,
          metric: Array.from(details.values()).filter(d => d.source === 'metric').length
        }
      }
    };
  }

  /**
   * 정규식 기반 태그 추출
   * 
   * @param {string} cleanedCode - 주석/문자열 제거된 코드
   * @param {string} originalCode - 원본 코드
   * @returns {Map<string, Object>} 태그명 → 상세정보 맵
   */
  extractByRegex(cleanedCode, originalCode) {
    const results = new Map();
    const regexTags = this.definitionLoader.getRegexBasedTags();

    for (const tag of regexTags) {
      const detection = tag.detection;
      const patterns = this.regexCache.get(tag.name) || [];
      
      if (patterns.length === 0) continue;

      // 검사 대상 코드 결정
      const targetCode = detection.excludeInComments === false ? originalCode : cleanedCode;

      // 매칭 방식에 따른 검사
      const matchType = detection.matchType || 'any';
      let matches = [];
      let isMatched = false;

      for (const regex of patterns) {
        // 정규식 리셋 (g 플래그 사용 시 필요)
        regex.lastIndex = 0;
        
        const found = targetCode.match(regex);
        if (found) {
          matches.push(...found);
          if (matchType === 'any') {
            isMatched = true;
            break;
          }
        }
      }

      // 'all' 매칭: 모든 패턴이 매칭되어야 함
      if (matchType === 'all') {
        isMatched = patterns.every(regex => {
          regex.lastIndex = 0;
          return regex.test(targetCode);
        });
      } else if (matchType === 'any') {
        isMatched = matches.length > 0;
      }

      if (isMatched) {
        results.set(tag.name, {
          matched: true,
          matchCount: matches.length,
          samples: matches.slice(0, 3), // 최대 3개 샘플
          confidence: 1.0
        });
      }
    }

    return results;
  }

  /**
   * AST 기반 태그 추출
   * 
   * @param {Object} astAnalysis - AST 분석 결과
   * @returns {Map<string, Object>} 태그명 → 상세정보 맵
   */
  extractByAST(astAnalysis) {
    const results = new Map();
    const astTags = this.definitionLoader.getASTBasedTags()
      .filter(tag => tag.detection?.type === 'ast');

    for (const tag of astTags) {
      const detection = tag.detection;

      // 메트릭 기반 AST 태그
      if (detection.metric) {
        const metricValue = this.getASTMetric(astAnalysis, detection.metric);
        const threshold = detection.threshold || 0;
        const operator = detection.operator || '>=';

        let isMatched = false;
        switch (operator) {
          case '>=': isMatched = metricValue >= threshold; break;
          case '>':  isMatched = metricValue > threshold; break;
          case '<=': isMatched = metricValue <= threshold; break;
          case '<':  isMatched = metricValue < threshold; break;
          case '==': isMatched = metricValue === threshold; break;
        }

        if (isMatched) {
          results.set(tag.name, {
            matched: true,
            metricValue,
            threshold,
            operator,
            confidence: 1.0
          });
        }
      }

      // 노드 타입 기반 AST 태그
      if (detection.nodeType) {
        const hasNode = this.checkASTNodeType(astAnalysis, detection);
        if (hasNode) {
          results.set(tag.name, {
            matched: true,
            nodeType: detection.nodeType,
            confidence: 1.0
          });
        }
      }
    }

    return results;
  }

  /**
   * AST 컨텍스트 기반 태그 추출
   * (예: finally 블록 내 close() 호출, 루프 내 DB 호출)
   * 
   * @param {string} sourceCode - 소스 코드
   * @param {Object} astResult - AST 파싱 결과
   * @returns {Map<string, Object>} 태그명 → 상세정보 맵
   */
  extractByASTContext(sourceCode, astResult) {
    const results = new Map();
    const contextTags = this.definitionLoader.getASTBasedTags()
      .filter(tag => tag.detection?.type === 'ast_context');

    for (const tag of contextTags) {
      const detection = tag.detection;
      const context = detection.context;
      const patterns = detection.patterns || [];

      let isMatched = false;
      let evidence = null;

      // finally 블록 내 패턴 검사
      if (context === 'finally') {
        const finallyBlocks = this.extractFinallyBlocks(sourceCode);
        for (const block of finallyBlocks) {
          for (const pattern of patterns) {
            const regex = new RegExp(pattern, 'g');
            if (regex.test(block)) {
              isMatched = true;
              evidence = block.substring(0, 100);
              break;
            }
          }
          if (isMatched) break;
        }
      }

      // 루프 내 패턴 검사
      if (Array.isArray(context) && context.some(c => 
        ['ForStatement', 'WhileStatement', 'DoStatement'].includes(c)
      )) {
        const loopBlocks = this.extractLoopBlocks(sourceCode);
        for (const block of loopBlocks) {
          for (const pattern of patterns) {
            const regex = new RegExp(pattern, 'g');
            if (regex.test(block)) {
              isMatched = true;
              evidence = block.substring(0, 100);
              break;
            }
          }
          if (isMatched) break;
        }
      }

      if (isMatched) {
        results.set(tag.name, {
          matched: true,
          context,
          evidence,
          confidence: 0.9 // 컨텍스트 기반은 약간 낮은 확신도
        });
      }
    }

    return results;
  }

  /**
   * 메트릭 기반 태그 추출
   * 
   * @param {string} sourceCode - 소스 코드
   * @param {Object} astResult - AST 파싱 결과
   * @returns {Map<string, Object>} 태그명 → 상세정보 맵
   */
  extractByMetrics(sourceCode, astResult) {
    const results = new Map();
    
    // 라인 수 계산
    const lineCount = sourceCode.split('\n').length;
    
    // 메서드 수 계산 (정규식 기반 근사)
    const methodMatches = sourceCode.match(/\b(public|private|protected)\s+[\w<>\[\]]+\s+\w+\s*\([^)]*\)\s*(\{|throws)/g);
    const methodCount = methodMatches ? methodMatches.length : 0;

    // AST 기반 메트릭
    const astAnalysis = astResult?.analysis || {};
    const complexity = astAnalysis.cyclomaticComplexity || this.estimateComplexity(sourceCode);
    const maxNesting = astAnalysis.maxNestingDepth || this.estimateNesting(sourceCode);

    // LINE_COUNT_HIGH
    if (lineCount >= 300) {
      results.set('LINE_COUNT_HIGH', {
        matched: true,
        metricValue: lineCount,
        threshold: 300,
        confidence: 1.0
      });
    }

    // METHOD_COUNT_HIGH
    if (methodCount >= 10) {
      results.set('METHOD_COUNT_HIGH', {
        matched: true,
        metricValue: methodCount,
        threshold: 10,
        confidence: 0.9
      });
    }

    // COMPLEXITY_HIGH
    if (complexity >= 10) {
      results.set('COMPLEXITY_HIGH', {
        matched: true,
        metricValue: complexity,
        threshold: 10,
        confidence: 0.8
      });
    }

    // NESTING_DEEP
    if (maxNesting >= 4) {
      results.set('NESTING_DEEP', {
        matched: true,
        metricValue: maxNesting,
        threshold: 4,
        confidence: 0.8
      });
    }

    return results;
  }

  /**
   * 주석과 문자열 리터럴 제거
   * 
   * @param {string} code - 소스 코드
   * @returns {string} 정제된 코드
   */
  removeCommentsAndStrings(code) {
    // 1. 블록 주석 제거
    let cleaned = code.replace(/\/\*[\s\S]*?\*\//g, ' ');
    
    // 2. 라인 주석 제거
    cleaned = cleaned.replace(/\/\/.*$/gm, ' ');
    
    // 3. 문자열 리터럴 제거 (이스케이프 처리 포함)
    cleaned = cleaned.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    cleaned = cleaned.replace(/'(?:[^'\\]|\\.)*'/g, "''");
    
    return cleaned;
  }

  /**
   * finally 블록 추출
   * 
   * @param {string} code - 소스 코드
   * @returns {string[]} finally 블록 배열
   */
  extractFinallyBlocks(code) {
    const blocks = [];
    const regex = /\}\s*finally\s*\{/g;
    let match;

    while ((match = regex.exec(code)) !== null) {
      const start = match.index + match[0].length;
      const block = this.extractBlock(code, start);
      if (block) {
        blocks.push(block);
      }
    }

    return blocks;
  }

  /**
   * 루프 블록 추출
   * 
   * @param {string} code - 소스 코드
   * @returns {string[]} 루프 블록 배열
   */
  extractLoopBlocks(code) {
    const blocks = [];
    
    // for, while, do 루프 시작점 찾기
    const patterns = [
      /\bfor\s*\([^)]*\)\s*\{/g,
      /\bwhile\s*\([^)]*\)\s*\{/g,
      /\bdo\s*\{/g
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(code)) !== null) {
        const start = match.index + match[0].length;
        const block = this.extractBlock(code, start);
        if (block) {
          blocks.push(block);
        }
      }
    }

    return blocks;
  }

  /**
   * 중괄호 블록 추출 (중첩 고려)
   * 
   * @param {string} code - 소스 코드
   * @param {number} startIndex - 시작 인덱스 ('{' 다음)
   * @returns {string|null} 추출된 블록 또는 null
   */
  extractBlock(code, startIndex) {
    let depth = 1;
    let i = startIndex;

    while (i < code.length && depth > 0) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') depth--;
      i++;
    }

    if (depth === 0) {
      return code.substring(startIndex, i - 1);
    }

    return null;
  }

  /**
   * AST 메트릭 값 조회
   * 
   * @param {Object} astAnalysis - AST 분석 결과
   * @param {string} metricName - 메트릭명
   * @returns {number} 메트릭 값
   */
  getASTMetric(astAnalysis, metricName) {
    switch (metricName) {
      case 'methodCount':
        return astAnalysis.methodDeclarations?.length || 0;
      case 'cyclomaticComplexity':
        return astAnalysis.cyclomaticComplexity || 0;
      case 'maxNestingDepth':
        return astAnalysis.maxNestingDepth || 0;
      case 'lineCount':
        return astAnalysis.lineCount || 0;
      default:
        return 0;
    }
  }

  /**
   * AST 노드 타입 존재 확인
   * 
   * @param {Object} astAnalysis - AST 분석 결과
   * @param {Object} detection - detection 설정
   * @returns {boolean} 노드 존재 여부
   */
  checkASTNodeType(astAnalysis, detection) {
    const nodeType = detection.nodeType;
    const condition = detection.condition;

    switch (nodeType) {
      case 'loop':
        if (condition === 'nested') {
          return astAnalysis.hasNestedLoops || false;
        }
        return (astAnalysis.loops?.length || 0) > 0;
      default:
        return false;
    }
  }

  /**
   * 순환 복잡도 추정 (정규식 기반)
   * 
   * @param {string} code - 소스 코드
   * @returns {number} 추정 복잡도
   */
  estimateComplexity(code) {
    let complexity = 1;
    
    // 조건문/분기문 카운트
    const patterns = [
      /\bif\s*\(/g,
      /\belse\s+if\s*\(/g,
      /\bfor\s*\(/g,
      /\bwhile\s*\(/g,
      /\bcase\s+/g,
      /\bcatch\s*\(/g,
      /\?\s*[^:]+\s*:/g,  // 삼항 연산자
      /&&/g,
      /\|\|/g
    ];

    for (const pattern of patterns) {
      const matches = code.match(pattern);
      if (matches) {
        complexity += matches.length;
      }
    }

    return complexity;
  }

  /**
   * 최대 중첩 깊이 추정
   * 
   * @param {string} code - 소스 코드
   * @returns {number} 추정 중첩 깊이
   */
  estimateNesting(code) {
    let maxDepth = 0;
    let currentDepth = 0;

    // 제어문 중첩만 카운트 (단순 블록 제외)
    const controlStart = /\b(if|for|while|do|switch|try)\s*[\({]/g;
    
    for (let i = 0; i < code.length; i++) {
      if (code[i] === '{') {
        // 제어문 시작 확인 (이전 20자 검사)
        const prev = code.substring(Math.max(0, i - 20), i);
        if (/\b(if|for|while|do|switch|try|catch|finally)\s*[\(]?[^{]*$/.test(prev)) {
          currentDepth++;
          maxDepth = Math.max(maxDepth, currentDepth);
        }
      } else if (code[i] === '}') {
        if (currentDepth > 0) currentDepth--;
      }
    }

    return maxDepth;
  }

  /**
   * 특정 태그만 추출
   * 
   * @param {string} sourceCode - 소스 코드
   * @param {string[]} tagNames - 추출할 태그명 배열
   * @param {Object} astResult - AST 파싱 결과
   * @returns {Promise<Object>} 추출 결과
   */
  async extractSpecificTags(sourceCode, tagNames, astResult = null) {
    // 전체 추출 후 필터링 (최적화 필요 시 개선 가능)
    const result = await this.extractTags(sourceCode, astResult);
    
    const filteredTags = new Set();
    const filteredDetails = new Map();

    for (const tagName of tagNames) {
      if (result.tags.has(tagName)) {
        filteredTags.add(tagName);
        filteredDetails.set(tagName, result.details.get(tagName));
      }
    }

    return {
      tags: filteredTags,
      details: filteredDetails
    };
  }
}

export default TagExtractor;
