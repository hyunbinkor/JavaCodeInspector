/**
 * 태그 표현식 평가기 (TagExpressionEvaluator)
 * 
 * tagCondition 표현식을 파싱하고 평가
 * 예: "IS_CONTROLLER && CALLS_DAO" → true/false
 * 
 * 지원 연산자:
 * - && : AND
 * - || : OR
 * - !  : NOT
 * - () : 그룹핑
 * 
 * @module matcher/TagExpressionEvaluator
 * @version 1.0.0
 */

import logger from '../utils/loggerUtils.js';

/**
 * 토큰 타입
 */
const TokenType = {
  TAG: 'TAG',           // 태그명 (예: IS_CONTROLLER)
  AND: 'AND',           // &&
  OR: 'OR',             // ||
  NOT: 'NOT',           // !
  LPAREN: 'LPAREN',     // (
  RPAREN: 'RPAREN',     // )
  EOF: 'EOF'            // 끝
};

/**
 * AST 노드 타입
 */
const NodeType = {
  TAG: 'TAG',
  AND: 'AND',
  OR: 'OR',
  NOT: 'NOT'
};

/**
 * 태그 표현식 평가기 클래스
 */
export class TagExpressionEvaluator {
  constructor() {
    /** @type {Map<string, boolean>} 표현식 평가 캐시 */
    this.cache = new Map();
    
    /** @type {boolean} 캐시 활성화 여부 */
    this.enableCache = true;
    
    /** @type {number} 캐시 최대 크기 */
    this.maxCacheSize = 1000;
  }

  /**
   * 표현식 평가 (메인 메서드)
   * 
   * @param {string} expression - 태그 조합 표현식
   * @param {Set<string>|string[]} codeTags - 코드에서 추출된 태그
   * @returns {Object} { result: boolean, matchedTags: string[], unmatchedTags: string[] }
   */
  evaluate(expression, codeTags) {
    // Set으로 변환
    const tagSet = codeTags instanceof Set ? codeTags : new Set(codeTags);

    // 캐시 키 생성
    const cacheKey = this.enableCache ? this.generateCacheKey(expression, tagSet) : null;
    
    if (cacheKey && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      // 1. 토큰화
      const tokens = this.tokenize(expression);
      
      // 2. 파싱 (AST 생성)
      const ast = this.parse(tokens);
      
      // 3. 평가
      const result = this.evaluateNode(ast, tagSet);
      
      // 4. 매칭된 태그 추출
      const allTags = this.extractTagsFromExpression(expression);
      const matchedTags = allTags.filter(t => tagSet.has(t));
      const unmatchedTags = allTags.filter(t => !tagSet.has(t));

      const evaluation = {
        result,
        matchedTags,
        unmatchedTags,
        expression
      };

      // 캐시 저장
      if (cacheKey) {
        this.setCacheWithLimit(cacheKey, evaluation);
      }

      return evaluation;

    } catch (error) {
      logger.warn(`표현식 평가 실패: ${expression} - ${error.message}`);
      return {
        result: false,
        matchedTags: [],
        unmatchedTags: [],
        expression,
        error: error.message
      };
    }
  }

  /**
   * 표현식 토큰화
   * 
   * @param {string} expression - 표현식 문자열
   * @returns {Object[]} 토큰 배열
   */
  tokenize(expression) {
    const tokens = [];
    let pos = 0;
    const input = expression.trim();

    while (pos < input.length) {
      // 공백 스킵
      while (pos < input.length && /\s/.test(input[pos])) {
        pos++;
      }

      if (pos >= input.length) break;

      const char = input[pos];

      // 연산자 및 괄호
      if (char === '(') {
        tokens.push({ type: TokenType.LPAREN, value: '(' });
        pos++;
      } else if (char === ')') {
        tokens.push({ type: TokenType.RPAREN, value: ')' });
        pos++;
      } else if (char === '!') {
        tokens.push({ type: TokenType.NOT, value: '!' });
        pos++;
      } else if (char === '&' && input[pos + 1] === '&') {
        tokens.push({ type: TokenType.AND, value: '&&' });
        pos += 2;
      } else if (char === '|' && input[pos + 1] === '|') {
        tokens.push({ type: TokenType.OR, value: '||' });
        pos += 2;
      } else if (/[A-Z_]/.test(char)) {
        // 태그명 (대문자로 시작)
        let tagName = '';
        while (pos < input.length && /[A-Z0-9_]/.test(input[pos])) {
          tagName += input[pos];
          pos++;
        }
        tokens.push({ type: TokenType.TAG, value: tagName });
      } else {
        throw new Error(`알 수 없는 문자: '${char}' (위치: ${pos})`);
      }
    }

    tokens.push({ type: TokenType.EOF, value: '' });
    return tokens;
  }

  /**
   * 토큰 배열을 AST로 파싱
   * 
   * 문법 (우선순위 낮음 → 높음):
   * - expr     → or_expr
   * - or_expr  → and_expr ( "||" and_expr )*
   * - and_expr → not_expr ( "&&" not_expr )*
   * - not_expr → "!" not_expr | primary
   * - primary  → TAG | "(" expr ")"
   * 
   * @param {Object[]} tokens - 토큰 배열
   * @returns {Object} AST 루트 노드
   */
  parse(tokens) {
    let pos = 0;

    const peek = () => tokens[pos];
    const consume = (expectedType) => {
      const token = tokens[pos];
      if (expectedType && token.type !== expectedType) {
        throw new Error(`예상: ${expectedType}, 실제: ${token.type}`);
      }
      pos++;
      return token;
    };

    // or_expr → and_expr ( "||" and_expr )*
    const parseOrExpr = () => {
      let left = parseAndExpr();

      while (peek().type === TokenType.OR) {
        consume(TokenType.OR);
        const right = parseAndExpr();
        left = { type: NodeType.OR, left, right };
      }

      return left;
    };

    // and_expr → not_expr ( "&&" not_expr )*
    const parseAndExpr = () => {
      let left = parseNotExpr();

      while (peek().type === TokenType.AND) {
        consume(TokenType.AND);
        const right = parseNotExpr();
        left = { type: NodeType.AND, left, right };
      }

      return left;
    };

    // not_expr → "!" not_expr | primary
    const parseNotExpr = () => {
      if (peek().type === TokenType.NOT) {
        consume(TokenType.NOT);
        const operand = parseNotExpr();
        return { type: NodeType.NOT, operand };
      }

      return parsePrimary();
    };

    // primary → TAG | "(" expr ")"
    const parsePrimary = () => {
      const token = peek();

      if (token.type === TokenType.TAG) {
        consume(TokenType.TAG);
        return { type: NodeType.TAG, name: token.value };
      }

      if (token.type === TokenType.LPAREN) {
        consume(TokenType.LPAREN);
        const expr = parseOrExpr();
        consume(TokenType.RPAREN);
        return expr;
      }

      throw new Error(`예상치 못한 토큰: ${token.type}`);
    };

    const ast = parseOrExpr();

    if (peek().type !== TokenType.EOF) {
      throw new Error(`표현식 끝에 잉여 토큰: ${peek().value}`);
    }

    return ast;
  }

  /**
   * AST 노드 평가
   * 
   * @param {Object} node - AST 노드
   * @param {Set<string>} tagSet - 태그 집합
   * @returns {boolean} 평가 결과
   */
  evaluateNode(node, tagSet) {
    switch (node.type) {
      case NodeType.TAG:
        return tagSet.has(node.name);

      case NodeType.AND:
        return this.evaluateNode(node.left, tagSet) && this.evaluateNode(node.right, tagSet);

      case NodeType.OR:
        return this.evaluateNode(node.left, tagSet) || this.evaluateNode(node.right, tagSet);

      case NodeType.NOT:
        return !this.evaluateNode(node.operand, tagSet);

      default:
        throw new Error(`알 수 없는 노드 타입: ${node.type}`);
    }
  }

  /**
   * 표현식에서 모든 태그명 추출
   * 
   * @param {string} expression - 표현식
   * @returns {string[]} 태그명 배열 (고유)
   */
  extractTagsFromExpression(expression) {
    const tagPattern = /[A-Z][A-Z0-9_]*/g;
    const matches = expression.match(tagPattern) || [];
    return [...new Set(matches)];
  }

  /**
   * 캐시 키 생성
   * 
   * @param {string} expression - 표현식
   * @param {Set<string>} tagSet - 태그 집합
   * @returns {string} 캐시 키
   */
  generateCacheKey(expression, tagSet) {
    const sortedTags = Array.from(tagSet).sort().join(',');
    return `${expression}|${sortedTags}`;
  }

  /**
   * 캐시 크기 제한하며 저장
   * 
   * @param {string} key - 캐시 키
   * @param {Object} value - 저장할 값
   */
  setCacheWithLimit(key, value) {
    if (this.cache.size >= this.maxCacheSize) {
      // 가장 오래된 항목 삭제 (FIFO)
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, value);
  }

  /**
   * 캐시 초기화
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * 표현식 유효성 검사
   * 
   * @param {string} expression - 검사할 표현식
   * @returns {Object} { valid: boolean, error?: string }
   */
  validate(expression) {
    try {
      const tokens = this.tokenize(expression);
      this.parse(tokens);
      return { valid: true };
    } catch (error) {
      return { valid: false, error: error.message };
    }
  }

  /**
   * 표현식의 복잡도 계산
   * (연산자 및 태그 수 기반)
   * 
   * @param {string} expression - 표현식
   * @returns {Object} { operators: number, tags: number, depth: number }
   */
  complexity(expression) {
    const tags = this.extractTagsFromExpression(expression);
    const andCount = (expression.match(/&&/g) || []).length;
    const orCount = (expression.match(/\|\|/g) || []).length;
    const notCount = (expression.match(/!/g) || []).length;
    
    // 괄호 깊이 계산
    let maxDepth = 0;
    let currentDepth = 0;
    for (const char of expression) {
      if (char === '(') {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      } else if (char === ')') {
        currentDepth--;
      }
    }

    return {
      operators: andCount + orCount + notCount,
      tags: tags.length,
      depth: maxDepth
    };
  }

  /**
   * 표현식이 특정 태그에 의존하는지 확인
   * 
   * @param {string} expression - 표현식
   * @param {string} tagName - 확인할 태그명
   * @returns {boolean} 의존 여부
   */
  dependsOn(expression, tagName) {
    const tags = this.extractTagsFromExpression(expression);
    return tags.includes(tagName);
  }

  /**
   * 표현식에서 필수 태그 추출
   * (AND로만 연결된 최상위 태그)
   * 
   * @param {string} expression - 표현식
   * @returns {string[]} 필수 태그 배열
   */
  getRequiredTags(expression) {
    // 간단한 구현: OR가 없고 NOT이 없는 최상위 AND 태그
    if (expression.includes('||')) {
      return []; // OR가 있으면 필수 태그 없음
    }

    const tags = this.extractTagsFromExpression(expression);
    const requiredTags = [];

    for (const tag of tags) {
      // NOT이 붙지 않은 태그만
      const pattern = new RegExp(`!\\s*${tag}\\b`);
      if (!pattern.test(expression)) {
        requiredTags.push(tag);
      }
    }

    return requiredTags;
  }
}

// 싱글톤 인스턴스
let instance = null;

/**
 * 싱글톤 인스턴스 반환
 * 
 * @returns {TagExpressionEvaluator}
 */
export function getTagExpressionEvaluator() {
  if (!instance) {
    instance = new TagExpressionEvaluator();
  }
  return instance;
}

export default TagExpressionEvaluator;
