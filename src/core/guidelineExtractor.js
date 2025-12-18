/**
 * 가이드라인 추출기 V4.2 (checkType v4.0 스키마 적용)
 * 
 * V4.1 대비 변경사항:
 * 🔧 checkType 재구성: pure_regex, llm_with_regex, llm_contextual, llm_with_ast
 * 🔧 checkType 결정 트리 프롬프트 개선
 * 🔧 checkTypeReason 필드 추가
 * 🔧 레거시 checkType 자동 변환
 * 
 * @version 4.2
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

    // ═══════════════════════════════════════════════════════════════════
    // 🆕 v4.0: checkType 관련 설정
    // ═══════════════════════════════════════════════════════════════════
    this.validCheckTypes = ['pure_regex', 'llm_with_regex', 'llm_contextual', 'llm_with_ast'];

    // 레거시 checkType 매핑 (v3.x → v4.0)
    this.legacyCheckTypeMap = {
      'regex': 'pure_regex',
      'ast': 'llm_with_ast',
      'combined': 'llm_with_regex',
      'static_analysis': 'pure_regex',
      'regex_with_validation': 'llm_with_regex'
    };
  }

  async initialize() {
    logger.info('🚀 가이드라인 추출기 V4.2 초기화 중...');

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
    logger.info('📘 DOCX 파싱 시작 (V4.2 - checkType v4.0)...');

    try {
      // Step 1: ZIP 로드
      const buffer = await fs.readFile(docxPath);
      this.docxZip = await JSZip.loadAsync(buffer);

      const documentXml = await this.docxZip.file('word/document.xml').async('string');

      // 순서 보장 옵션
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
   * 목차 파싱 ($$ 구조 대응)
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  parseTableOfContents(body) {
    let tocStarted = false;
    let tocEnded = false;

    const children = body.$$ || [];

    for (const child of children) {
      if (tocEnded) break;

      const tagName = child['#name'];
      if (tagName !== 'w:p') continue;

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
   * Bookmark 기반 섹션 추출 (순서 보장)
   * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   */
  async extractSectionsByBookmarks(body) {
    const sections = [];
    let currentSection = null;
    let skipUntilTocEnd = true;

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

            if (currentSection && this.isValidSection(currentSection)) {
              sections.push(currentSection);
            }

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

      else if (type === 'w:tbl') {
        if (skipUntilTocEnd) continue;

        if (currentSection) {
          currentSection.contentElements.push({ type: 'table', element });

          const tblInfo = this.extractTableData(element);
          logger.info(`  📊 테이블 → "${currentSection.title.substring(0, 30)}" (${tblInfo.rows}×${tblInfo.cols})`);
        }
      }
    }

    if (currentSection && this.isValidSection(currentSection)) {
      sections.push(currentSection);
    }

    return sections;
  }

  getOrderedBodyElements(body) {
    const elements = [];

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

    logger.warn('⚠️ body.$$ 없음 - 순서 보장 불가!');

    for (const [key, value] of Object.entries(body)) {
      if ((key === 'w:p' || key === 'w:tbl') && Array.isArray(value)) {
        for (const element of value) {
          elements.push({ type: key, element });
        }
      }
    }

    return elements;
  }

  findBookmarkStarts(element) {
    const bookmarks = [];

    if (element.$$) {
      for (const child of element.$$) {
        if (child['#name'] === 'w:bookmarkStart') {
          bookmarks.push(child);
        }
      }
    }

    if (bookmarks.length === 0 && element['w:bookmarkStart']) {
      bookmarks.push(...element['w:bookmarkStart']);
    }

    return bookmarks;
  }

  findChildrenByName(element, name) {
    const children = [];

    if (element.$$) {
      for (const child of element.$$) {
        if (child['#name'] === name) {
          children.push(child);
        }
      }
    }

    if (children.length === 0 && element[name]) {
      if (Array.isArray(element[name])) {
        children.push(...element[name]);
      } else {
        children.push(element[name]);
      }
    }

    return children;
  }

  findChildByName(element, name) {
    if (element.$$) {
      for (const child of element.$$) {
        if (child['#name'] === name) {
          return child;
        }
      }
    }

    if (element[name]) {
      return Array.isArray(element[name]) ? element[name][0] : element[name];
    }

    return null;
  }

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

  extractTableData(tableElement) {
    let rows = this.findChildrenByName(tableElement, 'w:tr');

    if (rows.length === 0) {
      return { type: 'empty', content: '', markdown: '' };
    }

    const tableData = [];

    for (const row of rows) {
      const cells = this.findChildrenByName(row, 'w:tc');
      const rowData = [];

      for (const cell of cells) {
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

    const headerRow = tableData[0];
    const headerCells = headerRow.map(cell => cell.text || '');
    lines.push('| ' + headerCells.join(' | ') + ' |');

    const separator = headerCells.map(() => '---').join(' | ');
    lines.push('| ' + separator + ' |');

    for (let i = 1; i < tableData.length; i++) {
      const row = tableData[i];
      const cells = row.map(cell => cell.text || '');
      lines.push('| ' + cells.join(' | ') + ' |');
    }

    return lines.join('\n');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🆕 v4.0: 가이드라인 분석 프롬프트 (checkType 결정 트리)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * 가이드라인 분석 프롬프트 생성 (v4.0 - checkType 결정 트리)
   * 
   * @param {string} ruleText - 규칙 원문
   * @param {object} section - 섹션 정보
   * @returns {string} LLM 프롬프트
   */
  createGuidelineAnalysisPrompt(ruleText, section) {
    return `당신은 Java 코딩 가이드라인을 분석하여 자동 코드 검사 규칙으로 변환하는 전문가입니다.

## 규칙 정보
- 섹션: ${section.sectionNumber}
- 제목: ${section.title}
- Level: ${section.level}

## 규칙 내용
${ruleText}

═══════════════════════════════════════════════════════════════════════════════
## checkType 결정 가이드 (반드시 이 순서대로 판단하세요)
═══════════════════════════════════════════════════════════════════════════════

### Q1. 정규식만으로 100% 정확한 탐지가 가능한가?
   예시: System.out.println 금지, e.printStackTrace() 금지, TODO/FIXME 주석
   - 오탐(False Positive) 가능성이 없음
   - 문맥 고려 없이 패턴 매칭만으로 위반 확정 가능
   → YES: **pure_regex** (LLM 검증 불필요)
   → NO: Q2로

### Q2. 정규식으로 후보 탐지 가능하나, 오탐 가능성이 있는가?
   예시: 빈 catch 블록 (의도적 무시 vs 실수), finally 내 close() (try-with-resources 대체 가능?)
   - 정규식으로 "의심 코드" 탐지 가능
   - 하지만 문맥을 봐야 실제 위반인지 판단 가능
   → YES: **llm_with_regex** (정규식 후보 → LLM 검증)
   → NO: Q3로

### Q3. 코드 구조(AST) 정보가 판단에 핵심적인가?
   예시: 메서드 길이 초과, 순환 복잡도, 중첩 깊이, 파라미터 수
   - 코드의 구조적 특성(깊이, 개수, 복잡도)을 분석해야 함
   - AST 정보 + LLM 해석이 필요
   → YES: **llm_with_ast** (AST 정보 + LLM 검증)
   → NO: Q4로

### Q4. 의미론적/비즈니스 로직 분석이 필요한가?
   예시: Controller에서 비즈니스 로직 분리, 레이어 규칙, 트랜잭션 경계
   - 코드의 "의미"나 "의도"를 파악해야 함
   - 아키텍처/설계 패턴 관점의 분석 필요
   → **llm_contextual** (태그/키워드 필터 → LLM 분석)

═══════════════════════════════════════════════════════════════════════════════
## 응답 형식 (JSON)
═══════════════════════════════════════════════════════════════════════════════

\`\`\`json
{
  "checkType": "pure_regex | llm_with_regex | llm_contextual | llm_with_ast",
  "checkTypeReason": "위 결정 트리의 어느 단계에서 결정되었는지 1문장으로 설명",
  
  "enhancedDescription": "규칙에 대한 명확한 설명 (1-2문장)",
  "message": "위반 시 개발자에게 보여줄 메시지 (한국어)",
  
  "antiPatterns": [
    {
      "pattern": "위반 후보를 탐지하는 정규식",
      "flags": "g",
      "description": "이 패턴이 매칭되면 위반 (또는 위반 후보)"
    }
  ],
  
  "goodPatterns": [
    {
      "pattern": "정상 코드 패턴 (예외 처리용)",
      "flags": "g",
      "description": "이 패턴이 있으면 위반 아님"
    }
  ],
  
  "keywords": ["코드에 있어야 규칙 적용할 키워드"],
  
  "tagCondition": "태그 조건식 (예: IS_CONTROLLER && HAS_DB_CALL)",
  
  "astHints": {
    "nodeTypes": ["CatchClause", "MethodDeclaration"],
    "checkConditions": ["확인할 조건"],
    "maxLineCount": null,
    "checkEmpty": false
  },
  
  "examples": {
    "good": ["올바른 코드 예시"],
    "bad": ["잘못된 코드 예시"]
  },
  
  "businessRules": ["관련 비즈니스 규칙"]
}
\`\`\`

═══════════════════════════════════════════════════════════════════════════════
## checkType별 필수/권장 필드
═══════════════════════════════════════════════════════════════════════════════

### pure_regex (정규식만으로 판정)
- **필수**: antiPatterns 또는 goodPatterns (최소 1개)
- 권장: message, examples

### llm_with_regex (정규식 후보 → LLM 검증)
- **필수**: antiPatterns (후보 탐지용)
- 권장: keywords, examples, goodPatterns

### llm_contextual (의미 분석)
- **필수**: keywords 또는 tagCondition
- 권장: examples, businessRules

### llm_with_ast (AST + LLM)
- **필수**: astHints (nodeTypes 또는 수치 조건)
- 권장: keywords, examples

═══════════════════════════════════════════════════════════════════════════════
## 정규식 작성 가이드
═══════════════════════════════════════════════════════════════════════════════

1. Java 코드에서 동작하는 정규식 작성
2. 특수문자 이스케이프: \\\\., \\\\(, \\\\), \\\\[, \\\\]
3. 너무 광범위한 패턴 금지: .*, .+, \\\\w+ 단독 사용 금지
4. flags는 보통 "g" 사용

예시:
- System.out.println: "System\\\\.out\\\\.print(ln)?\\\\s*\\\\("
- 빈 catch 블록: "catch\\\\s*\\\\([^)]*\\\\)\\\\s*\\\\{\\\\s*\\\\}"
- e.printStackTrace(): "\\\\.printStackTrace\\\\s*\\\\(\\\\s*\\\\)"

═══════════════════════════════════════════════════════════════════════════════
## 주의사항
═══════════════════════════════════════════════════════════════════════════════

1. JSON만 출력하세요 (마크다운 코드블록 포함)
2. checkTypeReason은 반드시 작성 (결정 과정 추적용)
3. message는 한국어로 작성
4. 확실하지 않으면 llm_contextual 선택 (가장 안전)`;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 🆕 v4.0: Guideline 변환 (checkType v4.0 스키마)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Guideline 변환 (v4.0 - checkType 재구성)
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

      // ─────────────────────────────────────────────────────────────────────
      // 🆕 v4.0: checkType 검증 및 정규화
      // ─────────────────────────────────────────────────────────────────────
      let checkType = analysis.checkType || 'llm_contextual';
      let checkTypeReason = analysis.checkTypeReason || '';
      let originalCheckType = null;

      // 레거시 checkType 변환 (v3.x → v4.0)
      if (this.legacyCheckTypeMap[checkType]) {
        originalCheckType = checkType;
        checkType = this.legacyCheckTypeMap[checkType];
        checkTypeReason = `레거시 변환: ${originalCheckType} → ${checkType}`;
        logger.info(`  🔄 [${ruleId}] checkType 변환: ${originalCheckType} → ${checkType}`);
      }

      // 유효하지 않으면 llm_contextual로 폴백
      if (!this.validCheckTypes.includes(checkType)) {
        logger.warn(`  ⚠️ [${ruleId}] 유효하지 않은 checkType "${checkType}" → "llm_contextual"로 변경`);
        originalCheckType = checkType;
        checkType = 'llm_contextual';
        checkTypeReason = `유효하지 않은 checkType "${originalCheckType}"에서 폴백`;
      }

      // ─────────────────────────────────────────────────────────────────────
      // antiPatterns / goodPatterns 처리
      // ─────────────────────────────────────────────────────────────────────
      let antiPatterns = [];
      let goodPatterns = [];

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

      // ─────────────────────────────────────────────────────────────────────
      // 🆕 v4.0: checkType별 필수 조건 검증 및 자동 조정
      // ─────────────────────────────────────────────────────────────────────
      const adjustResult = this.validateAndAdjustCheckType(checkType, {
        antiPatterns,
        goodPatterns,
        analysis,
        ruleId
      });
      checkType = adjustResult.checkType;
      if (adjustResult.reason) {
        checkTypeReason = adjustResult.reason;
      }

      // ─────────────────────────────────────────────────────────────────────
      // astHints 정규화
      // ─────────────────────────────────────────────────────────────────────
      let astHints = null;
      if (analysis.astHints && typeof analysis.astHints === 'object') {
        astHints = {};

        if (analysis.astHints.nodeTypes && Array.isArray(analysis.astHints.nodeTypes)) {
          astHints.nodeTypes = analysis.astHints.nodeTypes;
        } else if (analysis.astHints.nodeType) {
          astHints.nodeTypes = Array.isArray(analysis.astHints.nodeType)
            ? analysis.astHints.nodeType
            : [analysis.astHints.nodeType];
        }

        if (analysis.astHints.checkConditions && Array.isArray(analysis.astHints.checkConditions)) {
          astHints.checkConditions = analysis.astHints.checkConditions;
        } else if (analysis.astHints.checkPoints && Array.isArray(analysis.astHints.checkPoints)) {
          astHints.checkConditions = analysis.astHints.checkPoints;
        }

        // 수치 조건 복사
        ['maxLineCount', 'maxCyclomaticComplexity', 'maxNestingDepth', 'maxParameters', 'checkEmpty'].forEach(key => {
          if (analysis.astHints[key] !== undefined) {
            astHints[key] = analysis.astHints[key];
          }
        });

        if (Object.keys(astHints).length === 0) astHints = null;
      }

      // ─────────────────────────────────────────────────────────────────────
      // message 생성
      // ─────────────────────────────────────────────────────────────────────
      let message = analysis.message;
      if (!message || !message.trim()) {
        message = `${section.title} 규칙을 위반했습니다`;
      }

      // ─────────────────────────────────────────────────────────────────────
      // keywords 처리
      // ─────────────────────────────────────────────────────────────────────
      let keywords = [];
      if (analysis.keywords && Array.isArray(analysis.keywords)) {
        keywords = analysis.keywords.filter(k => typeof k === 'string' && k.trim());
      }

      // llm_contextual/llm_with_regex인데 keywords 없으면 자동 추출
      if (['llm_contextual', 'llm_with_regex'].includes(checkType) && keywords.length === 0) {
        keywords = this.extractKeywordsFromText(section.title, ruleText);
      }

      // ─────────────────────────────────────────────────────────────────────
      // tagCondition 처리
      // ─────────────────────────────────────────────────────────────────────
      let tagCondition = null;
      if (analysis.tagCondition) {
        if (typeof analysis.tagCondition === 'string') {
          tagCondition = { expression: analysis.tagCondition, description: '' };
        } else if (typeof analysis.tagCondition === 'object') {
          tagCondition = analysis.tagCondition;
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // examples 정규화
      // ─────────────────────────────────────────────────────────────────────
      let examples = { good: [], bad: [] };
      if (analysis.examples && typeof analysis.examples === 'object') {
        if (Array.isArray(analysis.examples.good)) {
          examples.good = analysis.examples.good;
        }
        if (Array.isArray(analysis.examples.bad)) {
          examples.bad = analysis.examples.bad;
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // astDescription / checkPoints 생성
      // ─────────────────────────────────────────────────────────────────────
      const astConversionResult = this.astHintsConverter.convert(astHints, {
        title: section.title,
        category: category,
        description: analysis.enhancedDescription || ruleText
      });

      // ─────────────────────────────────────────────────────────────────────
      // 🆕 v4.0: 최종 guideline 객체 생성
      // ─────────────────────────────────────────────────────────────────────
      const guideline = {
        ruleId: ruleId,
        sectionNumber: section.sectionNumber,
        title: section.title,
        level: section.level,
        category: category,
        severity: this.inferSeverity(section.title, ruleText),
        description: analysis.enhancedDescription || ruleText.substring(0, 500),

        // 🆕 v4.0 checkType
        checkType: checkType,
        checkTypeReason: checkTypeReason,
        originalCheckType: originalCheckType,

        message: message,

        // 패턴
        antiPatterns: antiPatterns,
        goodPatterns: goodPatterns,
        patterns: antiPatterns,  // 하위 호환

        // AST 힌트
        astHints: astHints || {},

        // 🆕 v4.0 LLM 지원 필드
        astDescription: astConversionResult.astDescription,
        checkPoints: astConversionResult.checkPoints,

        // 필터링
        keywords: keywords,
        tagCondition: tagCondition,
        requiredTags: analysis.requiredTags || [],
        excludeTags: analysis.excludeTags || [],

        // 예시 및 비즈니스 규칙
        examples: examples,
        businessRules: analysis.businessRules || [],

        // 활성화 상태
        isActive: true,

        // 메타데이터
        metadata: {
          createdAt: new Date().toISOString(),
          source: `${section.sectionNumber} ${section.title}`,
          version: '4.0'
        },

        // 문서 컨텍스트
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
      logger.info(`  ✅ [${ruleId}] 변환 완료 (checkType: ${checkType})`);

    } catch (error) {
      logger.error(`  ❌ 변환 실패: ${section.sectionNumber} - ${error.message}`);
    }
  }

  /**
   * 🆕 v4.0: checkType별 필수 조건 검증 및 자동 조정
   */
  validateAndAdjustCheckType(checkType, context) {
    const { antiPatterns, goodPatterns, analysis, ruleId } = context;

    switch (checkType) {
      case 'pure_regex':
        // pure_regex: antiPatterns 또는 goodPatterns 필수
        if (antiPatterns.length === 0 && goodPatterns.length === 0) {
          logger.warn(`  ⚠️ [${ruleId}] pure_regex인데 패턴이 없음 → llm_contextual로 변경`);
          return { checkType: 'llm_contextual', reason: 'pure_regex 필수 패턴 없음' };
        }
        break;

      case 'llm_with_regex':
        // llm_with_regex: antiPatterns 필수
        if (antiPatterns.length === 0) {
          logger.warn(`  ⚠️ [${ruleId}] llm_with_regex인데 antiPatterns 없음 → llm_contextual로 변경`);
          return { checkType: 'llm_contextual', reason: 'llm_with_regex 필수 antiPatterns 없음' };
        }
        break;

      case 'llm_with_ast':
        // llm_with_ast: astHints 또는 구조적 힌트 필수
        if (!analysis.astHints || !this.hasStructuralAstHints(analysis.astHints)) {
          logger.warn(`  ⚠️ [${ruleId}] llm_with_ast인데 AST 정보 없음 → llm_contextual로 변경`);
          return { checkType: 'llm_contextual', reason: 'llm_with_ast 필수 AST 정보 없음' };
        }
        break;

      case 'llm_contextual':
        // llm_contextual: keywords 또는 tagCondition 권장 (없어도 허용)
        break;
    }

    return { checkType, reason: null };
  }

  /**
   * 패턴 유효성 검증 및 정규화
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

    if (!patternStr || typeof patternStr !== 'string') {
      return null;
    }

    const trimmed = patternStr.trim();
    if (trimmed.length < 2) {
      return null;
    }

    const tooGeneric = ['.+', '.*', '\\w+', '\\w*', '\\s+', '\\s*',
      '[a-z]+', '[A-Z]+', '[a-zA-Z]+', '\\d+', '\\d*'];
    if (tooGeneric.includes(trimmed)) {
      logger.debug(`  ⏭️ [${ruleId}] 광범위한 패턴 스킵: "${trimmed}"`);
      return null;
    }

    try {
      new RegExp(trimmed, flags);
    } catch (error) {
      logger.warn(`  ⚠️ [${ruleId}] 유효하지 않은 정규식: "${trimmed}" - ${error.message}`);
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
   */
  extractKeywordsFromText(title, content) {
    const keywords = new Set();
    const text = `${title || ''} ${content || ''}`;

    const javaKeywords = [
      'class', 'interface', 'enum', 'method', 'public', 'private', 'protected',
      'static', 'final', 'void', 'String', 'int', 'long', 'double', 'boolean',
      'try', 'catch', 'throw', 'throws', 'Exception', 'Error',
      'if', 'else', 'for', 'while', 'switch', 'case', 'return',
      'LData', 'LMultiData', 'Controller', 'Service', 'Repository',
      '@Override', '@Autowired', '@Service', '@Controller', '@Component'
    ];

    javaKeywords.forEach(kw => {
      if (text.toLowerCase().includes(kw.toLowerCase())) {
        keywords.add(kw);
      }
    });

    const koreanNouns = text.match(/[가-힣]{2,}/g) || [];
    koreanNouns.forEach(noun => {
      const stopWords = ['규칙', '사용', '경우', '있다', '없다', '한다', '된다', '것이', '해야'];
      if (!stopWords.includes(noun)) {
        keywords.add(noun);
      }
    });

    const camelCaseWords = text.match(/[A-Z][a-z]+(?:[A-Z][a-z]+)*/g) || [];
    camelCaseWords.forEach(word => {
      if (word.length >= 4) keywords.add(word);
    });

    return Array.from(keywords).slice(0, 10);
  }

  /**
   * 🆕 v4.0: 폴백 가이드라인 생성
   * 기본 checkType을 llm_contextual로 변경 (가장 안전)
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

      // 🆕 v4.0: 폴백은 llm_contextual (가장 안전)
      checkType: 'llm_contextual',
      checkTypeReason: 'LLM 분석 실패로 인한 폴백',
      originalCheckType: null,

      message: `${section.title} 규칙을 위반했습니다`,

      antiPatterns: [],
      goodPatterns: [],
      patterns: [],

      astHints: {},
      astDescription: null,
      checkPoints: [],

      keywords: this.extractKeywordsFromText(section.title, ruleText),
      tagCondition: null,
      requiredTags: [],
      excludeTags: [],

      examples: { good: [], bad: [] },
      businessRules: [],

      isActive: true,
      metadata: {
        createdAt: new Date().toISOString(),
        source: `${section.sectionNumber} ${section.title}`,
        version: '4.0',
        isFallback: true
      },

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

  inferCategory(title, content) {
    const lowerTitle = title.toLowerCase();
    const lowerContent = content.toLowerCase();

    if (lowerTitle.includes('명명') || lowerTitle.includes('이름')) return 'naming_convention';
    if (lowerTitle.includes('주석') || lowerContent.includes('javadoc')) return 'documentation';
    if (lowerTitle.includes('들여쓰기') || lowerTitle.includes('공백')) return 'code_style';
    if (lowerContent.includes('exception') || lowerContent.includes('try') || lowerContent.includes('catch')) return 'exception_handling';
    if (lowerContent.includes('connection') || lowerContent.includes('resource') || lowerContent.includes('close')) return 'resource_management';
    if (lowerContent.includes('security') || lowerContent.includes('injection') || lowerContent.includes('sql')) return 'security';
    if (lowerContent.includes('controller') || lowerContent.includes('service') || lowerContent.includes('layer')) return 'architecture';
    if (lowerContent.includes('performance') || lowerContent.includes('성능')) return 'performance';

    return 'general';
  }

  inferSeverity(title, content) {
    const lowerContent = content.toLowerCase();

    if (lowerContent.includes('필수') || lowerContent.includes('반드시') || lowerContent.includes('금지')) return 'HIGH';
    if (lowerContent.includes('보안') || lowerContent.includes('security') || lowerContent.includes('injection')) return 'CRITICAL';
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
        version: '4.2',
        schemaVersion: 'unified-rule.schema.json v4.0',
        checkTypeDistribution: this.getCheckTypeDistribution(),
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

  /**
   * 🆕 v4.0: checkType 분포 계산
   */
  getCheckTypeDistribution() {
    const dist = {
      pure_regex: 0,
      llm_with_regex: 0,
      llm_contextual: 0,
      llm_with_ast: 0
    };

    for (const g of this.guidelines) {
      if (dist[g.checkType] !== undefined) {
        dist[g.checkType]++;
      }
    }

    return dist;
  }

  /**
   * 🆕 v4.0: 통계 출력 (checkType 분포 포함)
   */
  printStatistics() {
    logger.info('\n' + '═'.repeat(60));
    logger.info('📊 추출 통계 (v4.0)');
    logger.info('═'.repeat(60));

    // 🆕 checkType 분포
    const checkTypeDist = this.getCheckTypeDistribution();
    logger.info('\n🏷️ checkType 분포:');
    for (const [type, count] of Object.entries(checkTypeDist)) {
      const percentage = this.guidelines.length > 0
        ? ((count / this.guidelines.length) * 100).toFixed(1)
        : 0;
      logger.info(`  - ${type}: ${count}개 (${percentage}%)`);
    }

    const categoryDist = {};
    const severityDist = {};
    let tablesCount = 0;
    let imagesCount = 0;
    let fallbackCount = 0;

    for (const g of this.guidelines) {
      categoryDist[g.category] = (categoryDist[g.category] || 0) + 1;
      severityDist[g.severity] = (severityDist[g.severity] || 0) + 1;
      if (g.hasTables) tablesCount++;
      if (g.hasImages) imagesCount++;
      if (g.metadata?.isFallback) fallbackCount++;
    }

    logger.info('\n📂 카테고리별 분포:');
    for (const [cat, count] of Object.entries(categoryDist)) {
      logger.info(`  - ${cat}: ${count}개`);
    }

    logger.info('\n⚠️ 심각도별 분포:');
    for (const [sev, count] of Object.entries(severityDist)) {
      logger.info(`  - ${sev}: ${count}개`);
    }

    logger.info('\n📊 기타 통계:');
    logger.info(`  - 테이블 포함 섹션: ${tablesCount}개`);
    logger.info(`  - 이미지 포함 섹션: ${imagesCount}개`);
    logger.info(`  - 폴백 처리된 규칙: ${fallbackCount}개`);

    logger.info('\n' + '═'.repeat(60));
  }

  /**
   * AST 힌트에서 자연어 설명 생성
   */
  generateAstDescription(astHints, checkType) {
    if (!['llm_with_ast'].includes(checkType)) {
      return null;
    }

    if (!astHints || Object.keys(astHints).length === 0) {
      return null;
    }

    const parts = [];

    if (astHints.nodeTypes && astHints.nodeTypes.length > 0) {
      const nodeDescriptions = astHints.nodeTypes.map(type => {
        return this.getNodeTypeDescription(type);
      });
      parts.push(`검사 대상: ${nodeDescriptions.join(', ')}`);
    }

    if (astHints.checkConditions && astHints.checkConditions.length > 0) {
      parts.push(`검사 조건: ${astHints.checkConditions.join(', ')}`);
    }

    if (astHints.maxLineCount) {
      parts.push(`라인 수 ${astHints.maxLineCount} 초과 시 위반`);
    }

    if (astHints.checkEmpty) {
      parts.push(`블록이 비어있으면 위반`);
    }

    return parts.length > 0 ? parts.join('. ') + '.' : null;
  }

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

  generateCheckPoints(astHints, checkType, title) {
    if (!['llm_with_ast', 'llm_with_regex'].includes(checkType)) {
      return [];
    }

    const checkPoints = [];

    if (!astHints || Object.keys(astHints).length === 0) {
      checkPoints.push(`${title} 규칙을 준수하고 있는가?`);
      return checkPoints;
    }

    if (astHints.nodeTypes && astHints.nodeTypes.length > 0) {
      const nodeDesc = astHints.nodeTypes.map(t => this.getNodeTypeDescription(t)).join('/');
      checkPoints.push(`${nodeDesc}이(가) 존재하는가?`);
    }

    if (astHints.checkConditions && astHints.checkConditions.length > 0) {
      astHints.checkConditions.forEach(condition => {
        checkPoints.push(condition.endsWith('?') ? condition : `${condition}?`);
      });
    }

    return checkPoints;
  }

  hasStructuralAstHints(astHints) {
    if (!astHints) return false;

    const structuralHints = [
      'nodeTypes', 'checkEmpty', 'maxLineCount', 'maxCyclomaticComplexity',
      'maxNestingDepth', 'maxParameters', 'minBodyStatements', 'maxBodyStatements',
      'requiredAnnotations', 'forbiddenAnnotations', 'requiresLogging', 'requiresNullCheck'
    ];

    for (const hint of structuralHints) {
      const value = astHints[hint];
      if (value !== undefined && value !== null) {
        if (Array.isArray(value) && value.length > 0) return true;
        if (typeof value === 'boolean' || typeof value === 'number') return true;
      }
    }

    return false;
  }
}

export default GuidelineExtractor;