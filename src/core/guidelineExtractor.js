/**
 * 가이드라인 추출기 V4.1 (순서 문제 해결)
 * 
 * V4.0 대비 변경사항:
 * 🔧 parseStringPromise 옵션 추가 (순서 보장)
 * 🔧 getOrderedBodyElements() 재작성 (body.$$ 사용)
 * 🔧 테이블/paragraph 파싱 시 $$ 구조 대응
 * 
 * @version 4.1
 */

import fs from 'fs/promises';
import path from 'path';
import JSZip from 'jszip';
import { parseStringPromise } from 'xml2js';
import { LLMService } from '../clients/llmService.js';
import { saveJsonData } from '../utils/fileUtils.js';
import logger from '../utils/loggerUtils.js';
import { AstHintsConverter } from '../converters/astHintsConverter.js';

export class GuidelineExtractor {
  constructor() {
    this.guidelines = [];
    this.contextRules = [];
    this.llmService = new LLMService();
    this.tableOfContents = new Map();
    this.imageRelations = new Map();
    this.astHintsConverter = new AstHintsConverter();
    this.docxZip = null;
  }

  async initialize() {
    logger.info('🚀 가이드라인 추출기 V4.1 초기화 중...');

    const llmConnected = await this.llmService.checkConnection();
    if (!llmConnected) {
      logger.warn('⚠️ LLM 서비스 연결 실패');
      return false;
    }

    logger.info('✅ LLM 서비스 연결 완료');
    return true;
  }

  async extractFromDocument(filePath) {
    try {
      logger.info(`📄 문서 파일 확인 중: ${filePath}`);
      await fs.access(filePath);

      const ext = path.extname(filePath).toLowerCase();

      if (ext === '.docx') {
        return await this.extractFromDOCX(filePath);
      } else {
        throw new Error(`지원하지 않는 파일 형식: ${ext}`);
      }

    } catch (error) {
      logger.error('❌ 문서 처리 오류:', error.message);
      throw error;
    }
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * DOCX 파싱 (V4.1 - 순서 보장)
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  async extractFromDOCX(docxPath) {
    logger.info('📘 DOCX 파싱 시작 (V4.1 - 순서 보장)...');

    try {
      // Step 1: ZIP 로드
      const buffer = await fs.readFile(docxPath);
      this.docxZip = await JSZip.loadAsync(buffer);

      const documentXml = await this.docxZip.file('word/document.xml').async('string');

      // ═══════════════════════════════════════════════════════════════════
      // 🔧 V4.1 핵심 변경: 순서 보장 옵션 추가
      // ═══════════════════════════════════════════════════════════════════
      const doc = await parseStringPromise(documentXml, {
        preserveChildrenOrder: true,
        explicitChildren: true,
        charsAsChildren: false
      });

      const body = doc['w:document']['w:body'][0];

      // Step 2: 이미지 관계 로드
      await this.loadImageRelations();

      // Step 3: 목차 파싱
      logger.info('\n📋 Step 1/3: 목차 파싱 중...');
      this.parseTableOfContents(body);
      logger.info(`✅ 목차 ${this.tableOfContents.size}개 항목 파싱 완료`);

      // Step 4: Bookmark 기반 섹션 추출 (순서 보장)
      logger.info('\n📑 Step 2/3: Bookmark 기반 섹션 추출 중...');
      const sections = await this.extractSectionsByBookmarks(body);
      logger.info(`✅ 총 ${sections.length}개 섹션 추출 완료`);

      // 테이블 통계
      const sectionsWithTables = sections.filter(s =>
        s.contentElements.some(e => e.type === 'table')
      );
      const totalTables = sections.reduce((sum, s) =>
        sum + s.contentElements.filter(e => e.type === 'table').length, 0
      );
      logger.info(`📊 테이블이 있는 섹션: ${sectionsWithTables.length}개, 총 테이블: ${totalTables}개`);

      // Step 5: Context vs Guidelines 분류
      const contextSections = sections.filter(s => s.isContext);
      const guidelineSections = sections.filter(s => !s.isContext);

      logger.info(`  📋 Context Rules: ${contextSections.length}개`);
      logger.info(`  📜 Guidelines: ${guidelineSections.length}개`);

      // Step 6: Context Rules 처리
      this.contextRules = contextSections.map(ctx => ({
        ruleId: `ctx.${ctx.contextType}`,
        title: ctx.title,
        sectionNumber: ctx.sectionNumber,
        level: ctx.level,
        content: this.extractSectionTextOnly(ctx),
        appliesTo: ctx.appliesTo,
        contextType: ctx.contextType
      }));

      // Step 7: Guideline 처리
      logger.info('\n📦 Step 3/3: Guideline 구조화 중...');
      this.guidelines = [];
      const batchSize = 5;

      for (let i = 0; i < guidelineSections.length; i += batchSize) {
        const batch = guidelineSections.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(guidelineSections.length / batchSize);

        logger.info(`  📦 배치 ${batchNum}/${totalBatches} 처리 중...`);

        await Promise.all(batch.map(section => this.convertToGuideline(section)));
      }

      this.sortGuidelines();

      logger.info(`\n✅ 총 ${this.contextRules.length}개 Context + ${this.guidelines.length}개 Guideline 추출 완료`);

      return {
        contextRules: this.contextRules,
        guidelines: this.guidelines
      };

    } catch (error) {
      logger.error(`❌ DOCX 파싱 실패: ${error.message}`);
      throw error;
    }
  }

  async loadImageRelations() {
    try {
      const relsXml = await this.docxZip.file('word/_rels/document.xml.rels').async('string');
      const rels = await parseStringPromise(relsXml);

      const relationships = rels['Relationships']['Relationship'];
      for (const rel of relationships) {
        const id = rel.$['Id'];
        const target = rel.$['Target'];
        const type = rel.$['Type'];

        if (type && type.includes('image')) {
          this.imageRelations.set(id, target);
        }
      }

      logger.info(`✅ 이미지 관계 ${this.imageRelations.size}개 로드 완료`);
    } catch (error) {
      logger.warn('⚠️ 이미지 관계 파일 없음');
    }
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 목차 파싱 (V4.1 - $$ 구조 대응)
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  parseTableOfContents(body) {
    let tocStarted = false;
    let tocEnded = false;

    // 🔧 V4.1: body.$$ 사용하여 순서대로 순회
    const children = body.$$ || [];

    for (const child of children) {
      if (tocEnded) break;

      const tagName = child['#name'];
      if (tagName !== 'w:p') continue;

      // $$ 구조에서 hyperlink 찾기
      const hyperlinks = this.findChildrenByName(child, 'w:hyperlink');

      if (hyperlinks.length === 0) {
        if (tocStarted) {
          const bookmarks = this.findBookmarkStarts(child);
          if (bookmarks.length > 0) {
            tocEnded = true;
            break;
          }
        }
        continue;
      }

      for (const hyperlink of hyperlinks) {
        const anchor = hyperlink.$?.['w:anchor'];
        if (!anchor) continue;

        if (anchor.startsWith('_Toc')) {
          tocStarted = true;
        }

        if (!tocStarted) continue;

        // pStyle 확인 ($$ 구조)
        const pPr = this.findChildByName(child, 'w:pPr');
        const pStyleNode = pPr ? this.findChildByName(pPr, 'w:pStyle') : null;
        const pStyle = pStyleNode?.$?.['w:val'];

        let level = null;
        if (pStyle === '12') level = 1;
        else if (pStyle === '21') level = 2;
        else if (pStyle === '31') level = 3;
        else if (pStyle === '41') level = 4;

        if (level === null) continue;

        const title = this.extractTextFromElement(hyperlink);

        this.tableOfContents.set(anchor, {
          level,
          title: title.trim(),
          anchor
        });
      }
    }
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * Bookmark 기반 섹션 추출 (V4.1 - 순서 보장)
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  async extractSectionsByBookmarks(body) {
    const sections = [];
    let currentSection = null;
    let skipUntilTocEnd = true;

    // 🔧 V4.1 핵심: body.$$ 사용하여 원본 순서 유지
    const orderedElements = this.getOrderedBodyElements(body);

    logger.info(`📋 순서 보장 요소: ${orderedElements.length}개`);

    for (const { type, element } of orderedElements) {
      if (type === 'w:p') {
        const bookmarkStarts = this.findBookmarkStarts(element);

        for (const bookmark of bookmarkStarts) {
          const bookmarkName = bookmark.$?.['w:name'];
          if (!bookmarkName) continue;

          const tocEntry = this.tableOfContents.get(bookmarkName);
          if (tocEntry) {
            skipUntilTocEnd = false;

            // 이전 섹션 저장
            if (currentSection && this.isValidSection(currentSection)) {
              sections.push(currentSection);
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

            const contextInfo = this.identifyContextSection(currentSection);
            if (contextInfo) {
              currentSection.isContext = true;
              currentSection.contextType = contextInfo.contextType;
              currentSection.appliesTo = contextInfo.appliesTo;
            }
          }
        }

        if (skipUntilTocEnd) continue;

        if (currentSection && bookmarkStarts.length === 0) {
          currentSection.contentElements.push({ type: 'paragraph', element });
        }
      }

      // 🔧 V4.1: 테이블이 올바른 순서에서 현재 섹션에 연결됨
      else if (type === 'w:tbl') {
        if (skipUntilTocEnd) continue;

        if (currentSection) {
          currentSection.contentElements.push({ type: 'table', element });

          // 🔧 상세 로그 추가
          const tblInfo = this.extractTableData(element);
          logger.info(`  📊 테이블 → "${currentSection.title.substring(0, 30)}" (${tblInfo.rows}×${tblInfo.cols})`);
        }
      }
    }

    // 마지막 섹션 저장
    if (currentSection && this.isValidSection(currentSection)) {
      sections.push(currentSection);
    }

    return sections;
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 🔧 V4.1 핵심 수정: body.$$ 사용하여 원본 순서 유지
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  getOrderedBodyElements(body) {
    const elements = [];

    // 🔧 V4.1: body.$$ 배열 사용 (순서 보장)
    if (body.$$) {
      for (const child of body.$$) {
        const tagName = child['#name'];
        if (tagName === 'w:p' || tagName === 'w:tbl') {
          elements.push({ type: tagName, element: child });
        }
      }
      logger.debug(`✅ 순서 보장 파싱: ${elements.length}개 요소`);
      return elements;
    }

    // 폴백 (순서 보장 안 됨 - 경고)
    logger.warn('⚠️ body.$$ 없음 - 순서 보장 불가! parseStringPromise 옵션 확인 필요');

    for (const [key, value] of Object.entries(body)) {
      if ((key === 'w:p' || key === 'w:tbl') && Array.isArray(value)) {
        for (const element of value) {
          elements.push({ type: key, element });
        }
      }
    }

    return elements;
  }

  /**
   * $$ 구조에서 bookmarkStart 찾기
   */
  findBookmarkStarts(element) {
    const bookmarks = [];

    // $$ 구조
    if (element.$$) {
      for (const child of element.$$) {
        if (child['#name'] === 'w:bookmarkStart') {
          bookmarks.push(child);
        }
      }
    }

    // 기존 구조 (폴백)
    if (bookmarks.length === 0 && element['w:bookmarkStart']) {
      bookmarks.push(...element['w:bookmarkStart']);
    }

    return bookmarks;
  }

  /**
   * $$ 구조에서 특정 이름의 자식 요소들 찾기
   */
  findChildrenByName(element, name) {
    const children = [];

    if (element.$$) {
      for (const child of element.$$) {
        if (child['#name'] === name) {
          children.push(child);
        }
      }
    }

    // 폴백
    if (children.length === 0 && element[name]) {
      if (Array.isArray(element[name])) {
        children.push(...element[name]);
      } else {
        children.push(element[name]);
      }
    }

    return children;
  }

  /**
   * $$ 구조에서 특정 이름의 자식 요소 하나 찾기
   */
  findChildByName(element, name) {
    if (element.$$) {
      for (const child of element.$$) {
        if (child['#name'] === name) {
          return child;
        }
      }
    }

    // 폴백
    if (element[name]) {
      return Array.isArray(element[name]) ? element[name][0] : element[name];
    }

    return null;
  }

  /**
   * $$ 구조에서 텍스트 추출
   */
  extractTextFromElement(element) {
    const texts = [];

    const extractRecursive = (el) => {
      if (el['#name'] === 'w:t') {
        if (el._) {
          texts.push(el._);
        }
      }

      if (el.$$) {
        for (const child of el.$$) {
          extractRecursive(child);
        }
      }
    };

    extractRecursive(element);

    // 폴백: 기존 구조
    if (texts.length === 0) {
      const runs = element['w:r'] || [];
      for (const run of runs) {
        const tElements = run['w:t'];
        if (!tElements) continue;
        for (const t of tElements) {
          if (typeof t === 'string') texts.push(t);
          else if (t && t._) texts.push(t._);
        }
      }
    }

    return texts.join('');
  }

  /**
   * Paragraph에서 텍스트 추출 ($$ 구조 대응)
   */
  extractTextFromParagraph(para) {
    return this.extractTextFromElement(para);
  }

  inferSectionNumber(title) {
    const match = title.match(/^([\d.]+)\s+/);
    return match ? match[1] : '0';
  }

  identifyContextSection(section) {
    const keywords = ['개요', 'Consensus', '대상', '용어', '아키텍처'];
    const lowerTitle = section.title.toLowerCase();

    const hasKeyword = keywords.some(kw => lowerTitle.includes(kw.toLowerCase()));
    if (!hasKeyword) return null;

    let contextType = 'general';
    if (lowerTitle.includes('개요')) contextType = 'overview';
    else if (lowerTitle.includes('consensus')) contextType = 'consensus';
    else if (lowerTitle.includes('대상')) contextType = 'scope';
    else if (lowerTitle.includes('용어')) contextType = 'terminology';
    else if (lowerTitle.includes('아키텍처')) contextType = 'architecture';

    let appliesTo = 'all';
    if (section.level === 2) {
      const l1Number = section.sectionNumber.split('.')[0];
      appliesTo = `section_${l1Number}`;
    }

    return { contextType, appliesTo };
  }

  isValidSection(section) {
    if (section.isContext) return true;
    if (section.contentElements.length === 0) return false;
    return true;
  }

  extractSectionTextOnly(section) {
    const textLines = [];

    for (const item of section.contentElements) {
      if (item.type === 'paragraph') {
        const text = this.extractTextFromParagraph(item.element);
        if (text) textLines.push(text);
      }
    }

    return textLines.join('\n');
  }

  /**
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   * 테이블 데이터 추출 ($$ 구조 대응)
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  extractTableData(tableElement) {
    // $$ 구조에서 w:tr 찾기
    let rows = this.findChildrenByName(tableElement, 'w:tr');

    if (rows.length === 0) {
      return { type: 'empty', content: '', markdown: '' };
    }

    const tableData = [];

    for (const row of rows) {
      // $$ 구조에서 w:tc 찾기
      const cells = this.findChildrenByName(row, 'w:tc');
      const rowData = [];

      for (const cell of cells) {
        // $$ 구조에서 w:p 찾기
        const cellParas = this.findChildrenByName(cell, 'w:p');
        const cellTexts = [];

        for (const para of cellParas) {
          const text = this.extractTextFromParagraph(para);
          if (text) cellTexts.push(text);
        }

        rowData.push({
          text: cellTexts.join(' '),
          gridSpan: 1,
          vMerge: null
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

    const markdown = this.convertTableToMarkdown(tableData);

    return {
      type: 'table',
      rows: tableData.length,
      cols: tableData[0]?.length || 0,
      content: '',
      markdown
    };
  }

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
      const cells = row.map(cell => cell.text || '');
      lines.push('| ' + cells.join(' | ') + ' |');
    }

    return lines.join('\n');
  }

  /**
   * Guideline 변환 (Checker 호환 버전)
   * 
   * 수정 사항:
   * - antiPatterns/goodPatterns 필드 추가
   * - message 필드 추가
   * - keywords 필드 추가 (llm_contextual용)
   * - astHints 정규화
   * - checkType 검증
   */
  async convertToGuideline(section) {
    try {
      const content = await this.extractSectionContent(section);
      const ruleText = `${section.sectionNumber} ${section.title}\n\n${content.text}`;

      const prompt = this.createGuidelineAnalysisPrompt(ruleText, section);
      const response = await this.llmService.generateGuidelineAnalysis(prompt);

      if (!response || !response.enhancedGuideline) {
        const guideline = this.createFallbackGuideline(section, content, ruleText);
        this.guidelines.push(guideline);
        return;
      }

      const analysis = response.enhancedGuideline;
      const category = this.inferCategory(section.title, ruleText);
      const ruleId = `${category}.${section.sectionNumber.replace(/\./g, '_')}`;

      // ─────────────────────────────────────────────────────────
      // checkType 검증 및 정규화
      // ─────────────────────────────────────────────────────────
      const validCheckTypes = ['regex', 'ast', 'combined', 'llm_contextual'];
      let checkType = analysis.checkType || 'regex';

      // 레거시 checkType 변환
      if (checkType === 'static_analysis') checkType = 'regex';
      if (checkType === 'regex_with_validation') checkType = 'combined';

      // 유효하지 않으면 regex로 폴백
      if (!validCheckTypes.includes(checkType)) {
        console.warn(`  ⚠️ [${ruleId}] 유효하지 않은 checkType "${checkType}" → "regex"로 변경`);
        checkType = 'regex';
      }

      // ─────────────────────────────────────────────────────────
      // antiPatterns / goodPatterns 처리
      // ─────────────────────────────────────────────────────────
      let antiPatterns = [];
      let goodPatterns = [];

      // 새 형식 (antiPatterns/goodPatterns)
      if (analysis.antiPatterns && Array.isArray(analysis.antiPatterns)) {
        antiPatterns = analysis.antiPatterns.map(p => this.validatePattern(p, ruleId)).filter(Boolean);
      }
      if (analysis.goodPatterns && Array.isArray(analysis.goodPatterns)) {
        goodPatterns = analysis.goodPatterns.map(p => this.validatePattern(p, ruleId)).filter(Boolean);
      }

      // 레거시 형식 (patterns 배열) 변환
      if (antiPatterns.length === 0 && goodPatterns.length === 0 && analysis.patterns) {
        if (Array.isArray(analysis.patterns)) {
          analysis.patterns.forEach(p => {
            const validated = this.validatePattern(p, ruleId);
            if (validated) {
              if (p.type === 'positive') {
                goodPatterns.push(validated);
              } else {
                antiPatterns.push(validated);
              }
            }
          });
        }
      }

      // ─────────────────────────────────────────────────────────
      // astHints 정규화
      // ─────────────────────────────────────────────────────────
      let astHints = null;
      if (analysis.astHints && typeof analysis.astHints === 'object') {
        astHints = {};

        // nodeTypes (복수형, 배열)
        if (analysis.astHints.nodeTypes && Array.isArray(analysis.astHints.nodeTypes)) {
          astHints.nodeTypes = analysis.astHints.nodeTypes;
        } else if (analysis.astHints.nodeType) {
          astHints.nodeTypes = Array.isArray(analysis.astHints.nodeType)
            ? analysis.astHints.nodeType
            : [analysis.astHints.nodeType];
        }

        // checkConditions
        if (analysis.astHints.checkConditions && Array.isArray(analysis.astHints.checkConditions)) {
          astHints.checkConditions = analysis.astHints.checkConditions;
        } else if (analysis.astHints.checkPoints && Array.isArray(analysis.astHints.checkPoints)) {
          astHints.checkConditions = analysis.astHints.checkPoints;
        }

        // 빈 객체면 null로
        if (Object.keys(astHints).length === 0) astHints = null;
      }

      // ─────────────────────────────────────────────────────────
      // message 생성
      // ─────────────────────────────────────────────────────────
      let message = analysis.message;
      if (!message || !message.trim()) {
        message = `${section.title} 규칙을 위반했습니다`;
      }

      // ─────────────────────────────────────────────────────────
      // keywords 처리 (llm_contextual 필수)
      // ─────────────────────────────────────────────────────────
      let keywords = [];
      if (analysis.keywords && Array.isArray(analysis.keywords)) {
        keywords = analysis.keywords.filter(k => typeof k === 'string' && k.trim());
      }

      // llm_contextual인데 keywords 없으면 자동 추출
      if (checkType === 'llm_contextual' && keywords.length === 0) {
        keywords = this.extractKeywordsFromText(section.title, ruleText);
      }

      // ─────────────────────────────────────────────────────────
      // examples 정규화
      // ─────────────────────────────────────────────────────────
      let examples = { good: [], bad: [] };
      if (analysis.examples && typeof analysis.examples === 'object') {
        if (Array.isArray(analysis.examples.good)) {
          examples.good = analysis.examples.good;
        }
        if (Array.isArray(analysis.examples.bad)) {
          examples.bad = analysis.examples.bad;
        }
      }

      const astConversionResult = this.astHintsConverter.convert(astHints, {
        title: section.title,
        category: category,
        description: analysis.enhancedDescription || ruleText
      });

      // ─────────────────────────────────────────────────────────
      // 최종 guideline 객체 생성
      // ─────────────────────────────────────────────────────────
      const guideline = {
        ruleId: ruleId,
        sectionNumber: section.sectionNumber,
        title: section.title,
        level: section.level,
        category: category,
        severity: this.inferSeverity(section.title, ruleText),
        description: analysis.enhancedDescription || ruleText,
        checkType: checkType,
        message: message,

        // 패턴 (Checker 호환 형식)
        antiPatterns: antiPatterns,
        goodPatterns: goodPatterns,
        patterns: antiPatterns,  // 하위 호환

        // AST 힌트
        astHints: astHints || {},

        // LLM contextual용
        keywords: keywords,

        // 예시 및 비즈니스 규칙
        examples: examples,
        businessRules: analysis.businessRules || [],

        // ═══════════════════════════════════════════════════════════
        // 🆕 v3.1 신규 필드 (Unified Schema)
        // ═══════════════════════════════════════════════════════════

        /** @type {string|null} 원래 checkType (마이그레이션용, 신규 추출 시 null) */
        originalCheckType: null,

        /** @type {string|null} AST 검사 기준 자연어 설명 (LLM용) */
        astDescription: astConversionResult.astDescription,

        /** @type {string[]} LLM 체크포인트 목록 */
        checkPoints: astConversionResult.checkPoints,

        // 메타데이터
        contextDependencies: this.contextRules.map(c => c.ruleId),
        hasTables: content.tables.length > 0,
        hasImages: content.images.length > 0,
        tables: content.tables,
        images: content.images.map(img => ({
          name: img.name,
          description: img.ocrText || '[OCR 분석 필요]'
        }))
      };

      this.guidelines.push(guideline);

    } catch (error) {
      logger.error(`  ❌ 변환 실패: ${section.sectionNumber} - ${error.message}`);
    }
  }

  /**
   * 패턴 유효성 검증 및 정규화
   * 
   * @param {any} p - 패턴 (문자열 또는 객체)
   * @param {string} ruleId - 규칙 ID (로깅용)
   * @returns {object|null} 정규화된 패턴 또는 null
   */
  validatePattern(p, ruleId) {
    if (!p) return null;

    let patternStr, flags, description;

    if (typeof p === 'string') {
      patternStr = p;
      flags = 'g';
      description = '';
    } else if (typeof p === 'object') {
      patternStr = p.pattern;
      flags = p.flags || 'g';
      description = p.description || '';
    } else {
      return null;
    }

    // 유효성 검증
    if (!patternStr || typeof patternStr !== 'string') {
      return null;
    }

    const trimmed = patternStr.trim();
    if (trimmed.length < 2) {
      return null;
    }

    // 너무 광범위한 패턴 필터링
    const tooGeneric = ['.+', '.*', '\\w+', '\\w*', '\\s+', '\\s*',
      '[a-z]+', '[A-Z]+', '[a-zA-Z]+', '\\d+', '\\d*'];
    if (tooGeneric.includes(trimmed)) {
      console.debug(`  ⏭️ [${ruleId}] 광범위한 패턴 스킵: "${trimmed}"`);
      return null;
    }

    // 정규식 유효성 테스트
    try {
      new RegExp(trimmed, flags);
    } catch (error) {
      console.warn(`  ⚠️ [${ruleId}] 유효하지 않은 정규식: "${trimmed}" - ${error.message}`);
      return null;
    }

    return {
      pattern: trimmed,
      flags: flags,
      description: description
    };
  }

  /**
   * 텍스트에서 키워드 자동 추출
   * 
   * @param {string} title - 규칙 제목
   * @param {string} content - 규칙 내용
   * @returns {string[]} 추출된 키워드 배열
   */
  extractKeywordsFromText(title, content) {
    const keywords = new Set();
    const text = `${title || ''} ${content || ''}`;

    // Java 관련 키워드 우선 추출
    const javaKeywords = [
      'class', 'interface', 'enum', 'method', 'public', 'private', 'protected',
      'static', 'final', 'void', 'String', 'int', 'long', 'double', 'boolean',
      'try', 'catch', 'throw', 'throws', 'Exception', 'Error',
      'if', 'else', 'for', 'while', 'switch', 'case', 'return',
      'LData', 'LMultiData', 'Controller', 'Service', 'Repository',
      '@Override', '@Autowired', '@Service', '@Controller', '@Component'
    ];

    javaKeywords.forEach(kw => {
      // 대소문자 구분 없이 검색하되, 원본 키워드 유지
      if (text.toLowerCase().includes(kw.toLowerCase())) {
        keywords.add(kw);
      }
    });

    // 한글 명사 추출 (2글자 이상)
    const koreanNouns = text.match(/[가-힣]{2,}/g) || [];
    koreanNouns.forEach(noun => {
      // 불용어 제외
      const stopWords = ['규칙', '사용', '경우', '있다', '없다', '한다', '된다', '것이', '해야'];
      if (!stopWords.includes(noun)) {
        keywords.add(noun);
      }
    });

    // CamelCase 단어 추출
    const camelCaseWords = text.match(/[A-Z][a-z]+(?:[A-Z][a-z]+)*/g) || [];
    camelCaseWords.forEach(word => {
      if (word.length >= 4) keywords.add(word);
    });

    return Array.from(keywords).slice(0, 10);
  }

  /**
   * 폴백 가이드라인 생성 (LLM 분석 실패 시)
   * 
   * Checker 호환 형식으로 기본값 제공
   */
  createFallbackGuideline(section, content, ruleText) {
    const ruleId = `general.${section.sectionNumber.replace(/\./g, '_')}`;

    return {
      ruleId: ruleId,
      sectionNumber: section.sectionNumber,
      title: section.title,
      level: section.level,
      category: 'general',
      severity: 'MEDIUM',
      description: ruleText.substring(0, 500),

      // Checker 호환 필드
      checkType: 'regex',
      message: `${section.title} 규칙을 위반했습니다`,

      // 패턴 (빈 배열)
      antiPatterns: [],
      goodPatterns: [],
      patterns: [],

      // AST 힌트
      astHints: {},

      // LLM contextual용
      keywords: [],

      // 예시 및 비즈니스 규칙
      examples: { good: [], bad: [] },
      businessRules: [],

      // ═══════════════════════════════════════════════════════════
      // 🆕 v3.1 신규 필드 (Unified Schema) - 기본값
      // ═══════════════════════════════════════════════════════════
      originalCheckType: null,
      astDescription: null,
      checkPoints: [],

      // 메타데이터
      contextDependencies: [],
      hasTables: content.tables.length > 0,
      hasImages: content.images.length > 0,
      tables: content.tables,
      images: []
    };
  }

  async extractSectionContent(section) {
    const content = {
      text: '',
      tables: [],
      images: []
    };

    const textLines = [];

    for (const item of section.contentElements) {
      if (item.type === 'paragraph') {
        const text = this.extractTextFromParagraph(item.element);
        if (text) textLines.push(text);

        // 이미지 추출 (필요시)
        // const images = await this.extractImagesFromParagraph(item.element);
        // content.images.push(...images);
      }

      else if (item.type === 'table') {
        const table = this.extractTableData(item.element);
        content.tables.push(table);

        if (table.type === 'textbox') {
          textLines.push(`\n[텍스트박스] ${table.content}\n`);
        } else {
          textLines.push('\n' + table.markdown + '\n');
        }
      }
    }

    content.text = textLines.join('\n');

    return content;
  }

  /**
   * 가이드라인 분석 프롬프트 생성 (Checker 호환 버전)
   * 
   * 수정 사항:
   * - checkType: regex, ast, combined, llm_contextual 만 허용
   * - patterns → antiPatterns, goodPatterns 분리
   * - astHints 필드명 변경 (nodeTypes, checkConditions)
   * - message, keywords 필드 추가
   * 
   * @param {string} ruleText - 규칙 원문
   * @param {object} section - 섹션 정보
   * @returns {string} LLM 프롬프트
   */
  createGuidelineAnalysisPrompt(ruleText, section) {
    return `다음은 Java 코딩 가이드라인 규칙입니다. 이를 분석하여 코드 검사에 사용할 수 있는 구조화된 정보로 변환해주세요.

## 규칙 정보
- 섹션: ${section.sectionNumber}
- 제목: ${section.title}
- Level: ${section.level}

## 규칙 내용
${ruleText}

## 응답 형식
다음 JSON 형식으로 응답해주세요:

\`\`\`json
{
  "checkType": "regex | ast | combined | llm_contextual",
  "enhancedDescription": "규칙에 대한 명확한 설명 (1-2문장)",
  "message": "위반 시 개발자에게 보여줄 메시지",
  
  "antiPatterns": [
    {
      "pattern": "위반을 탐지하는 정규식",
      "flags": "g",
      "description": "이 패턴이 매칭되면 위반"
    }
  ],
  
  "goodPatterns": [
    {
      "pattern": "올바른 코드를 확인하는 정규식",
      "flags": "g",
      "description": "이 패턴이 있어야 정상"
    }
  ],
  
  "astHints": {
    "nodeTypes": ["ClassDeclaration", "MethodDeclaration", "VariableDeclaration"],
    "checkConditions": ["확인할 조건 1", "확인할 조건 2"]
  },
  
  "keywords": ["키워드1", "키워드2"],
  
  "examples": {
    "good": ["올바른 코드 예시"],
    "bad": ["잘못된 코드 예시"]
  },
  
  "businessRules": ["비즈니스 규칙 1", "비즈니스 규칙 2"]
}
\`\`\`

## checkType 선택 기준
- **regex**: 정규식 패턴 매칭으로 검사 가능한 규칙 (들여쓰기, 공백, 명명 패턴 등)
- **ast**: 코드 구조 분석이 필요한 규칙 (클래스명, 메서드 길이, 중첩 깊이 등)
- **combined**: 정규식으로 1차 탐지 후 AST로 검증이 필요한 복합 규칙
- **llm_contextual**: 비즈니스 로직, 아키텍처 패턴 등 의미론적 분석이 필요한 규칙

## 패턴 작성 가이드
- antiPatterns: 이 패턴이 매칭되면 **위반**입니다 (나쁜 코드 탐지)
- goodPatterns: 이 패턴이 있어야 **정상**입니다 (좋은 코드 확인)
- 정규식은 Java 코드에서 동작해야 합니다
- 너무 광범위한 패턴(.*, .+, \\w+)은 피해주세요
- flags는 보통 "g"를 사용합니다

## 주의사항
- JSON만 출력하세요 (마크다운 코드블록 포함)
- 정규식 특수문자는 이스케이프하세요 (\\\\t, \\\\s 등)
- antiPatterns 또는 goodPatterns 중 최소 하나는 있어야 합니다 (regex/combined인 경우)
- llm_contextual인 경우 keywords는 필수입니다
- message는 한국어로 작성해주세요`;
  }

  inferCategory(title, content) {
    const lowerTitle = title.toLowerCase();
    const lowerContent = content.toLowerCase();

    if (lowerTitle.includes('명명') || lowerTitle.includes('이름')) return 'naming_convention';
    if (lowerTitle.includes('주석') || lowerContent.includes('javadoc')) return 'documentation';
    if (lowerTitle.includes('들여쓰기') || lowerTitle.includes('공백')) return 'code_style';
    if (lowerContent.includes('exception') || lowerContent.includes('try')) return 'error_handling';

    return 'general';
  }

  inferSeverity(title, content) {
    const lowerContent = content.toLowerCase();

    if (lowerContent.includes('필수') || lowerContent.includes('반드시')) return 'HIGH';
    if (lowerContent.includes('권장') || lowerContent.includes('가급적')) return 'MEDIUM';

    return 'LOW';
  }

  sortGuidelines() {
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
  }

  async saveToJSON(outputPath) {
    const output = {
      metadata: {
        totalRules: this.guidelines.length,
        totalContextRules: this.contextRules.length,
        extractedAt: new Date().toISOString(),
        version: '4.1',
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
    this.printStatistics();
  }

  printStatistics() {
    logger.info('\n' + '═'.repeat(60));
    logger.info('📊 추출 통계');
    logger.info('═'.repeat(60));

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
    logger.info(`  - 테이블 포함 섹션: ${tablesCount}개`);
    logger.info(`  - 이미지 포함 섹션: ${imagesCount}개`);

    logger.info('\n' + '═'.repeat(60));
  }

  /**
 * AST 힌트에서 자연어 설명 생성
 * 
 * @param {Object} astHints - AST 검사 힌트
 * @param {string} checkType - 검사 타입
 * @returns {string|null} 자연어 설명 또는 null
 */
  generateAstDescription(astHints, checkType) {
    // AST 기반 규칙이 아니면 null
    if (!['ast', 'combined', 'llm_with_ast'].includes(checkType)) {
      return null;
    }

    if (!astHints || Object.keys(astHints).length === 0) {
      return null;
    }

    const parts = [];

    // 검사 대상 노드
    if (astHints.nodeTypes && astHints.nodeTypes.length > 0) {
      const nodeDescriptions = astHints.nodeTypes.map(type => {
        return this.getNodeTypeDescription(type);
      });
      parts.push(`검사 대상: ${nodeDescriptions.join(', ')}`);
    }

    // checkConditions가 있으면 추가
    if (astHints.checkConditions && astHints.checkConditions.length > 0) {
      parts.push(`검사 조건: ${astHints.checkConditions.join(', ')}`);
    }

    return parts.length > 0 ? parts.join('. ') + '.' : null;
  }

  /**
   * AST 노드 타입의 한글 설명 반환
   * 
   * @param {string} nodeType - AST 노드 타입
   * @returns {string} 한글 설명
   */
  getNodeTypeDescription(nodeType) {
    const descriptions = {
      'ClassDeclaration': '클래스 선언',
      'MethodDeclaration': '메서드 선언',
      'VariableDeclaration': '변수 선언',
      'VariableDeclarator': '변수 선언',
      'IfStatement': 'if 조건문',
      'ForStatement': 'for 반복문',
      'WhileStatement': 'while 반복문',
      'TryStatement': 'try 블록',
      'CatchClause': 'catch 블록',
      'ThrowStatement': 'throw 문',
      'ReturnStatement': 'return 문',
      'FieldDeclaration': '필드 선언',
      'ConstructorDeclaration': '생성자',
      'MethodInvocation': '메서드 호출',
      'Annotation': '어노테이션'
    };

    return descriptions[nodeType] || nodeType;
  }

  /**
   * AST 힌트에서 체크포인트 생성
   * 
   * @param {Object} astHints - AST 검사 힌트
   * @param {string} checkType - 검사 타입
   * @param {string} title - 규칙 제목
   * @returns {string[]} 체크포인트 배열
   */
  generateCheckPoints(astHints, checkType, title) {
    // AST 기반 규칙이 아니면 빈 배열
    if (!['ast', 'combined', 'llm_with_ast'].includes(checkType)) {
      return [];
    }

    const checkPoints = [];

    if (!astHints || Object.keys(astHints).length === 0) {
      // 기본 체크포인트
      checkPoints.push(`${title} 규칙을 준수하고 있는가?`);
      return checkPoints;
    }

    // nodeTypes 기반
    if (astHints.nodeTypes && astHints.nodeTypes.length > 0) {
      const nodeDesc = astHints.nodeTypes.map(t => this.getNodeTypeDescription(t)).join('/');
      checkPoints.push(`${nodeDesc}이(가) 존재하는가?`);
    }

    // checkConditions 기반
    if (astHints.checkConditions && astHints.checkConditions.length > 0) {
      astHints.checkConditions.forEach(condition => {
        checkPoints.push(condition.endsWith('?') ? condition : `${condition}?`);
      });
    }

    return checkPoints;
  }
}