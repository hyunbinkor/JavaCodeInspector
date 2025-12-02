/**
 * Guideline Context Loader
 * 
 * 개발가이드 문서(docx)에서 카테고리별 컨텍스트를 추출하여
 * LLM 프롬프트에 활용할 수 있도록 구조화
 * 
 * @module GuidelineContextLoader
 */

import fs from 'fs/promises';
import path from 'path';
import logger from './loggerUtils.js';

export class GuidelineContextLoader {
  constructor() {
    this.guidelineContexts = new Map();
    this.guidelineDocPath = null;
    this.initialized = false;
  }

  /**
   * 초기화 - 개발가이드 파일 로드
   */
  async initialize() {
    logger.info('📚 개발가이드 컨텍스트 로더 초기화 중...');
    
    try {
      // 설정에서 가이드라인 경로 로드
      this.guidelineDocPath = process.env.GUIDELINE_DOC_PATH || 
                              path.join(process.cwd(), 'asset', 'development_guide.json');
      
      // JSON 파일로 변환된 가이드라인 로드
      // (GuidelineExtractor로 미리 추출된 파일)
      const content = await fs.readFile(this.guidelineDocPath, 'utf-8');
      const guidelines = JSON.parse(content);
      
      // 카테고리별로 그룹화
      this.groupGuidelinesByCategory(guidelines);
      
      this.initialized = true;
      logger.info(`✅ 개발가이드 로드 완료: ${this.guidelineContexts.size}개 카테고리`);
    } catch (error) {
      logger.warn('⚠️ 개발가이드 파일 로드 실패, 기본 컨텍스트 사용:', error.message);
      this.loadDefaultContexts();
    }
  }

  /**
   * 가이드라인을 카테고리별로 그룹화
   */
  groupGuidelinesByCategory(guidelines) {
    const categoryMapping = {
      'resource_management': ['리소스', 'Connection', 'Statement', 'ResultSet', 'close', 'try-with-resources'],
      'security_vulnerability': ['보안', 'SQL 인젝션', 'XSS', '입력 검증', 'PreparedStatement'],
      'performance_issue': ['성능', 'N+1', '루프', '캐시', 'batch', '인덱스'],
      'exception_handling': ['예외', 'Exception', 'try-catch', 'finally', '에러'],
      'code_quality': ['품질', '가독성', '유지보수', '네이밍', '주석']
    };
    
    for (const [category, keywords] of Object.entries(categoryMapping)) {
      const relevantGuidelines = guidelines.filter(guideline => {
        const text = `${guideline.title} ${guideline.description} ${guideline.details || ''}`.toLowerCase();
        return keywords.some(keyword => text.includes(keyword.toLowerCase()));
      });
      
      this.guidelineContexts.set(category, {
        category: category,
        text: this.buildContextText(relevantGuidelines),
        rules: relevantGuidelines.map(g => ({
          title: g.title,
          description: g.description,
          severity: g.severity || 'MEDIUM',
          examples: g.examples || []
        })),
        keywords: keywords,
        totalRules: relevantGuidelines.length
      });
    }
  }

  /**
   * 가이드라인 텍스트 빌드
   */
  buildContextText(guidelines) {
    return guidelines.map(g => 
      `**${g.title}**\n${g.description}\n${g.details || ''}`
    ).join('\n\n');
  }

  /**
   * 카테고리별 컨텍스트 반환
   */
  async getContextForCategory(category) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const context = this.guidelineContexts.get(category);
    
    if (!context) {
      logger.warn(`⚠️ 카테고리 '${category}'에 대한 컨텍스트 없음, 기본값 반환`);
      return this.getDefaultContext(category);
    }
    
    return context;
  }

  /**
   * 기본 컨텍스트 로드 (파일 없을 때)
   */
  loadDefaultContexts() {
    const defaults = {
      'resource_management': {
        category: 'resource_management',
        text: `리소스 관리 가이드라인:
1. Connection, Statement, ResultSet 등 JDBC 리소스는 반드시 close() 필요
2. try-with-resources 문 사용 권장
3. finally 블록에서 null 체크 후 close() 호출
4. Connection Pool 사용 시 반드시 반환`,
        rules: [
          { title: 'JDBC 리소스 정리', description: 'Connection, Statement, ResultSet 반드시 close', severity: 'CRITICAL' },
          { title: 'try-with-resources 사용', description: 'Java 7+ 자동 리소스 관리', severity: 'HIGH' }
        ],
        keywords: ['리소스', 'Connection', 'close', 'try-with-resources'],
        totalRules: 2
      },
      'security_vulnerability': {
        category: 'security_vulnerability',
        text: `보안 가이드라인:
1. PreparedStatement 사용하여 SQL 인젝션 방지
2. 사용자 입력값 검증 필수
3. 민감정보 로깅 금지
4. XSS 방지를 위한 출력 이스케이핑`,
        rules: [
          { title: 'SQL 인젝션 방지', description: 'PreparedStatement 사용', severity: 'CRITICAL' },
          { title: '입력 검증', description: '모든 사용자 입력 검증', severity: 'HIGH' }
        ],
        keywords: ['보안', 'SQL 인젝션', 'PreparedStatement'],
        totalRules: 2
      },
      'performance_issue': {
        category: 'performance_issue',
        text: `성능 가이드라인:
1. N+1 쿼리 방지 (JOIN 또는 batch fetch 사용)
2. 루프 내 DB 쿼리 금지
3. 적절한 인덱스 사용
4. 캐싱 활용`,
        rules: [
          { title: 'N+1 쿼리 방지', description: 'JOIN 또는 batch fetch', severity: 'HIGH' },
          { title: '루프 내 쿼리 금지', description: '배치 처리 또는 JOIN', severity: 'MEDIUM' }
        ],
        keywords: ['성능', 'N+1', '캐시'],
        totalRules: 2
      },
      'exception_handling': {
        category: 'exception_handling',
        text: `예외 처리 가이드라인:
1. 구체적인 예외 타입 사용
2. 예외 삼키기(swallow) 금지
3. 적절한 로깅
4. finally에서 리소스 정리`,
        rules: [
          { title: '구체적 예외 처리', description: 'Exception 대신 구체적 타입', severity: 'MEDIUM' },
          { title: '예외 삼키기 금지', description: '빈 catch 블록 금지', severity: 'HIGH' }
        ],
        keywords: ['예외', 'Exception', 'try-catch'],
        totalRules: 2
      },
      'code_quality': {
        category: 'code_quality',
        text: `코드 품질 가이드라인:
1. 명확한 변수/메서드명
2. 적절한 주석
3. 단일 책임 원칙
4. 매직 넘버 금지`,
        rules: [
          { title: '명확한 네이밍', description: '의미 있는 이름 사용', severity: 'MEDIUM' },
          { title: '적절한 주석', description: '복잡한 로직에 주석 필수', severity: 'LOW' }
        ],
        keywords: ['품질', '가독성', '네이밍'],
        totalRules: 2
      }
    };
    
    for (const [category, context] of Object.entries(defaults)) {
      this.guidelineContexts.set(category, context);
    }
    
    this.initialized = true;
  }

  /**
   * 기본 컨텍스트 반환
   */
  getDefaultContext(category) {
    return {
      category: category,
      text: `${category} 카테고리에 대한 기본 가이드라인이 없습니다.`,
      rules: [],
      keywords: [],
      totalRules: 0
    };
  }

  /**
   * 모든 카테고리 목록 반환
   */
  getAvailableCategories() {
    return Array.from(this.guidelineContexts.keys());
  }

  /**
   * 통계 정보 반환
   */
  getStatistics() {
    const stats = {
      totalCategories: this.guidelineContexts.size,
      categories: {}
    };
    
    for (const [category, context] of this.guidelineContexts.entries()) {
      stats.categories[category] = {
        totalRules: context.totalRules,
        keywords: context.keywords.length
      };
    }
    
    return stats;
  }
}