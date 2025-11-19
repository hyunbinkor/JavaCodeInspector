/**
 * 가이드라인 추출기 (GuidelineExtractor)
 * 
 * 금융권 개발 가이드 문서(PDF/DOCX)에서 코딩 규칙을 추출하고 구조화하는 컴포넌트
 * - 문서 텍스트 추출 (PDF: pdf2json, DOCX: mammoth)
 * - 정규식 기반 기본 파싱
 * - LLM 기반 심화 분석 및 구조화
 * - Cast Operator 등 복잡한 규칙에 대한 커스텀 검증 지원
 * 
 * 추출 프로세스:
 * 1. extractFromDocument() → 문서 파일 읽기 및 텍스트 추출 (PDF/DOCX)
 * 2. parseTextContent() → 목차 제거, 섹션 분리
 * 3. parseSections() → 번호 기반 섹션 파싱 (2.1, 3.2.1 형식)
 * 4. extractGuidelineFromSection() → 기본 가이드라인 추출
 * 5. (옵션) enhanceGuidelinesWithLLM() → LLMService로 심화 분석
 * 6. saveToJSON() → 구조화된 JSON 저장
 * 
 * 출력 형식 (JSON):
 * {
 *   "metadata": { "extractedAt", "totalRules", "version" },
 *   "guidelines": [
 *     {
 *       "ruleId": "code_style.3_7_3",
 *       "title": "Cast Operator 공백 규칙",
 *       "description": "...",
 *       "category": "code_style",
 *       "checkType": "regex_with_validation",
 *       "patterns": [...],
 *       "severity": "LOW",
 *       "examples": { "good": [...], "bad": [...] }
 *     }
 *   ]
 * }
 * 
 * @module GuidelineExtractor
 * @requires DocumentExtractor - PDF/DOCX 통합 추출기
 * @requires LLMService - LLM 기반 규칙 구조화
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { DocumentExtractor } from '../utils/documentExtractor.js';
import { LLMService } from '../clients/llmService.js';
import { saveJsonData } from '../utils/fileUtils.js';
import logger from '../utils/loggerUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 가이드라인 추출기 클래스
 * 
 * 내부 구조:
 * - guidelines: Array - 최종 추출된 가이드라인 배열
 * - extractedText: string - 문서에서 추출한 전체 텍스트
 * - seenSections: Map<sectionNumber, guideline> - 중복 섹션 방지용
 * - llmService: LLMService 인스턴스 - LLM 기반 심화 분석
 * - rawChunks: Array - LLM 처리 전 기본 추출 결과
 * - documentExtractor: DocumentExtractor - PDF/DOCX 통합 추출기
 * 
 * 추출 전략:
 * - 기본 추출: 정규식 + 섹션 번호 파싱 (빠름, 정확도 중간)
 * - 심화 분석: LLM 기반 구조화 (느림, 정확도 높음)
 * - 하이브리드: 기본 추출 → LLM으로 보완 (권장)
 * 
 * @class
 */
export class GuidelineExtractor {
  /**
   * 생성자: 추출기 초기화
   * 
   * 초기화 항목:
   * 1. guidelines 빈 배열 생성
   * 2. extractedText 빈 문자열 초기화
   * 3. seenSections Map 생성 (중복 방지)
   * 4. LLMService 인스턴스 생성
   * 5. rawChunks 빈 배열 생성
   * 6. DocumentExtractor 인스턴스 생성 (PDF/DOCX 통합)
   * 
   * @constructor
   */
  constructor() {
    this.guidelines = [];           // 최종 추출된 가이드라인 배열
    this.extractedText = '';         // 문서에서 추출한 전체 텍스트
    this.seenSections = new Map();   // 중복 섹션 방지용 맵
    this.llmService = new LLMService();
    this.rawChunks = [];             // LLM 처리 전 기본 추출 결과
    this.documentExtractor = new DocumentExtractor(); // PDF/DOCX 통합 추출기
  }

  /**
   * LLM 서비스 연결 상태를 확인하고 초기화
   * - LLM 연결 실패 시에도 기본 파싱은 진행
   */
  async initialize() {
    logger.info('🚀 가이드라인 추출기 초기화 중...');

    const llmConnected = await this.llmService.checkConnection();
    if (!llmConnected) {
      console.warn('⚠️ LLM 서비스 연결 실패 - 프로그래밍 방식만 사용');
      this.llmService = null;
    } else {
      logger.info('✅ LLM 서비스 연결 완료');
    }
  }

  /**
   * 문서 파일에서 텍스트 추출 및 가이드라인 파싱 시작
   * 
   * PDF, DOCX 파일 모두 지원
   * DOC 파일은 에러 메시지와 함께 변환 안내 제공
   * 
   * 내부 흐름:
   * 1. fs.access() → 문서 파일 존재 확인
   * 2. documentExtractor.isSupported() → 파일 형식 확인
   * 3. documentExtractor.extractText() → 텍스트 추출 (형식별 자동 처리)
   * 4. parseTextContent() 호출 → 텍스트 분석 및 가이드라인 추출
   * 5. guidelines 배열 반환
   * 
   * 에러 처리:
   * - 파일 없음: fs.access() 에러
   * - 지원하지 않는 형식: Error with 지원 형식 안내
   * - DOC 파일: Error with 변환 안내 메시지
   * - 텍스트 없음: extractedText.length === 0 체크
   * 
   * @async
   * @param {string} filePath - 문서 파일 경로 (PDF 또는 DOCX)
   * @returns {Promise<Array>} 추출된 가이드라인 배열
   * @throws {Error} 문서 파일 접근 실패
   * @throws {Error} 지원하지 않는 파일 형식
   * @throws {Error} 텍스트 추출 불가
   * 
   * @example
   * const extractor = new GuidelineExtractor();
   * await extractor.initialize();
   * 
   * // PDF 파일
   * const guidelines1 = await extractor.extractFromDocument('./guide.pdf');
   * 
   * // DOCX 파일
   * const guidelines2 = await extractor.extractFromDocument('./guide.docx');
   * 
   * logger.info(`추출된 규칙: ${guidelines1.length}개`);
   */
  async extractFromDocument(filePath) {
    try {
      logger.info(`📄 문서 파일 확인 중: ${filePath}`);
      await fs.access(filePath);
      logger.info('✅ 문서 파일 존재 확인됨');

      // 파일 형식 확인
      if (!this.documentExtractor.isSupported(filePath)) {
        const ext = path.extname(filePath).toLowerCase();
        
        // DOC 파일인 경우 변환 안내
        if (ext === '.doc') {
          const help = this.documentExtractor.getDocConversionHelp(filePath);
          throw new Error(help);
        }
        
        const supportedFormats = this.documentExtractor.getSupportedFormats();
        throw new Error(
          `지원하지 않는 파일 형식입니다.\n` +
          `지원 형식: ${supportedFormats.join(', ')}`
        );
      }

      // 통합 텍스트 추출 (PDF/DOCX 자동 감지)
      logger.info('📖 문서 파싱 중...');
      this.extractedText = await this.documentExtractor.extractText(filePath);

      logger.info(`✅ 텍스트 추출 완료 - 총 ${this.extractedText.length}자`);

      if (this.extractedText.length === 0) {
        throw new Error('문서에서 텍스트를 추출할 수 없습니다.');
      }

      // 기존 텍스트 분석 로직 호출
      await this.parseTextContent(this.extractedText);
      
      logger.info(`총 ${this.guidelines.length}개 가이드라인 추출 완료`);
      return this.guidelines;

    } catch (error) {
      logger.error('문서 처리 오류:', error.message);
      throw error;
    }
  }

  /**
   * 하위 호환성: extractFromPDF() 유지
   * 
   * @deprecated extractFromDocument() 사용 권장
   * @param {string} pdfPath - PDF 파일 경로
   * @returns {Promise<Array>} 추출된 가이드라인 배열
   */
  async extractFromPDF(pdfPath) {
    logger.warn('⚠️ extractFromPDF()는 deprecated입니다. extractFromDocument() 사용을 권장합니다.');
    return await this.extractFromDocument(pdfPath);
  }

  /**
   * 추출된 텍스트 분석 및 섹션 파싱
   * 
   * 내부 흐름:
   * 1. 공백 정규화 (여러 공백 → 하나로 통일)
   * 2. 목차 제거:
   *    a. "2. 명명 규칙" + "2.1. 서비스" 패턴으로 본문 시작점 탐지
   *    b. 또는 "설계 단계" 마커로 fallback
   * 3. parseSections() → 번호 기반 섹션 분리 (2.1, 3.2.1 형식)
   * 4. 각 섹션에 대해:
   *    a. extractGuidelineFromSection() → 기본 가이드라인 추출
   *    b. isValidGuideline() → 유효성 검증
   *    c. rawChunks에 추가 (LLM 처리 대기)
   * 5. (LLM 사용 시) enhanceGuidelinesWithLLM() → 심화 분석 및 구조화
   * 6. (LLM 미사용 시) rawChunks의 basicGuideline을 guidelines에 저장
   * 
   * 목차 제거 전략:
   * - Primary: "2. 명명 규칙" 다음 "2.1. 서비스" 패턴
   * - Fallback: "설계 단계 명명규칙 및 코딩표준" 문자열 검색
   * 
   * 섹션 파싱 규칙:
   * - 번호 형식: N.N, N.N.N, N.N.N.N (예: 2.1, 3.2.1, 3.3.1.1)
   * - 각 섹션은 다음 섹션 번호 또는 EOF까지
   * 
   * @async
   * @param {string} text - 문서에서 추출한 전체 텍스트
   * @returns {Promise<void>} guidelines 배열에 결과 저장
   */
  /**
 * 추출된 텍스트 분석 및 섹션 파싱
 * DOCX와 PDF 모두 호환되도록 개선
 */
/**
 * 추출된 텍스트 분석 및 섹션 파싱
 * DOCX의 목차 형식 문제 해결 ("명명 규칙 2" → "2.1 서비스 ID")
 */
async parseTextContent(text) {
  logger.info('텍스트 분석 시작...\n');

  // 공백 정규화: 여러 공백을 하나로 통일
  let normalizedText = text
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .join('\n');

  let workingText = normalizedText;
  const lines = normalizedText.split('\n');
  let contentStartLine = -1;

  // ============================================
  // DOCX 목차 완전 제거 로직
  // ============================================
  
  logger.info('📋 목차 제거 시작...\n');
  
  // 방법 1: "제/개정 이력" 또는 "목 차" 이후 첫 번째 "2.1"로 시작하는 본문 찾기
  let foundMarker = false;
  let markerType = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // 마커 감지 (제/개정 이력, 목차, Ver 1.0 등)
    if (!foundMarker) {
      if (line.match(/제\s*\/\s*개정\s*이력/)) {
        foundMarker = true;
        markerType = '제/개정 이력';
        logger.info(`  ✔ "${markerType}" 발견 (${i}번째 줄)`);
        continue;
      }
      if (line.match(/목\s+차|목차/)) {
        foundMarker = true;
        markerType = '목차';
        logger.info(`  ✔ "${markerType}" 발견 (${i}번째 줄)`);
        continue;
      }
      if (line.match(/Ver\s*\d+\.\d+/)) {
        foundMarker = true;
        markerType = 'Ver';
        logger.info(`  ✔ "${markerType}" 발견 (${i}번째 줄)`);
        continue;
      }
    }
    
    // 마커 이후 본문 찾기
    if (foundMarker) {
      // 목차 패턴 감지 및 건너뛰기
      // "명명 규칙       2" 같은 패턴
      if (line.match(/^[가-힣\s\(]+\s+\d{1,2}$/)) {
        logger.info(`  ⏭️  목차 항목 건너뜀: "${line.substring(0, 50)}"`);
        continue;
      }
      
      // "개요    1" 같은 패턴
      if (line.match(/^[가-힣]{2,10}\s+\d{1,2}$/)) {
        logger.info(`  ⏭️  목차 항목 건너뜀: "${line}"`);
        continue;
      }
      
      // 본문 섹션 패턴: "2.1", "2.1.", "2.1 서비스" 등
      if (line.match(/^2\.1[\.\s]/)) {
        contentStartLine = i;
        logger.info(`  ✅ 본문 시작 발견 (${i}번째 줄): "${line.substring(0, 50)}"`);
        break;
      }
    }
  }
  
  // 방법 2 (Fallback): 첫 번째 "2.1"로 시작하는 줄 (단, 목차 형식 제외)
  if (contentStartLine < 0) {
    logger.warn('  ⚠️ 마커 방법 실패, 직접 검색 시작...');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // "2.1 서비스" 같은 본문 패턴
      if (line.match(/^2\.1\s+[가-힣a-zA-Z]/)) {
        // 목차 형식 제외 ("서비스 ID       2" 같은 것)
        if (!line.match(/\s+\d{1,2}$/)) {
          contentStartLine = i;
          logger.info(`  ✅ 본문 시작 발견 (직접 검색, ${i}번째 줄): "${line.substring(0, 50)}"`);
          break;
        }
      }
    }
  }
  
  // 방법 3 (Last Resort): "명명 규칙" 이후 모든 텍스트
  if (contentStartLine < 0) {
    logger.warn('  ⚠️ 본문 시작점을 찾을 수 없습니다.');
    
    const namingStart = normalizedText.indexOf('명명 규칙');
    if (namingStart > 0) {
      workingText = normalizedText.substring(namingStart + '명명 규칙'.length);
      logger.info('  ⚠️ "명명 규칙" 이후 텍스트 사용 (fallback)');
    } else {
      logger.error('  ❌ 본문을 전혀 찾을 수 없습니다. 전체 텍스트 사용');
    }
  }

  // 목차 제거: 본문 시작점 이후부터만 사용
  if (contentStartLine > 0) {
    workingText = lines.slice(contentStartLine).join('\n');
    logger.info(`\n✅ 목차 제거 완료 (${contentStartLine}줄 제거)`);
    logger.info(`   본문 시작: "${lines[contentStartLine].substring(0, 60)}..."`);
  }

  logger.info(`\n작업 텍스트: ${workingText.split('\n').length}줄, ${workingText.length}자`);
  logger.info(`샘플:\n${workingText.substring(0, 300)}...\n`);

  // 번호 기반 섹션 파싱 (2.1, 3.2.1 형식)
  const sections = this.parseSections(workingText);
  logger.info(`\n${sections.length}개 섹션 발견\n`);

  if (sections.length === 0) {
    logger.error('❌ 섹션을 찾지 못했습니다!');
    logger.error('   DOCX 파일 구조를 확인하세요.');
    
    const sampleLines = workingText.split('\n').slice(0, 50);
    logger.info('\n📋 처음 50줄:');
    sampleLines.forEach((line, idx) => {
      if (line.trim().length > 0) {
        logger.info(`${idx}: ${line.substring(0, 100)}`);
      }
    });
    
    // 디버깅: 숫자로 시작하는 줄 찾기
    const numberedLines = workingText.split('\n')
      .filter(line => line.match(/^\d+\./))
      .slice(0, 30);
    
    if (numberedLines.length > 0) {
      logger.info('\n🔢 숫자로 시작하는 줄들:');
      numberedLines.forEach(line => {
        logger.info(`  ${line.substring(0, 80)}`);
      });
    }
    
    logger.error('\n⚠️ 추출 실패. extracted_text_debug.txt 파일을 확인하세요.');
  }

  // 각 섹션에서 기본 가이드라인 추출
  for (const section of sections) {
    const basicGuideline = this.extractGuidelineFromSection(section);

    if (basicGuideline && this.isValidGuideline(basicGuideline)) {
      this.rawChunks.push({
        sectionNumber: section.number,
        title: section.title,
        content: section.content,
        basicGuideline: basicGuideline
      });
    }
  }

  logger.info(`\n✅ 유효한 가이드라인 ${this.rawChunks.length}개 발견`);

  // LLM을 사용한 심화 분석 (연결된 경우)
  if (this.llmService && this.rawChunks.length > 0) {
    logger.info(`\n🧠 LLM 심화 분석 시작 (${this.rawChunks.length}개 청크)`);
    await this.enhanceGuidelinesWithLLM();
  } else {
    logger.info('\n⚠️ LLM 미사용 - 기본 추출 결과만 저장');
    this.guidelines = this.rawChunks.map(chunk => chunk.basicGuideline);
  }
}

  /**
   * LLM을 사용하여 기본 가이드라인을 향상
   * - 배치 처리로 API 호출 최적화
   * - 중복 제거 및 더 나은 설명으로 업데이트
   */
  async enhanceGuidelinesWithLLM() {
    const batchSize = 5;

    for (let i = 0; i < this.rawChunks.length; i += batchSize) {
      const batch = this.rawChunks.slice(i, Math.min(i + batchSize, this.rawChunks.length));
      logger.info(`\n📦 배치 ${Math.floor(i / batchSize) + 1}/${Math.ceil(this.rawChunks.length / batchSize)} 처리 중...`);

      const enhancedBatch = await Promise.all(
        batch.map(chunk => this.enhanceGuidelineWithLLM(chunk))
      );

      // 향상된 가이드라인을 결과에 추가 (중복 시 더 나은 것으로 대체)
      enhancedBatch.forEach(enhanced => {
        if (enhanced) {
          const existing = this.seenSections.get(enhanced.sectionNumber);
          if (existing) {
            // 더 긴 설명을 가진 것으로 업데이트
            if (enhanced.description.length > existing.description.length) {
              const index = this.guidelines.findIndex(g => g.sectionNumber === enhanced.sectionNumber);
              if (index !== -1) {
                this.guidelines[index] = enhanced;
                this.seenSections.set(enhanced.sectionNumber, enhanced);
                logger.info(`✔ 규칙 갱신 (LLM): ${enhanced.title}`);
              }
            }
          } else {
            this.guidelines.push(enhanced);
            this.seenSections.set(enhanced.sectionNumber, enhanced);
            logger.info(`✔ 규칙 추출 (LLM): ${enhanced.title}`);
          }
        }
      });

      // API rate limit 방지를 위한 딜레이
      if (i + batchSize < this.rawChunks.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * 단일 청크를 LLM으로 분석하여 향상된 가이드라인 생성
   * - 실패 시 기본 가이드라인 반환
   */
  async enhanceGuidelineWithLLM(chunk) {
    try {
      const prompt = this.buildGuidelineAnalysisPrompt(chunk);
      const llmResponse = await this.llmService.generateGuidelineAnalysis(prompt);

      if (!llmResponse || !llmResponse.enhancedGuideline) {
        console.warn(`  ⚠️ LLM 분석 실패: ${chunk.title} - 기본 가이드라인 사용`);
        return chunk.basicGuideline;
      }

      return this.mergeGuidelineResults(chunk.basicGuideline, llmResponse.enhancedGuideline);

    } catch (error) {
      console.warn(`  ⚠️ LLM 처리 오류 (${chunk.title}): ${error.message}`);
      return chunk.basicGuideline;
    }
  }

  /**
   * LLM 분석용 프롬프트 생성
   * - Cast Operator 규칙에 대한 특별 지침 포함
   * - 검사 타입, 패턴, 예제 추출 요청
   */
  buildGuidelineAnalysisPrompt(chunk) {
    // Cast Operator 규칙인지 확인하여 특별 처리
    const isCastOperatorRule = chunk.title.includes('Cast') &&
      chunk.title.includes('Operator');

    const castOperatorGuidance = isCastOperatorRule ? `

**⚠️ CRITICAL - Cast Operator 규칙 특별 처리:**
이 규칙은 Cast Operator에 대한 것입니다. 다음을 반드시 준수하세요:

1. **정확한 패턴 정의**: Cast Operator는 (Type)variable 형태만 해당
   - 메서드 호출 executeQuery()는 제외
   - 조건문 if(), while(), for()는 제외
   - 실제 타입 캐스팅만 검출: (String)obj, (Integer)value 등

2. **커스텀 검증 함수 필수**:
\`\`\`javascript
customValidator: (line) => {
  // 메서드 호출 제외
  if (/\\w+\\s*\\([^)]*\\)\\s*\\./.test(line)) return false;
  // 조건문 제외
  if (/^\\s*(if|while|for|switch)\\s*\\(/.test(line)) return false;
  // 실제 Cast 연산자만
  return /\\(\\s*[A-Z][a-zA-Z0-9<>]*\\s*\\)\\s+[a-zA-Z_]/.test(line);
}
\`\`\`

3. **패턴 예시**:
   - 좋은 예: (String)obj, (Integer)value, (Connection)dataSource
   - 나쁜 예: executeQuery(), stmt.close(), if(condition)
` : '';

    return `
당신은 코딩 가이드라인 분석 전문가입니다. 아래 가이드라인 텍스트를 분석하여 구조화된 검사 규칙을 생성하세요.

**섹션 번호:** ${chunk.sectionNumber}
**제목:** ${chunk.title}
**원본 내용:**
${chunk.content}
${castOperatorGuidance}

**분석 요구사항:**
1. **checkType 결정**: 이 규칙을 검사하는 최적 방법 선택
   - "regex": 정규식으로 검사 가능 (예: 명명 패턴)
   - "regex_with_validation": 정규식 + 커스텀 검증 함수 필요 (예: Cast Operator)
   - "static_analysis": AST 구조 분석 필요 (예: 메서드 구조)
   - "llm_contextual": 맥락 이해 필요 (예: "DB column명을 소문자로 변환")

2. **구조화된 설명**: 핵심 규칙을 명확하고 검사 가능한 형태로 기술

3. **검사 가능한 패턴 추출**:
   - 정규식 패턴이 있다면 추출
   - AST 노드 타입이나 구조 힌트
   - LLM이 검사해야 할 구체적 조건
   - ⚠️ Cast Operator의 경우 커스텀 검증 함수도 포함

4. **실행 가능한 예제**: 좋은 예제와 나쁜 예제를 코드로 제시

5. **비즈니스 규칙 추출**: "~해야 한다", "~를 따른다" 같은 규칙을 명시적으로 추출

**출력 형식 (JSON):**
{
  "checkType": "regex|regex_with_validation|static_analysis|llm_contextual",
  "enhancedDescription": "명확하고 검사 가능한 설명",
  "businessRules": [
    "추출된 비즈니스 규칙 1",
    "추출된 비즈니스 규칙 2"
  ],
  "patterns": [
    {
      "pattern": "정규식 문자열",
      "flags": "g",
      "description": "패턴 설명"
    }
  ],
  "customValidator": "커스텀 검증 함수 (JavaScript 코드 문자열, regex_with_validation인 경우)",
  "astHints": {
    "nodeTypes": ["MethodDeclaration", "VariableDeclarator"],
    "checkConditions": ["조건 설명"]
  },
  "examples": {
    "good": ["좋은 예제 코드1", "좋은 예제 코드2"],
    "bad": ["나쁜 예제 코드1", "나쁜 예제 코드2"]
  },
  "contextualChecks": [
    {
      "condition": "검사할 조건",
      "expectedBehavior": "기대되는 동작",
      "violationMessage": "위반 시 메시지"
    }
  ]
}

특히 "LData의 Key는 DB column명을 소문자로 변환하여 저장한다"와 같은 비즈니스 규칙은 llm_contextual 타입으로 분류하고, contextualChecks에 구체적 검사 조건을 명시하세요.

⚠️ Cast Operator 규칙의 경우 반드시 customValidator 필드를 포함하세요.
`;
  }

  /**
   * 기본 가이드라인과 LLM 향상 결과를 병합
   * - 중복 제거 및 최선의 정보 조합
   * - customValidator 필드 보존
   */
  mergeGuidelineResults(basicGuideline, llmEnhanced) {
    return {
      ...basicGuideline,
      checkType: llmEnhanced.checkType || basicGuideline.checkType,
      description: llmEnhanced.enhancedDescription || basicGuideline.description,
      businessRules: llmEnhanced.businessRules || [],
      patterns: [
        ...new Set([
          ...(basicGuideline.patterns || []),
          ...(llmEnhanced.patterns || [])
        ])
      ],
      customValidator: llmEnhanced.customValidator || null,
      astHints: llmEnhanced.astHints || {},
      examples: {
        good: [
          ...new Set([
            ...(basicGuideline.examples?.good || []),
            ...(llmEnhanced.examples?.good || [])
          ])
        ].slice(0, 5),
        bad: [
          ...new Set([
            ...(basicGuideline.examples?.bad || []),
            ...(llmEnhanced.examples?.bad || [])
          ])
        ].slice(0, 5)
      },
      contextualChecks: llmEnhanced.contextualChecks || []
    };
  }

  /**
   * 텍스트를 섹션으로 분리
   * - 번호 패턴(2.1, 3.2.1 등)을 기준으로 섹션 구분
   * - 각 섹션의 제목과 내용 추출
   */
  /**
 * 텍스트를 섹션으로 분리
 * - 번호 패턴(2.1, 3.2.1 등)을 기준으로 섹션 구분
 * - 각 섹션의 제목과 내용 추출
 * - DOCX와 PDF 모두 호환
 */
/**
 * 텍스트를 섹션으로 분리
 * - 번호 패턴(2.1, 3.2.1 등)을 기준으로 섹션 구분
 * - 날짜, 이상 패턴 제외
 * - DOCX와 PDF 모두 호환
 */
parseSections(text) {
  const sections = [];

  // DOCX 호환성 개선: 공백 정규화 먼저 수행
  text = text.replace(/\s+/g, ' ').trim();
  
  // 섹션 번호 앞에 개행 삽입하여 분리 용이하게 만듦
  let processedLines = text
    .replace(/(\d+\.\d+(?:\.\d+)?\.?\s+[가-힣a-zA-Z]+)/g, '\n$1')
    .split('\n')
    .filter(line => line.trim().length > 0);

  logger.info(`전처리 후 ${processedLines.length}개 라인\n`);

  for (let i = 0; i < processedLines.length; i++) {
    const line = processedLines[i].trim();

    // 목차 구분선 제외
    if (line.includes('....')) continue;

    // 섹션 헤더 패턴 매칭 (예: "2.1 서비스 명명")
    const headerMatch = line.match(/^(\d+\.\d+(?:\.\d+)?\.?)\s+([^\n]{2,100})/);

    if (!headerMatch) continue;

    const sectionNumber = headerMatch[1].replace(/\.$/, '');
    let remainingText = headerMatch[2];

    // ============================================
    // 섹션 번호 검증 (날짜/이상 패턴 제외)
    // ============================================
    
    // 1. 날짜 패턴 제외 (20120712, 20241201 등)
    if (sectionNumber.match(/20\d{6}$/)) {
      logger.warn(`  ⏭️  날짜 패턴 제외: ${sectionNumber}`);
      continue;
    }
    
    // 2. 8자리 숫자 패턴 제외 (파일명의 날짜 부분)
    if (sectionNumber.match(/\d{8}$/)) {
      logger.warn(`  ⏭️  8자리 숫자 패턴 제외: ${sectionNumber}`);
      continue;
    }
    
    // 3. 앞에 0이 여러 개 있는 이상한 패턴 제외
    if (sectionNumber.match(/^0{3,}\d/)) {
      logger.warn(`  ⏭️  이상한 0 패턴 제외: ${sectionNumber}`);
      continue;
    }
    
    // 4. 너무 긴 섹션 번호 제외 (정상: 2.1, 3.2.1, 3.3.1.2 / 비정상: 000101.02)
    if (sectionNumber.replace(/\./g, '').length > 6) {
      logger.warn(`  ⏭️  너무 긴 섹션 번호 제외: ${sectionNumber}`);
      continue;
    }
    
    // 5. 유효한 섹션 번호 패턴만 허용 (2.x, 3.x, ...)
    if (!sectionNumber.match(/^[2-9]\.\d+/)) {
      logger.warn(`  ⏭️  유효하지 않은 섹션 번호: ${sectionNumber}`);
      continue;
    }

    // 완전한 제목 추출 (다음 줄까지 포함될 수 있음)
    let sectionTitle = this.extractFullTitle(remainingText, processedLines, i);

    // 제목 정리: 공백 정규화, 불완전한 괄호 제거
    sectionTitle = sectionTitle
      .replace(/\s+/g, ' ')
      .replace(/\s*\([^)]*$/, '')
      .replace(/\s*[\(\[].*?[\)\]].*?[\(\[].*$/, '')
      .trim();

    // 짧은 제목의 경우 다음 줄과 결합
    if (sectionTitle.match(/^(서비스|input|output)\s*$/i)) {
      if (i + 1 < processedLines.length) {
        const nextLine = processedLines[i + 1].trim();
        if (!nextLine.match(/^\d+\.\d+/) && nextLine.length < 50) {
          sectionTitle += ' ' + nextLine.split(/\s{2,}/)[0];
        }
      }
    }

    // "The" 시작 제목의 경우 완전한 문장 찾기
    if (sectionTitle === 'The' || sectionTitle.startsWith('The ')) {
      for (let j = i + 1; j < Math.min(i + 3, processedLines.length); j++) {
        const nextLine = processedLines[j].trim();
        if (nextLine.match(/^\d+\.\d+/)) break;
        if (nextLine.match(/^(for|while|do|if|switch|statement)/i)) {
          sectionTitle = 'The ' + nextLine.split(/\s+/).slice(0, 3).join(' ');
          break;
        }
      }
    }

    sectionTitle = sectionTitle.substring(0, 100).trim();

    // 유효하지 않은 제목 필터링
    if (sectionTitle.length < 2) continue;
    if (sectionTitle.includes('....')) continue;
    
    // 저작권 정보나 메타데이터 제외
    if (sectionTitle.match(/copyright|PROJ|MY Core Banking System/i)) {
      logger.warn(`  ⏭️  메타데이터 제외: ${sectionTitle.substring(0, 50)}`);
      continue;
    }

    // 섹션 내용 수집 (다음 섹션 헤더까지)
    let content = line + '\n';
    for (let j = i + 1; j < processedLines.length; j++) {
      const nextLine = processedLines[j].trim();
      if (nextLine.match(/^\d+\.\d+(?:\.\d+)?\.?\s+[가-힣a-zA-Z]/)) {
        break;
      }
      content += nextLine + '\n';
    }

    // 너무 짧은 섹션 제외
    if (content.length < 50) continue;

    sections.push({
      number: sectionNumber,
      title: sectionTitle,
      content: content,
      fullTitle: `${sectionNumber} ${sectionTitle}`
    });

    logger.info(`  ✔ ${sectionNumber} ${sectionTitle} (${content.length}자)`);
  }

  logger.info(`\n총 ${sections.length}개 섹션 파싱 완료`);
  return sections;
}

  /**
   * 여러 줄에 걸친 제목 추출
   * - 다음 섹션이나 특정 키워드 전까지 제목으로 간주
   */
  extractFullTitle(startLine, lines, startIndex) {
    let titleParts = [startLine];
    let collected = 0;
    const MAX_TITLE_LENGTH = 50;

    for (let i = startIndex + 1; i < Math.min(startIndex + 3, lines.length); i++) {
      const line = lines[i].trim();

      // 다음 섹션 번호 발견 시 중단
      if (line.match(/^\d+\.\d+/)) break;
      // 표 항목 시작 키워드 발견 시 중단
      if (line.match(/^(항목|구분|예\)|▪|주\)|설명|내용|길이)$/)) break;
      // 목차 구분선 발견 시 중단
      if (line.includes('....')) break;

      const currentTitle = titleParts.join(' ');
      if (currentTitle.length > MAX_TITLE_LENGTH) break;

      // 문장 종결 발견 시 중단
      if (line.match(/[.다한]\s*$/)) break;
      // 너무 긴 줄은 제외
      if (line.length > 80) break;

      titleParts.push(line);
      collected++;
    }

    return titleParts.join(' ').substring(0, MAX_TITLE_LENGTH).trim();
  }

  /**
   * 가이드라인 유효성 검증
   * - 제목 길이, 형식, 내용 품질 확인
   * - 목차나 메타데이터 항목 필터링
   */
  isValidGuideline(guideline) {
    // 기본 형식 검증
    if (!guideline.title || guideline.title.length > 100) return false;
    if (guideline.title.length < 3) return false;
    if (guideline.description.length < 10) return false;

    // 메타데이터 항목 제외
    if (guideline.title.match(/^(개정|목\s*차|변\s*경\s*사\s*항)/)) return false;
    if (guideline.title.includes('....')) return false;

    // 불완전한 제목 제외
    if (guideline.title.match(/[가-힣]{2,3}\s*(필요한|추가|수정|작성|최초)/)) return false;
    if (guideline.sectionNumber.match(/\d{4}\.\d{2}\.\d{2}/)) return false;
    if (guideline.title.includes('---')) return false;

    // 의미 없는 제목 제외
    if (guideline.title.match(/^\s*[ID(]+\s*$/)) return false;

    // 단일 단어 제목 검증 (허용 목록에 있는 경우만)
    const allowedSingleWords = [
      'Exception', 'Package', 'LData', 'SQL', 'try',
      'Compound', 'Binary', 'Unary', 'Cast', 'Comma', 'Complete'
    ];

    const words = guideline.title.trim().split(/\s+/);
    if (words.length === 1) {
      if (!allowedSingleWords.includes(guideline.title)) {
        // 한글 단일 단어의 경우 허용 목록 확인
        if (guideline.title.match(/^[가-힣]{1,3}$/)) {
          const allowedKorean = ['패키지', '클래스', '메소드', '로컬변수', '상수'];
          if (!allowedKorean.includes(guideline.title)) {
            return false;
          }
        }
        // 너무 짧은 영문 단어 제외
        else if (guideline.title.length < 4 && !guideline.title.match(/^(SQL|try)$/)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * 섹션에서 구조화된 가이드라인 객체 생성
   * - 카테고리, 심각도, 검사 타입 결정
   * - 패턴, 예제, 키워드 추출
   * - Cast Operator 규칙에 대한 customValidator 추가
   */
  extractGuidelineFromSection(section) {
    const { number, title, content } = section;

    const category = this.determineCategory(number, title, content);
    const description = this.extractDescription(content, title);
    const examples = this.extractExamples(content);
    const patterns = this.extractPatterns(content);
    const severity = this.determineSeverity(title, content);
    const checkType = this.determineCheckType(content, patterns);

    // Cast Operator 규칙에 대한 커스텀 검증 함수 추가
    let customValidator = null;
    if (title.includes('Cast') && title.includes('Operator')) {
      customValidator = `(line) => {
  if (/\\w+\\s*\\([^)]*\\)\\s*\\./.test(line)) return false;
  if (/^\\s*(if|while|for|switch)\\s*\\(/.test(line)) return false;
  return /\\(\\s*[A-Z][a-zA-Z0-9<>]*\\s*\\)\\s+[a-zA-Z_]/.test(line);
}`;
    }

    return {
      ruleId: this.generateRuleId(category, number),
      title: title,
      category: category,
      checkType: checkType,
      description: description,
      severity: severity,
      patterns: patterns,
      customValidator: customValidator,
      keywords: this.extractKeywords(title, content),
      examples: examples,
      sectionNumber: number
    };
  }

  /**
   * 섹션 번호와 내용을 기반으로 카테고리 결정
   * - 2.x: 명명 규칙
   * - 3.2: 문서화
   * - 3.3.1.x: 포맷팅
   * - 3.x: 코드 스타일
   * - Exception 관련: 에러 처리
   * - LData 관련: 프레임워크 특화
   */
  determineCategory(number, title, content) {
    const titleLower = title.toLowerCase();

    if (number.startsWith('2.')) {
      return 'naming_convention';
    }

    if (number.startsWith('3.2')) {
      return 'documentation';
    }

    if (number.match(/^3\.3\.1\./)) {
      return 'formatting';
    }

    if (number.startsWith('3.')) {
      return 'code_style';
    }

    if (titleLower.includes('exception') || titleLower.includes('예외')) {
      return 'error_handling';
    }

    if (titleLower.includes('ldata') || titleLower.includes('lmultidata')) {
      return 'framework_specific';
    }

    return 'code_style';
  }

  /**
   * 콘텐츠에서 의미 있는 설명 문장 추출
   * - 규칙을 설명하는 문장 우선 선택
   * - 표 헤더나 예제 마커 제외
   */
  extractDescription(content, title) {
    const sentences = content
      .replace(/\s+/g, ' ')
      .split(/[.!?]\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 15 && s.length < 500);

    for (const sentence of sentences) {
      // 제목 반복 제외
      if (sentence.includes(title)) continue;
      // 표 헤더 제외
      if (sentence.match(/항목.*길이.*설명/)) continue;
      if (sentence.match(/구분.*내용.*설명/)) continue;
      if (sentence.match(/^예\s*\)/)) continue;

      // 규칙을 나타내는 서술어 포함 여부 확인
      if (sentence.includes('한다') || sentence.includes('이다') ||
        sentence.includes('따른다') || sentence.includes('사용') ||
        sentence.includes('정의') || sentence.includes('표준') ||
        sentence.includes('선언') || sentence.includes('작성')) {
        return sentence.substring(0, 300);
      }
    }

    return `${title}에 대한 코딩 규칙을 정의합니다.`;
  }

  /**
   * 콘텐츠에서 코드 예제 추출
   * - "예)" 마커로 시작하는 예제
   * - 일반적인 코드 패턴 (변수 선언, 메서드 등)
   */
  extractExamples(content) {
    const examples = { good: [], bad: [] };

    // "예)" 마커가 있는 예제 추출
    const exampleMatches = content.matchAll(/예\s*\)\s*([^\n]{5,150})/g);
    for (const match of exampleMatches) {
      const example = match[1].trim();
      // 유효한 예제만 (날짜 패턴 제외)
      if (example && !example.includes('....') && !example.match(/20\d{2}/)) {
        examples.good.push(example);
      }
    }

    // 코드 패턴으로 보이는 내용 추출
    const codePatterns = [
      /([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*[^;]{1,80};/g,  // 변수 할당
      /(public|private|protected)\s+[a-zA-Z]+\s+[a-zA-Z_]/g,  // 메서드/필드 선언
      /[a-zA-Z_][a-zA-Z0-9_]*\([^)]{0,60}\)/g  // 메서드 호출
    ];

    for (const pattern of codePatterns) {
      const matches = [...content.matchAll(pattern)];
      for (const match of matches.slice(0, 2)) {
        const code = match[0].trim();
        // 날짜가 아니고 충분히 긴 코드만
        if (!code.match(/20\d{2}/) && code.length > 5) {
          examples.good.push(code);
        }
      }
    }

    return {
      good: [...new Set(examples.good)].slice(0, 5),
      bad: [...new Set(examples.bad)]
    };
  }

  /**
   * 검증에 사용할 패턴 추출
   * - Cast Operator 규칙: 특화된 공백 검증 패턴
   * - 일반 규칙: 정규식 및 포맷 패턴
   */
  extractPatterns(content) {
    const patterns = [];

    // Cast Operator 규칙 감지 및 특화 패턴 추가
    const isCastOperatorRule = content.includes('Cast') &&
      (content.includes('연산자') || content.includes('Operator'));

    if (isCastOperatorRule) {
      // Cast 연산자 뒤 2칸 이상 공백 검출
      patterns.push({
        pattern: '\\(\\s*[A-Z][a-zA-Z0-9<>]*\\s*\\)\\s{2,}[a-zA-Z_]',
        flags: 'g',
        description: 'Cast 연산자 뒤 2칸 이상 공백'
      });
      // Cast 연산자 괄호 내부 공백 검출
      patterns.push({
        pattern: '\\(\\s+[A-Z][a-zA-Z0-9<>]*\\s+\\)\\s*[a-zA-Z_]',
        flags: 'g',
        description: 'Cast 연산자 괄호 내부 공백'
      });
    } else {
      // 일반 정규식 패턴 추출
      const regexMatches = content.match(/[\^$]\[?[A-Za-z0-9\-\+\*\{\}]+\]?/g);
      if (regexMatches) {
        patterns.push(...regexMatches.map(p => ({
          pattern: p,
          flags: 'g'
        })));
      }
    }

    // 포맷 규칙 추출 (예: "100자리")
    const formatMatches = content.match(/\d+\s*자리/g);
    if (formatMatches) {
      patterns.push(...formatMatches.map(p => ({
        pattern: p,
        flags: 'g'
      })));
    }

    return patterns.slice(0, 5);
  }

  /**
   * 규칙의 심각도 결정
   * - HIGH: 100자 제한, 필수 조건
   * - MEDIUM: 권장 사항
   * - LOW: 기타
   */
  determineSeverity(title, content) {
    const text = (title + ' ' + content).toLowerCase();

    // 100자 제한 규칙
    if (text.includes('100') && text.includes('characters')) {
      return 'HIGH';
    }

    // 필수 조건
    if (text.includes('필수') || text.includes('반드시')) {
      return 'HIGH';
    }

    // 권장 사항
    if (text.includes('권장') || text.includes('가급적')) {
      return 'MEDIUM';
    }

    return 'LOW';
  }

  /**
   * 검사 타입 결정
   * - regex_with_validation: Cast Operator 등 복잡한 패턴
   * - llm_contextual: JavaDoc, 의미론적 검사
   * - regex: 단순 패턴 매칭
   * - static_analysis: AST 분석 필요
   */
  determineCheckType(content, patterns) {
    const contentLower = content.toLowerCase();

    // Cast Operator는 커스텀 검증 필요
    if (content.includes('Cast') &&
      (content.includes('연산자') || content.includes('Operator'))) {
      return 'regex_with_validation';
    }

    // 문서화나 주석 관련은 LLM 맥락 검사
    if (contentLower.includes('javadoc') || contentLower.includes('주석')) {
      return 'llm_contextual';
    }

    // 의미론적 검사가 필요한 경우
    if (contentLower.includes('동사') || contentLower.includes('명사') ||
      contentLower.includes('의미') || contentLower.includes('ldata') ||
      contentLower.includes('db column')) {
      return 'llm_contextual';
    }

    // 정규식 패턴이 있는 경우
    if (patterns.length > 0) {
      return 'regex';
    }

    return 'static_analysis';
  }

  /**
   * 제목과 내용에서 검색용 키워드 추출
   * - 제목의 단어 분해
   * - 중요 기술 용어 추출
   */
  extractKeywords(title, content) {
    const keywords = new Set();

    // 제목 단어 추출
    title.split(/[\s,\/]+/).forEach(w => {
      if (w.length > 1) keywords.add(w);
    });

    // 중요 기술 용어 목록
    const importantWords = [
      'camelCase', 'PascalCase', 'JavaDoc', 'Exception',
      'import', 'package', 'class', 'method', 'interface',
      'LData', 'LMultiData', 'ResultSet', 'DB', 'column',
      '상수', '변수', '메소드', '클래스', '주석'
    ];

    // 내용에서 중요 용어 찾기
    for (const word of importantWords) {
      if (content.includes(word)) {
        keywords.add(word);
      }
    }

    return Array.from(keywords).slice(0, 10);
  }

  /**
   * 카테고리와 섹션 번호로 고유 규칙 ID 생성
   */
  generateRuleId(category, sectionNumber) {
    return `${category}.${sectionNumber.replace(/\./g, '_')}`;
  }

  /**
   * 추출된 가이드라인을 JSON 파일로 저장
   * - 메타데이터 포함 (추출 시간, 규칙 수, 버전 등)
   * - 통계 정보 출력 (카테고리별, 심각도별, 타입별 분포)
   */
  async saveToJSON(outputPath) {
    try {
      const outputDir = path.dirname(outputPath);
      await fs.mkdir(outputDir, { recursive: true });

      const outputData = {
        metadata: {
          extractedAt: new Date().toISOString(),
          totalRules: this.guidelines.length,
          version: '4.0.0-llm',
          extractor: 'llm-enhanced-parser',
          llmEnabled: !!this.llmService
        },
        guidelines: this.guidelines
      };

      await saveJsonData(outputData, outputPath, 'rule');

      logger.info(`\n저장 완료: ${outputPath}`);
      logger.info(`추출된 가이드라인: ${this.guidelines.length}개`);

      // 통계 정보 수집
      const stats = {
        category: {},
        severity: {},
        checkType: {}
      };

      this.guidelines.forEach(g => {
        stats.category[g.category] = (stats.category[g.category] || 0) + 1;
        stats.severity[g.severity] = (stats.severity[g.severity] || 0) + 1;
        stats.checkType[g.checkType] = (stats.checkType[g.checkType] || 0) + 1;
      });

      // 통계 출력
      logger.info('\n카테고리별 분포:');
      Object.entries(stats.category).forEach(([k, v]) =>
        logger.info(`  - ${k}: ${v}개`)
      );

      logger.info('\n심각도별 분포:');
      Object.entries(stats.severity).forEach(([k, v]) =>
        logger.info(`  - ${k}: ${v}개`)
      );

      logger.info('\n검사 타입별 분포:');
      Object.entries(stats.checkType).forEach(([k, v]) =>
        logger.info(`  - ${k}: ${v}개`)
      );

      return outputPath;
    } catch (error) {
      logger.error('저장 실패:', error.message);
      throw error;
    }
  }
}

/**
 * 메인 실행 함수
 * - CLI 인자 파싱
 * - GuidelineExtractor 초기화 및 실행
 */
async function main() {
  logger.info('LLM 강화 가이드라인 추출기 v4.0 시작\n');

  const args = process.argv.slice(2);

  if (args.length < 2) {
    logger.info('\n사용법: node guideline-extractor-llm.js <input.pdf|input.docx> <output.json>');
    logger.info('\n지원 형식:');
    logger.info('  - PDF: .pdf');
    logger.info('  - DOCX: .docx');
    logger.info('  - DOC: .doc → DOCX 변환 필요');
    return;
  }

  const [inputFile, outputJson] = args;

  logger.info(`입력 파일: ${inputFile}`);
  logger.info(`출력 파일: ${outputJson}\n`);

  try {
    const extractor = new GuidelineExtractor();
    await extractor.initialize();
    await extractor.extractFromDocument(inputFile);

    // 추출 결과 품질 확인
    if (extractor.guidelines.length < 10) {
      logger.info('\n⚠️ 경고: 추출된 규칙이 너무 적습니다. 텍스트 샘플을 확인하세요.');
      logger.info('extracted_text_debug.txt 파일을 검토해보세요.\n');
    }

    await extractor.saveToJSON(outputJson);
    logger.info('\n✅ 추출 완료!');

  } catch (error) {
    logger.error('\n실행 실패:', error.message);
    process.exit(1);
  }
}

// 직접 실행 시에만 main 함수 호출
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    logger.error('실행 중 오류:', error);
    process.exit(1);
  });
}