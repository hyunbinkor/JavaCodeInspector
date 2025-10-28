import { UnifiedJavaCodeChecker } from '../core/unifiedCodeChecker.js';
import { VectorClient } from '../clients/vectorClient.js';
import logger from '../utils/loggerUtils.js';

/**
 * 시스템 상태 확인
 * 1. UnifiedJavaCodeChecker 초기화 테스트
 * 2. VectorDB 연결 확인
 * 3. 저장된 패턴 수 조회
 * 4. 가이드라인 규칙 수 조회
 * 5. 카테고리별 패턴 분포 출력
 */
export async function checkSystemStatus() {
  logger.info('시스템 상태 확인 중...\n');

  const unifiedChecker = new UnifiedJavaCodeChecker();

  try {
    await unifiedChecker.initialize();
    logger.info('모든 시스템이 정상 작동 중입니다.\n');

    const vectorClient = new VectorClient();

    // VectorDB에서 전체 패턴 조회
    const patterns = await vectorClient.getAllPatterns();
    logger.info(`저장된 패턴 수: ${patterns.length}개`);

    // 메모리에 로드된 가이드라인 규칙 수 확인
    const staticRuleCount = unifiedChecker.guidelineChecker.staticRules.size;
    const contextualRuleCount = unifiedChecker.guidelineChecker.contextualRules.size;
    logger.info(`가이드라인 룰: 정적 ${staticRuleCount}개, 맥락적 ${contextualRuleCount}개`);

    // 카테고리별 패턴 분포 통계
    const categoryStats = patterns.reduce((stats, pattern) => {
      stats[pattern.category] = (stats[pattern.category] || 0) + 1;
      return stats;
    }, {});

    if (Object.keys(categoryStats).length > 0) {
      logger.info('\n카테고리별 패턴 분포:');
      Object.entries(categoryStats).forEach(([category, count]) => {
        logger.info(`  - ${category}: ${count}개`);
      });
    }

  } catch (error) {
    logger.error('시스템 오류:', error.message);
    throw error;
  }
}