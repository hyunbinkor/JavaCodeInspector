/**
 * 가이드라인 규칙 관리 명령어
 */
import { UnifiedJavaCodeChecker } from '../core/unifiedCodeChecker.js';
import { loadData, saveJsonData } from '../utils/fileUtils.js';

/**
 * 가이드라인 규칙 관리
 * 
 * 내부 흐름:
 * 1. import: 텍스트 파일 → JSON 파싱 → 가이드라인 저장소 저장
 * 2. list: 저장소에서 가이드라인 목록 조회 → 콘솔 출력
 * 3. export: 가이드라인 저장소 → JSON 직렬화 → 파일 저장
 */
export async function manageGuidelines(options) {
  const unifiedChecker = new UnifiedJavaCodeChecker();
  await unifiedChecker.initialize();

  if (options.import) {
    console.log(`가이드라인 가져오기: ${options.import}`);
    const guidelineText = await loadData(options.import, 'rule');

    // 텍스트를 파싱하여 구조화된 규칙으로 변환 후 VectorDB에 저장
    await unifiedChecker.guidelineChecker.importGuidelineText(guidelineText);
    console.log('가이드라인 가져오기 완료');

  } else if (options.list) {
    console.log('저장된 가이드라인 룰 목록:');

    const staticRules = Array.from(unifiedChecker.guidelineChecker.staticRules.values());
    const contextualRules = Array.from(unifiedChecker.guidelineChecker.contextualRules.values());

    console.log(`\n정적 규칙: ${staticRules.length}개`);
    staticRules.forEach((rule, index) => {
      console.log(`  ${index + 1}. ${rule.id} - ${rule.title} (${rule.category})`);
    });

    console.log(`\n맥락적 규칙: ${contextualRules.length}개`);
    contextualRules.forEach((rule, index) => {
      console.log(`  ${index + 1}. ${rule.id} - ${rule.title} (${rule.category})`);
    });

  } else if (options.export) {
    console.log(`가이드라인 내보내기: ${options.export}`);
    const allRules = {
      staticRules: Array.from(unifiedChecker.guidelineChecker.staticRules.values()),
      contextualRules: Array.from(unifiedChecker.guidelineChecker.contextualRules.values())
    };

    await saveJsonData(allRules, options.export, 'rule');
    console.log('가이드라인 내보내기 완료');
  } else {
    console.log('옵션을 지정해주세요: --import, --list, --export 중 하나');
  }
}