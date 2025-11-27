/**
 * 가이드라인 추출기 V4.0 (최종 완성본)
 * 
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * V3.2 대비 변경사항:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 🔄 완전 재설계: w:pStyle 기반 → w:bookmarkStart + 목차 매칭 기반
 * 
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 주요 특징:
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * 1️⃣ 목차 파싱 (parseTableOfContents)
 *    - w:hyperlink w:anchor="_Toc..." 기반
 *    - pStyle 값으로 Level 구분:
 *      • pStyle="12" → Level 1 (대분류: "1. 개요")
 *      • pStyle="21" → Level 2 (중분류: "1.1 작성 목적")
 *      • pStyle="31" → Level 3 (소분류: "1.1.1 상세 규칙")
 *    - anchor → title 매핑 저장
 * 
 * 2️⃣ 본문 추출 (extractSectionsByBookmarks)
 *    - w:bookmarkStart w:name으로 섹션 시작 감지
 *    - 목차 anchor와 매칭되는 것만 유효 섹션으로 인정
 *    - 섹션 시작 ~ 다음 섹션 시작 전까지 본문 수집
 *    - paragraph + table 통합 처리
 * 
 * 3️⃣ 테이블 처리 (extractTableData, convertTableToMarkdown)
 *    - 1×1 테이블: 텍스트박스로 취급 → 본문에 직접 삽입
 *    - m×n 테이블: Markdown 표 형식으로 변환
 *      • 최상단 행: 헤더 (| Header1 | Header2 |)
 *      • 구분선: (|---------|---------|)
 *      • 데이터 행: 나머지 행
 *    - 셀 병합 지원: gridSpan (가로), vMerge (세로)
 * 
 * 4️⃣ 이미지 처리 (extractImagesFromParagraph, analyzeImageWithLLM)
 *    - w:drawing → wp:inline/wp:anchor → a:blip r:embed 추출
 *    - _rels/document.xml.rels에서 실제 파일 경로 조회
 *    - word/media/image1.png 추출 → base64 인코딩
 *    - LLMService.analyzeImage() 호출 → OCR + 내용 요약
 * 
 * 5️⃣ Context Rules 식별 (identifyContextSection)
 *    - 키워드: '개요', 'Consensus', '대상', '용어', '아키텍처'
 *    - Level 기반 적용 범위:
 *      • L1 Context → appliesTo: "all" (문서 전체)
 *      • L2 Context → appliesTo: "section_X" (해당 L1 범위만)
 * 
 * 6️⃣ LLM 기반 구조화 (convertToGuideline)
 *    - 텍스트 + 테이블(Markdown) + 이미지(OCR) 통합
 *    - LLMService.generateGuidelineAnalysis() 호출
 *    - JSON 응답 파싱 → Guideline 객체 생성
 * 
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * 
 * @module GuidelineExtractor
 * @version 4.0
 * @author CodeQuality Team
 * @date 2025-01-26
 */

import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { parseStringPromise } from 'xml2js';
import { LLMService } from '../clients/llmService.js';
import { saveJsonData } from '../utils/fileUtils.js';
import logger from '../utils/loggerUtils.js';

export class GuidelineExtractor {
  constructor() {
    this.guidelines = [];
    this.contextRules = [];
    this.llmService = new LLMService();
    
    // 목차 정보 저장 (anchor → { level, title, pageNum })
    this.tableOfContents = new Map();
    
    // 이미지 관계 정보 (rId → target path)
    this.imageRelations = new Map();
    
    // ZIP 아카이브 (이미지 추출용)
    this.docxZip = null;
  }

  /**
   * 초기화: LLM 서비스 연결 확인
   */
  async initialize() {
    logger.info('🚀 가이드라인 추출기 V4.0 초기화 중...');
    
    const llmConnected = await this.llmService.checkConnection();
    if (!llmConnected) {
      logger.warn('⚠️ LLM 서비스 연결 실패 (계속 진행하지만 분석 품질 저하 가능)');
      return false;
    }
    
    logger.info('✅ LLM 서비스 연결 완료');
    return true;
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 메인 진입점: DOCX 문서 추출
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  async extractFromDocument(filePath) {
    try {
      logger.info(`📄 문서 파일 확인 중: ${filePath}`);
      await fs.access(filePath);
      logger.info('✅ 문서 파일 존재 확인됨');

      const ext = path.extname(filePath).toLowerCase();
      
      if (ext === '.docx') {
        return await this.extractFromDOCX(filePath);
      } else {
        throw new Error(`지원하지 않는 파일 형식: ${ext} (DOCX만 지원)`);
      }

    } catch (error) {
      logger.error('❌ 문서 처리 오류:', error.message);
      throw error;
    }
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * DOCX 파싱 (V4.0 - Bookmark 기반)
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  async extractFromDOCX(docxPath) {
    logger.info('📘 DOCX XML 직접 파싱 시작 (V4.0 - Bookmark + 목차 기반)...');
    
    try {
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 1: ZIP 로드 및 XML 파싱
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const buffer = await fs.readFile(docxPath);
      this.docxZip = await JSZip.loadAsync(buffer);
      
      const documentXml = await this.docxZip.file('word/document.xml').async('string');
      const doc = await parseStringPromise(documentXml);
      const body = doc['w:document']['w:body'][0];
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 2: 이미지 관계 로드 (word/_rels/document.xml.rels)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      await this.loadImageRelations();
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 3: 목차 파싱 (w:hyperlink w:anchor 기반)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      logger.info('\n📋 Step 1/3: 목차 파싱 중...');
      this.parseTableOfContents(body);
      logger.info(`✅ 목차 ${this.tableOfContents.size}개 항목 파싱 완료`);
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 4: Bookmark 기반 섹션 추출
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      logger.info('\n📑 Step 2/3: Bookmark 기반 섹션 추출 중...');
      const sections = await this.extractSectionsByBookmarks(body);
      logger.info(`✅ 총 ${sections.length}개 섹션 추출 완료`);
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 5: Context vs Guidelines 분류
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      const contextSections = sections.filter(s => s.isContext);
      const guidelineSections = sections.filter(s => !s.isContext);
      
      logger.info(`  📋 Context Rules: ${contextSections.length}개`);
      logger.info(`  📜 Guidelines: ${guidelineSections.length}개`);
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 6: Context Rules 처리
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      this.contextRules = contextSections.map(ctx => {
        // 본문 추출 (텍스트만)
        const content = this.extractSectionTextOnly(ctx);
        
        return {
          ruleId: `ctx.${ctx.contextType}`,
          title: ctx.title,
          sectionNumber: ctx.sectionNumber,
          level: ctx.level,
          content,
          appliesTo: ctx.appliesTo,
          contextType: ctx.contextType
        };
      });
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 7: Guideline 처리 (LLM 배치 분석)
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      logger.info('\n📦 Step 3/3: LLM 기반 Guideline 구조화 중...');
      this.guidelines = [];
      const batchSize = 5;
      
      for (let i = 0; i < guidelineSections.length; i += batchSize) {
        const batch = guidelineSections.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(guidelineSections.length / batchSize);
        
        logger.info(`  📦 배치 ${batchNum}/${totalBatches} 처리 중 (${batch.length}개 규칙)...`);
        
        await Promise.all(
          batch.map(section => this.convertToGuideline(section))
        );
      }
      
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      // Step 8: 섹션 번호 정렬
      // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      this.sortGuidelines();
      
      logger.info(`\n✅ 총 ${this.contextRules.length}개 Context + ${this.guidelines.length}개 Guideline 추출 완료`);
      
      return {
        contextRules: this.contextRules,
        guidelines: this.guidelines
      };
      
    } catch (error) {
      logger.error(`❌ DOCX 파싱 실패: ${error.message}`);
      logger.error(`스택 트레이스:`, error.stack);
      throw error;
    }
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 이미지 관계 정보 로드
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 
   * word/_rels/document.xml.rels 파일에서:
   * - rId → 이미지 파일 경로 매핑 정보 추출
   * - 예: rId18 → media/image1.png
   */
  async loadImageRelations() {
    try {
      const relsXml = await this.docxZip.file('word/_rels/document.xml.rels').async('string');
      const rels = await parseStringPromise(relsXml);
      
      const relationships = rels['Relationships']['Relationship'];
      for (const rel of relationships) {
        const id = rel.$['Id'];
        const target = rel.$['Target'];
        const type = rel.$['Type'];
        
        // 이미지 관계만 저장
        if (type && type.includes('image')) {
          this.imageRelations.set(id, target);
        }
      }
      
      logger.info(`✅ 이미지 관계 ${this.imageRelations.size}개 로드 완료`);
    } catch (error) {
      logger.warn('⚠️ 이미지 관계 파일 없음 (이미지 없는 문서일 수 있음)');
    }
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 목차 파싱
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 
   * 목차 구조:
   * <w:p>
   *   <w:pPr>
   *     <w:pStyle w:val="12"/>  ← Level 1
   *   </w:pPr>
   *   <w:hyperlink w:anchor="_Toc361925470">
   *     <w:r><w:t>1. 개요</w:t></w:r>
   *   </w:hyperlink>
   * </w:p>
   * 
   * pStyle 매핑:
   * - "12" → Level 1 (대분류: 1, 2, 3, ...)
   * - "21" → Level 2 (중분류: 1.1, 1.2, 2.1, ...)
   * - "31" → Level 3 (소분류: 1.1.1, 1.1.2, ...)
   * - "41" → Level 4 (세부: 1.1.1.1, ...)
   */
  parseTableOfContents(body) {
    let tocStarted = false;
    let tocEnded = false;
    
    for (const [elementType, elements] of Object.entries(body)) {
      if (!Array.isArray(elements) || tocEnded) continue;
      
      if (elementType !== 'w:p') continue;
      
      for (const element of elements) {
        // w:hyperlink 확인
        const hyperlinks = element['w:hyperlink'];
        if (!hyperlinks) {
          // bookmark 발견 시 목차 종료
          if (tocStarted) {
            const bookmarkStarts = this.findBookmarkStarts(element);
            if (bookmarkStarts.length > 0) {
              tocEnded = true;
              break;
            }
          }
          continue;
        }
        
        for (const hyperlink of hyperlinks) {
          const anchor = hyperlink.$?.['w:anchor'];
          if (!anchor) continue;
          
          // 목차 시작 감지 (_Toc로 시작하는 anchor)
          if (anchor.startsWith('_Toc')) {
            tocStarted = true;
          }
          
          if (!tocStarted) continue;
          
          // pStyle 확인
          const pPr = element['w:pPr']?.[0];
          const pStyle = pPr?.['w:pStyle']?.[0]?.$?.['w:val'];
          
          // Level 판단
          let level = null;
          if (pStyle === '12') level = 1;
          else if (pStyle === '21') level = 2;
          else if (pStyle === '31') level = 3;
          else if (pStyle === '41') level = 4;
          
          if (level === null) continue;
          
          // 제목 텍스트 추출
          const title = this.extractHyperlinkText(hyperlink);
          
          // 페이지 번호 추출
          const pageNum = this.extractPageNumber(hyperlink);
          
          this.tableOfContents.set(anchor, {
            level,
            title: title.trim(),
            pageNum,
            anchor
          });
          
          logger.debug(`  [L${level}] ${anchor} → "${title}"`);
        }
      }
    }
  }

  /**
   * Hyperlink 내부 텍스트 추출
   */
  extractHyperlinkText(hyperlink) {
    const texts = [];
    const runs = hyperlink['w:r'] || [];
    
    for (const run of runs) {
      const tElements = run['w:t'];
      if (!tElements) continue;
      
      for (const t of tElements) {
        if (typeof t === 'string') {
          texts.push(t);
        } else if (t && t._) {
          texts.push(t._);
        }
      }
    }
    
    return texts.join('');
  }

  /**
   * 페이지 번호 추출 (PAGEREF 필드)
   */
  extractPageNumber(hyperlink) {
    const runs = hyperlink['w:r'] || [];
    
    for (const run of runs) {
      const tElements = run['w:t'];
      if (!tElements) continue;
      
      for (const t of tElements) {
        const text = typeof t === 'string' ? t : t._;
        if (text && /^\d+$/.test(text.trim())) {
          return parseInt(text.trim(), 10);
        }
      }
    }
    
    return null;
  }

  /**
   * Paragraph에서 bookmarkStart 찾기
   */
  findBookmarkStarts(paragraph) {
    const bookmarks = [];
    
    for (const [key, value] of Object.entries(paragraph)) {
      if (key === 'w:bookmarkStart' && Array.isArray(value)) {
        bookmarks.push(...value);
      }
    }
    
    return bookmarks;
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * Bookmark 기반 섹션 추출
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 
   * 처리 로직:
   * 1. body의 모든 요소(paragraph + table) 순회
   * 2. w:bookmarkStart w:name 발견 시:
   *    - 목차 anchor와 매칭 확인
   *    - 매칭되면 새 섹션 시작
   * 3. 다음 bookmarkStart까지 모든 요소를 현재 섹션에 추가
   * 4. paragraph와 table을 구분하여 저장
   */
  async extractSectionsByBookmarks(body) {
    const sections = [];
    let currentSection = null;
    let skipUntilTocEnd = true;
    
    // body의 모든 paragraph와 table을 순서대로 순회
    const orderedElements = this.getOrderedBodyElements(body);
    
    for (const { type, element } of orderedElements) {
      if (type === 'w:p') {
        const para = element;
        
        // bookmarkStart 확인
        const bookmarkStarts = this.findBookmarkStarts(para);
        
        for (const bookmark of bookmarkStarts) {
          const bookmarkName = bookmark.$?.['w:name'];
          if (!bookmarkName) continue;
          
          // 목차와 매칭되는지 확인
          const tocEntry = this.tableOfContents.get(bookmarkName);
          if (tocEntry) {
            skipUntilTocEnd = false;
            
            // 이전 섹션 저장
            if (currentSection && this.isValidSection(currentSection)) {
              sections.push(currentSection);
              logger.debug(`  ✔ ${currentSection.sectionNumber} ${currentSection.title} (${currentSection.contentElements.length}개 요소)`);
            }
            
            // 새 섹션 시작
            currentSection = {
              level: tocEntry.level,
              sectionNumber: this.inferSectionNumber(tocEntry.title),
              title: tocEntry.title,
              anchor: bookmarkName,
              contentElements: [],
              isContext: false,
              contextType: null,
              appliesTo: null
            };
            
            // Context 여부 판단
            const contextInfo = this.identifyContextSection(currentSection);
            if (contextInfo) {
              currentSection.isContext = true;
              currentSection.contextType = contextInfo.contextType;
              currentSection.appliesTo = contextInfo.appliesTo;
            }
          }
        }
        
        // 목차 이전이면 건너뛰기
        if (skipUntilTocEnd) continue;
        
        // 현재 섹션에 본문 추가 (bookmarkStart가 없는 paragraph만)
        if (currentSection && bookmarkStarts.length === 0) {
          currentSection.contentElements.push({ type: 'paragraph', element: para });
        }
      }
      
      else if (type === 'w:tbl') {
        // 목차 이전이면 건너뛰기
        if (skipUntilTocEnd) continue;
        
        // 현재 섹션에 테이블 추가
        if (currentSection) {
          currentSection.contentElements.push({ type: 'table', element });
        }
      }
    }
    
    // 마지막 섹션 저장
    if (currentSection && this.isValidSection(currentSection)) {
      sections.push(currentSection);
      logger.debug(`  ✔ ${currentSection.sectionNumber} ${currentSection.title} (${currentSection.contentElements.length}개 요소)`);
    }
    
    return sections;
  }

  /**
   * body에서 paragraph와 table을 순서대로 추출
   */
  getOrderedBodyElements(body) {
    const elements = [];
    
    // w:p와 w:tbl을 순서대로 수집
    // xml2js는 순서를 보장하지 않을 수 있으므로, 직접 순회
    for (const [key, value] of Object.entries(body)) {
      if (key === 'w:p' || key === 'w:tbl') {
        if (Array.isArray(value)) {
          for (const element of value) {
            elements.push({ type: key, element });
          }
        }
      }
    }
    
    return elements;
  }

  /**
   * 섹션 번호 추론 (제목 텍스트에서 추출)
   * 예: "15.14 쿼리XML 사용 가이드" → "15.14"
   */
  inferSectionNumber(title) {
    const match = title.match(/^([\d.]+)\s+/);
    return match ? match[1] : '0';
  }

  /**
   * Context Section 식별
   * 
   * 규칙:
   * - 키워드: '개요', 'Consensus', '대상', '용어', '아키텍처'
   * - L1 Context → appliesTo: "all"
   * - L2 Context → appliesTo: "section_X" (해당 L1 범위)
   */
  identifyContextSection(section) {
    const keywords = ['개요', 'Consensus', '대상', '용어', '아키텍처'];
    const lowerTitle = section.title.toLowerCase();
    
    const hasKeyword = keywords.some(kw => lowerTitle.includes(kw.toLowerCase()));
    if (!hasKeyword) return null;
    
    // Context 타입 판단
    let contextType = 'general';
    if (lowerTitle.includes('개요')) contextType = 'overview';
    else if (lowerTitle.includes('consensus')) contextType = 'consensus';
    else if (lowerTitle.includes('대상')) contextType = 'scope';
    else if (lowerTitle.includes('용어')) contextType = 'terminology';
    else if (lowerTitle.includes('아키텍처')) contextType = 'architecture';
    
    // appliesTo 판단
    let appliesTo = 'all';
    if (section.level === 2) {
      const l1Number = section.sectionNumber.split('.')[0];
      appliesTo = `section_${l1Number}`;
    }
    
    return { contextType, appliesTo };
  }

  /**
   * 유효 섹션 검증
   */
  isValidSection(section) {
    // Context는 항상 유효
    if (section.isContext) return true;
    
    // 본문이 없으면 무효
    if (section.contentElements.length === 0) return false;
    
    return true;
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 섹션 본문 추출 (텍스트만, Context용)
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  extractSectionTextOnly(section) {
    const textLines = [];
    
    for (const item of section.contentElements) {
      if (item.type === 'paragraph') {
        const text = this.extractTextFromParagraph(item.element);
        if (text) {
          textLines.push(text);
        }
      }
    }
    
    return textLines.join('\n');
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * Guideline 변환 (LLM 기반 구조화)
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  async convertToGuideline(section) {
    try {
      // 1. 본문 추출 (텍스트 + 테이블 + 이미지)
      const content = await this.extractSectionContent(section);
      
      // 2. LLM 프롬프트 생성
      const ruleText = `${section.sectionNumber} ${section.title}\n\n${content.text}`;
      const prompt = this.createGuidelineAnalysisPrompt(ruleText, section);
      
      // 3. LLM 분석
      const response = await this.llmService.generateGuidelineAnalysis(prompt);
      
      if (!response || !response.enhancedGuideline) {
        logger.warn(`  ⚠️ LLM 분석 실패: ${section.sectionNumber} (폴백 사용)`);
        
        // 폴백: 최소한의 정보로 Guideline 생성
        const guideline = this.createFallbackGuideline(section, content, ruleText);
        this.guidelines.push(guideline);
        return;
      }
      
      const analysis = response.enhancedGuideline;
      
      // 4. Guideline 객체 생성
      const guideline = {
        ruleId: `${this.inferCategory(section.title, ruleText)}.${section.sectionNumber.replace(/\./g, '_')}`,
        sectionNumber: section.sectionNumber,
        title: section.title,
        level: section.level,
        category: this.inferCategory(section.title, ruleText),
        severity: this.inferSeverity(section.title, ruleText),
        description: analysis.enhancedDescription || ruleText,
        checkType: analysis.checkType || 'static_analysis',
        patterns: analysis.patterns || [],
        examples: analysis.examples || { good: [], bad: [] },
        businessRules: analysis.businessRules || [],
        astHints: analysis.astHints || {},
        contextDependencies: this.contextRules.map(c => c.ruleId),
        
        // 추가 컨텐츠 정보
        hasTables: content.tables.length > 0,
        hasImages: content.images.length > 0,
        tables: content.tables,
        images: content.images.map(img => ({
          name: img.name,
          description: img.ocrText || '[OCR 분석 필요]'
        }))
      };
      
      this.guidelines.push(guideline);
      logger.debug(`  ✔ ${section.sectionNumber} ${section.title}`);
      
    } catch (error) {
      logger.error(`  ❌ 변환 실패: ${section.sectionNumber} - ${error.message}`);
    }
  }

  /**
   * 폴백 Guideline 생성 (LLM 실패 시)
   */
  createFallbackGuideline(section, content, ruleText) {
    return {
      ruleId: `general.${section.sectionNumber.replace(/\./g, '_')}`,
      sectionNumber: section.sectionNumber,
      title: section.title,
      level: section.level,
      category: 'general',
      severity: 'MEDIUM',
      description: ruleText.substring(0, 500),
      checkType: 'static_analysis',
      patterns: [],
      examples: { good: [], bad: [] },
      businessRules: [],
      astHints: {},
      contextDependencies: this.contextRules.map(c => c.ruleId),
      hasTables: content.tables.length > 0,
      hasImages: content.images.length > 0,
      tables: content.tables,
      images: content.images.map(img => ({
        name: img.name,
        description: '[LLM 분석 실패로 OCR 불가]'
      }))
    };
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 섹션 본문 추출 (텍스트 + 테이블 + 이미지 통합)
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  async extractSectionContent(section) {
    const content = {
      text: '',
      tables: [],
      images: []
    };
    
    const textLines = [];
    
    for (const item of section.contentElements) {
      if (item.type === 'paragraph') {
        // 텍스트 추출
        const text = this.extractTextFromParagraph(item.element);
        if (text) {
          textLines.push(text);
        }
        
        // 이미지 추출
        const images = await this.extractImagesFromParagraph(item.element);
        content.images.push(...images);
      }
      
      else if (item.type === 'table') {
        // 테이블 추출
        const table = this.extractTableData(item.element);
        content.tables.push(table);
        
        if (table.type === 'textbox') {
          // 1×1 텍스트박스는 본문에 직접 삽입
          textLines.push(`\n[텍스트박스] ${table.content}\n`);
        } else {
          // m×n 테이블은 Markdown 표로 삽입
          textLines.push('\n' + table.markdown + '\n');
        }
      }
    }
    
    content.text = textLines.join('\n');
    
    return content;
  }

  /**
   * Paragraph에서 텍스트 추출
   */
  extractTextFromParagraph(para) {
    const runs = para['w:r'] || [];
    const texts = [];
    
    for (const run of runs) {
      const tElements = run['w:t'];
      if (!tElements) continue;
      
      for (const t of tElements) {
        if (typeof t === 'string') {
          texts.push(t);
        } else if (t && t._) {
          texts.push(t._);
        }
      }
    }
    
    return texts.join('').trim();
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 테이블 데이터 추출 및 Markdown 변환
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 
   * 테이블 타입:
   * 1. 1×1 테이블 → 텍스트박스로 취급
   * 2. m×n 테이블 → Markdown 표 형식
   */
  extractTableData(tableElement) {
    const rows = tableElement['w:tr'] || [];
    
    if (rows.length === 0) {
      return { type: 'empty', content: '', markdown: '' };
    }
    
    // 행/열 데이터 추출
    const tableData = [];
    
    for (const row of rows) {
      const cells = row['w:tc'] || [];
      const rowData = [];
      
      for (const cell of cells) {
        // 셀 내부의 모든 paragraph 텍스트 결합
        const cellParas = cell['w:p'] || [];
        const cellTexts = [];
        
        for (const para of cellParas) {
          const text = this.extractTextFromParagraph(para);
          if (text) {
            cellTexts.push(text);
          }
        }
        
        // 셀 병합 정보 추출
        const tcPr = cell['w:tcPr']?.[0];
        const gridSpan = tcPr?.['w:gridSpan']?.[0]?.$?.['w:val'];
        const vMerge = tcPr?.['w:vMerge']?.[0]?.$?.['w:val'];
        
        rowData.push({
          text: cellTexts.join('\n'),
          gridSpan: gridSpan ? parseInt(gridSpan, 10) : 1,
          vMerge: vMerge || null
        });
      }
      
      tableData.push(rowData);
    }
    
    // 1×1 텍스트박스 판단
    if (tableData.length === 1 && tableData[0].length === 1) {
      return {
        type: 'textbox',
        content: tableData[0][0].text,
        markdown: ''
      };
    }
    
    // m×n 일반 테이블 → Markdown 변환
    const markdown = this.convertTableToMarkdown(tableData);
    
    return {
      type: 'table',
      rows: tableData.length,
      cols: tableData[0]?.length || 0,
      content: '',
      markdown
    };
  }

  /**
   * 테이블 데이터를 Markdown 표 형식으로 변환
   * 
   * 규칙:
   * - 최상단 행: 헤더 (| Header1 | Header2 |)
   * - 구분선: (|---------|---------|)
   * - 나머지 행: 데이터 행
   * - vMerge 'continue': 빈 셀로 처리
   */
  convertTableToMarkdown(tableData) {
    if (tableData.length === 0) return '';
    
    const lines = [];
    
    // 헤더 행
    const headerRow = tableData[0];
    const headerCells = headerRow.map(cell => cell.text || '');
    lines.push('| ' + headerCells.join(' | ') + ' |');
    
    // 구분선
    const separator = headerCells.map(() => '---').join(' | ');
    lines.push('| ' + separator + ' |');
    
    // 데이터 행
    for (let i = 1; i < tableData.length; i++) {
      const row = tableData[i];
      const cells = row.map(cell => {
        // vMerge 'continue'면 빈 셀
        if (cell.vMerge === 'continue') {
          return '';
        }
        return cell.text || '';
      });
      lines.push('| ' + cells.join(' | ') + ' |');
    }
    
    return lines.join('\n');
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 이미지 추출 및 OCR
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  async extractImagesFromParagraph(para) {
    const images = [];
    const drawings = para['w:drawing'] || [];
    
    for (const drawing of drawings) {
      try {
        // wp:inline 또는 wp:anchor
        const inline = drawing['wp:inline']?.[0];
        const anchor = drawing['wp:anchor']?.[0];
        const wp = inline || anchor;
        
        if (!wp) continue;
        
        // 이미지 이름
        const docPr = wp['wp:docPr']?.[0];
        const imageName = docPr?.$?.name || 'Unknown';
        
        // r:embed 추출
        const graphic = wp['a:graphic']?.[0];
        const graphicData = graphic?.['a:graphicData']?.[0];
        const pic = graphicData?.['pic:pic']?.[0];
        const blipFill = pic?.['pic:blipFill']?.[0];
        const blip = blipFill?.['a:blip']?.[0];
        const rEmbed = blip?.$?.['r:embed'];
        
        if (!rEmbed) continue;
        
        // 이미지 파일 경로 찾기
        const imagePath = this.imageRelations.get(rEmbed);
        if (!imagePath) {
          logger.warn(`  ⚠️ 이미지 관계 없음: ${rEmbed}`);
          continue;
        }
        
        // 이미지 파일 추출
        const imageFile = this.docxZip.file(`word/${imagePath}`);
        if (!imageFile) {
          logger.warn(`  ⚠️ 이미지 파일 없음: word/${imagePath}`);
          continue;
        }
        
        const imageBuffer = await imageFile.async('nodebuffer');
        const base64Image = imageBuffer.toString('base64');
        
        // 이미지 타입 추론
        const ext = path.extname(imagePath).toLowerCase();
        let mimeType = 'image/png';
        if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
        else if (ext === '.gif') mimeType = 'image/gif';
        else if (ext === '.webp') mimeType = 'image/webp';
        
        // LLM OCR 시도
        let ocrText = null;
        try {
          const prompt = `다음 이미지는 개발 가이드 문서에 포함된 이미지입니다. 
이미지의 내용을 분석하여 다음 정보를 추출해주세요:
1. 이미지 타입 (다이어그램, 표, 코드 스크린샷, 플로우차트 등)
2. 주요 내용 요약 (텍스트가 있다면 OCR 포함)
3. 개발 가이드와의 관련성

간결하게 3-5문장으로 요약해주세요.`;
          
          ocrText = await this.llmService.analyzeImage(base64Image, mimeType, prompt);
        } catch (error) {
          logger.warn(`  ⚠️ 이미지 OCR 실패: ${imageName} - ${error.message}`);
        }
        
        images.push({
          name: imageName,
          path: imagePath,
          base64: base64Image,
          mimeType,
          ocrText
        });
        
        logger.debug(`  📷 이미지 추출: ${imageName}`);
        
      } catch (error) {
        logger.warn(`  ⚠️ 이미지 추출 오류: ${error.message}`);
      }
    }
    
    return images;
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * LLM 프롬프트 생성
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  createGuidelineAnalysisPrompt(ruleText, section) {
    return `다음은 Java 코딩 가이드라인 규칙입니다. 이를 분석하여 구조화된 정보로 변환해주세요.

규칙 섹션: ${section.sectionNumber}
규칙 제목: ${section.title}
규칙 Level: ${section.level}

규칙 내용:
${ruleText}

다음 형식의 JSON으로 응답해주세요:
{
  "checkType": "static_analysis | regex | regex_with_validation | llm_contextual",
  "enhancedDescription": "규칙에 대한 명확한 설명",
  "businessRules": ["비즈니스 규칙 1", "비즈니스 규칙 2"],
  "patterns": [
    {
      "type": "positive | negative",
      "pattern": "정규식 또는 AST 패턴",
      "description": "패턴 설명"
    }
  ],
  "astHints": {
    "nodeType": "MethodDeclaration | VariableDeclaration 등",
    "checkPoints": ["체크 포인트 1", "체크 포인트 2"]
  },
  "examples": {
    "good": ["좋은 예시 코드"],
    "bad": ["나쁜 예시 코드"]
  },
  "contextualChecks": ["컨텍스트 체크 사항"]
}

JSON만 출력하고 다른 설명은 포함하지 마세요.`;
  }

  /**
   * 카테고리 추론
   */
  inferCategory(title, content) {
    const lowerTitle = title.toLowerCase();
    const lowerContent = content.toLowerCase();
    
    if (lowerTitle.includes('명명') || lowerTitle.includes('이름')) {
      return 'naming_convention';
    }
    
    if (lowerTitle.includes('주석') || lowerContent.includes('javadoc')) {
      return 'documentation';
    }
    
    if (lowerTitle.includes('들여쓰기') || lowerTitle.includes('공백')) {
      return 'code_style';
    }
    
    if (lowerContent.includes('exception') || lowerContent.includes('try')) {
      return 'error_handling';
    }
    
    return 'general';
  }

  /**
   * 심각도 추론
   */
  inferSeverity(title, content) {
    const lowerContent = content.toLowerCase();
    
    if (lowerContent.includes('필수') || lowerContent.includes('반드시')) {
      return 'HIGH';
    }
    
    if (lowerContent.includes('권장') || lowerContent.includes('가급적')) {
      return 'MEDIUM';
    }
    
    return 'LOW';
  }

  /**
   * 섹션 번호 정렬
   */
  sortGuidelines() {
    logger.info('\n🔢 섹션 번호 정렬 중...');
    
    this.guidelines.sort((a, b) => {
      const parseSection = (s) => s.split('.').map(Number);
      const aParts = parseSection(a.sectionNumber);
      const bParts = parseSection(b.sectionNumber);
      
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        const aVal = aParts[i] || 0;
        const bVal = bParts[i] || 0;
        if (aVal !== bVal) return aVal - bVal;
      }
      return 0;
    });
    
    logger.info('✅ 정렬 완료');
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * JSON 저장
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  async saveToJSON(outputPath) {
    const output = {
      metadata: {
        totalRules: this.guidelines.length,
        totalContextRules: this.contextRules.length,
        extractedAt: new Date().toISOString(),
        version: '4.0',
        documentContext: {
          contextRuleIds: this.contextRules.map(c => c.ruleId)
        }
      },
      contextRules: this.contextRules,
      guidelines: this.guidelines
    };
    
    const fileName = path.basename(outputPath);
    await saveJsonData(output, fileName, 'rule');
    
    logger.info(`\n💾 저장 완료: ${outputPath}`);
    logger.info(`📋 Context Rules: ${this.contextRules.length}개`);
    logger.info(`📜 Guidelines: ${this.guidelines.length}개`);
    
    this.printStatistics();
  }

  /**
   * 통계 출력
   */
  printStatistics() {
    logger.info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('📊 추출 통계');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    logger.info('\n📋 Context Rules:');
    for (const ctx of this.contextRules) {
      logger.info(`  - ${ctx.ruleId}: ${ctx.title}`);
      logger.info(`    섹션: ${ctx.sectionNumber} (Level ${ctx.level})`);
      logger.info(`    타입: ${ctx.contextType}`);
      logger.info(`    적용 범위: ${ctx.appliesTo}`);
    }
    
    const categoryDist = {};
    const severityDist = {};
    let tablesCount = 0;
    let imagesCount = 0;
    
    for (const g of this.guidelines) {
      categoryDist[g.category] = (categoryDist[g.category] || 0) + 1;
      severityDist[g.severity] = (severityDist[g.severity] || 0) + 1;
      if (g.hasTables) tablesCount++;
      if (g.hasImages) imagesCount++;
    }
    
    logger.info('\n📂 카테고리별 분포:');
    for (const [cat, count] of Object.entries(categoryDist)) {
      logger.info(`  - ${cat}: ${count}개`);
    }
    
    logger.info('\n⚠️ 심각도별 분포:');
    for (const [sev, count] of Object.entries(severityDist)) {
      logger.info(`  - ${sev}: ${count}개`);
    }
    
    logger.info('\n📊 컨텐츠 통계:');
    logger.info(`  - 테이블 포함: ${tablesCount}개`);
    logger.info(`  - 이미지 포함: ${imagesCount}개`);
    
    logger.info('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 하위 호환성 메서드
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  async extractFromPDF(pdfPath) {
    logger.warn('⚠️ extractFromPDF()는 deprecated입니다.');
    logger.warn('   extractFromDocument()를 사용하세요.');
    return await this.extractFromDocument(pdfPath);
  }
}