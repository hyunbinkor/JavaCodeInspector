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

export class GuidelineExtractor {
  constructor() {
    this.guidelines = [];
    this.contextRules = [];
    this.llmService = new LLMService();
    this.tableOfContents = new Map();
    this.imageRelations = new Map();
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
   * Guideline 변환
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
  }
}

JSON만 출력하고 다른 설명은 포함하지 마세요.`;
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
}