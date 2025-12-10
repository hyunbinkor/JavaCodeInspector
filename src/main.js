process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

/**
 * 통합 Java 코드 품질 검사 CLI 프로그램 (메인 진입점)
 * 
 * v2.1 이원화 아키텍처:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                    개발가이드 규칙 검사                           │
 * ├─────────────────────────┬───────────────────────────────────────┤
 * │   정적 규칙 (Static)    │    컨텍스트 규칙 (Contextual)           │
 * │   → SonarQube (보류)    │    → LLM 전담 (활성)                   │
 * │   --skip-static-rules   │    --use-unified-prompt               │
 * └─────────────────────────┴───────────────────────────────────────┘
 * 
 * 3-Layer 아키텍처:
 * - Layer1: DevelopmentGuidelineChecker (가이드라인 규칙 검증)
 * - Layer2: VectorDB 패턴 검색 (Qdrant 기반 유사 패턴 매칭)
 * - Layer3: UnifiedJavaCodeChecker (통합 리포트 생성)
 * 
 * @module main
 * @version 2.1.0 - 이원화 지원
 */

import { Command } from 'commander';
import { pathToFileURL } from 'url';

// Commands
import { processBatchIssues } from './commands/issueCommand.js';
import { searchAndAnalyzePatterns } from './commands/utilCommand.js';
import { performUnifiedCheck, performGuidelineOnlyCheck } from './commands/checkCommand.js';
import { extractGuidelinesFromGuide, importGuidelinesToVectorDB } from './commands/guidelineCommand.js';
import logger from './utils/loggerUtils.js';

const program = new Command();

// CLI 프로그램 기본 정보 설정
program
  .name('unified-code-analyzer')
  .description('통합 Java 코드 품질 검사 도구 (패턴 분석 + 개발가이드 검사) - v2.1 이원화 지원')
  .version('2.1.0');

/**
 * 통합 코드 품질 검사 명령어
 * 
 * v2.1 이원화 옵션:
 * - --skip-static-rules: 정적 규칙 스킵 (SonarQube 연동 전까지 기본 활성화)
 * - --use-batch-prompt: 배치 프롬프트 사용 (기본: 통합 프롬프트)
 * 
 * @command check
 * @example check --code=MyClass.java --output=report.json
 * @example check --code=MyClass.java --skip-patterns --generate-fixes
 * @example check --code=MyClass.java --use-batch-prompt
 */
program
  .command('check')
  .description('통합 Java 코드 품질 검사 (추천)')
  .option('-c, --code <file>', '검사할 Java 코드 파일')
  .option('-o, --output <file>', '분석 결과 저장 파일')
  .option('--skip-patterns', '패턴 분석 건너뛰기')
  .option('--skip-guidelines', '가이드라인 검사 건너뛰기')
  .option('--skip-contextual', 'LLM 기반 맥락적 검사 건너뛰기')
  .option('--skip-static-rules', '정적 규칙 검사 건너뛰기 (SonarQube 연동 전)')
  .option('--use-batch-prompt', '배치 프롬프트 사용 (기본: 통합 프롬프트)')
  .option('--generate-fixes', '수정안 자동 생성')
  .option('-l, --limit <number>', '패턴 검색 결과 수', '10')
  .action(async (options) => {
    try {
      // v2.1 옵션 변환
      const checkOptions = {
        ...options,
        skipStaticRules: options.skipStaticRules !== false,  // 기본: true
        useUnifiedPrompt: !options.useBatchPrompt  // 기본: true (통합 프롬프트)
      };
      await performUnifiedCheck(checkOptions);
    } catch (error) {
      logger.error('통합 검사 실패:', error.message);
      process.exit(1);
    }
  });

/**
 * 개발가이드 전용 검사 명령어
 * 
 * v2.1 이원화:
 * - 정적 규칙은 기본적으로 스킵 (SonarQube 연동 예정)
 * - 컨텍스트 규칙만 LLM으로 검사
 * 
 * @command check-guidelines
 * @example check-guidelines --code=MyClass.java
 * @example check-guidelines --code=MyClass.java --use-batch-prompt --fix
 */
program
  .command('check-guidelines')
  .description('개발가이드 규칙만 검사 (LLM 전담)')
  .option('-c, --code <file>', '검사할 Java 코드 파일')
  .option('--use-batch-prompt', '배치 프롬프트 사용 (기본: 통합 프롬프트)')
  .option('--include-static', '정적 규칙도 포함 (테스트용)')
  .option('--fix', '가이드라인 기반 코드 수정 생성')
  .option('-o, --output <file>', '결과 저장 파일')
  .action(async (options) => {
    try {
      // v2.1 옵션 변환
      const checkOptions = {
        ...options,
        skipStaticRules: !options.includeStatic,  // 기본: true (정적 규칙 스킵)
        useUnifiedPrompt: !options.useBatchPrompt,  // 기본: true (통합 프롬프트)
        skipContextual: false  // 컨텍스트 검사는 항상 활성화
      };
      await performGuidelineOnlyCheck(checkOptions);
    } catch (error) {
      logger.error('가이드라인 검사 실패:', error.message);
      process.exit(1);
    }
  });

/**
 * VectorDB 기반 유사 패턴 검색 및 분석 명령어
 * 
 * @command search
 * @example search --code=MyClass.java --limit=10
 * @example search --code=MyClass.java --fix --output=patterns.json
 */
program
  .command('search')
  .description('유사 패턴 검색 및 수정안 제시 (issueCodeAnalyzer 사용)')
  .option('-c, --code <file>', '검색할 코드 파일')
  .option('-l, --limit <number>', '검색 결과 수', '5')
  .option('--fix', '수정안 제시 활성화')
  .option('-o, --output <file>', '분석 결과 저장 파일')
  .action(async (options) => {
    try {
      await searchAndAnalyzePatterns(options);
    } catch (error) {
      logger.error('❌ 검색 실패:', error.message);
      process.exit(1);
    }
  });

/**
 * 하위 호환성을 위한 search-patterns 명령어 (search와 동일)
 */
program
  .command('search-patterns')
  .description('VectorDB 패턴 분석만 수행 (search 명령어와 동일)')
  .option('-c, --code <file>', '검사할 코드 파일')
  .option('-l, --limit <number>', '검색 결과 수', '5')
  .option('--fix', '수정안 제시 활성화')
  .option('-o, --output <file>', '분석 결과 저장 파일')
  .action(async (options) => {
    try {
      await searchAndAnalyzePatterns(options);
    } catch (error) {
      logger.error('패턴 검색 실패:', error.message);
      process.exit(1);
    }
  });

/**
 * 단일 이슈 분석 및 패턴 데이터셋 생성 명령어
 * 
 * @command analyze
 * @example analyze --input=issue001.json --output=pattern001.json
 */
program
  .command('analyze')
  .description('단일 이슈를 분석하여 패턴 데이터셋 생성')
  .option('-i, --input <file>', '입력 JSON 파일 경로')
  .option('-o, --output <file>', '출력 JSON 파일 경로')
  .action(async (options) => {
    try {
      await processSingleIssue(options);
    } catch (error) {
      logger.error('분석 실패:', error.message);
      process.exit(1);
    }
  });

/**
 * 여러 이슈를 배치로 처리하는 명령어
 * 
 * @command batch
 * @example batch --input=./issues --output=./patterns
 */
program
  .command('batch')
  .description('여러 이슈를 배치로 처리하고 VectorDB에 저장')
  .option('-i, --input <dir>', '입력 디렉토리 경로')
  .option('-o, --output <dir>', '출력 디렉토리 경로 (JSON 저장)')
  .option('--clear-existing', '기존 VectorDB 데이터 전체 삭제 후 저장')
  .option('--skip-existing', '이미 존재하는 패턴 건너뛰기')
  .option('--no-vector-db', 'VectorDB 저장 건너뛰기 (JSON만 생성)')
  .action(async (options) => {
    try {
      await processBatchIssues(options);
    } catch (error) {
      logger.error('배치 처리 실패:', error.message);
      process.exit(1);
    }
  });

/**
 * 가이드라인 규칙 관리 명령어 (CRUD 작업)
 * 
 * @command manage-guidelines
 * @example manage-guidelines --import=guidelines.txt
 * @example manage-guidelines --list
 */
program
  .command('manage-guidelines')
  .description('개발가이드 룰 관리')
  .option('--import <file>', '가이드라인 텍스트 파일 가져오기')
  .option('--list', '저장된 가이드라인 룰 목록 출력')
  .option('--export <file>', '가이드라인 룰을 파일로 내보내기')
  .action(async (options) => {
    try {
      await manageGuidelines(options);
    } catch (error) {
      logger.error('가이드라인 관리 실패:', error.message);
      process.exit(1);
    }
  });

/**
 * PDF에서 개발가이드 규칙 추출 명령어
 * 
 * @command extract-guidelines
 * @example extract-guidelines --input=coding_standards.pdf --output=guidelines.json
 * @example extract-guidelines --input=coding_standards.pdf --output=guidelines.json --import-to-db
 */
program
  .command('extract-guidelines')
  .description('PDF에서 개발가이드 규칙 추출')
  .requiredOption('-i, --input <file>', '입력 PDF 파일 경로')
  .requiredOption('-o, --output <file>', '출력 JSON 파일 경로')
  .option('--import-to-db', '추출 후 바로 VectorDB에 import')
  .action(async (options) => {
    try {
      await extractGuidelinesFromGuide(options);
    } catch (error) {
      logger.error('가이드라인 추출 실패:', error.message);
      process.exit(1);
    }
  });

/**
 * 추출된 가이드라인 JSON을 VectorDB에 일괄 저장하는 명령어
 * 
 * @command import-guidelines
 * @example import-guidelines --input=guidelines.json
 * @example import-guidelines --input=guidelines.json --dry-run
 */
program
  .command('import-guidelines')
  .description('추출된 가이드라인 JSON을 VectorDB에 저장')
  .requiredOption('-i, --input <file>', '가이드라인 JSON 파일 경로')
  .option('--dry-run', 'VectorDB 저장 없이 미리보기만')
  .action(async (options) => {
    try {
      await importGuidelinesToVectorDB(options);
    } catch (error) {
      logger.error('가이드라인 import 실패:', error.message);
      process.exit(1);
    }
  });

/**
 * 시스템 상태 확인 명령어 (헬스체크)
 * 
 * @command status
 * @example status
 */
program
  .command('status')
  .description('시스템 상태 확인')
  .action(async () => {
    try {
      await checkSystemStatus();
    } catch (error) {
      logger.error('상태 확인 실패:', error.message);
      process.exit(1);
    }
  });

/**
 * 메인 진입점
 */
async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    logger.error('실행 오류:', error.message);
    process.exit(1);
  }
}

// 직접 실행 시에만 main 함수 호출
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  main();
}