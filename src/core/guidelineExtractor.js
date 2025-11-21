/**
 * 가이드라인 추출기 V3.2 (최종 완성)
 * 
 * V3.1 대비 수정사항:
 * 🔧 Fix: H1 Context 인식 제거 (중복 방지)
 * 
 * 변경 이유:
 * - H1 '1. 개요'와 H2 '1.1 개요'가 모두 ctx.overview 생성
 * - H1은 본문이 없어 content = 0자
 * - H2만 Context로 인식하여 중복 제거 및 빈 content 방지
 * 
 * @module GuidelineExtractor
 * @version 3.2
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
    
    this.headingTitles = {
      h1: null,
      h2: null,
      h3: null,
      h4: null
    };
  }

  async initialize() {
    logger.info('🚀 가이드라인 추출기 V3.2 초기화 중...');
    
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
      logger.info('✅ 문서 파일 존재 확인됨');

      const ext = path.extname(filePath).toLowerCase();
      
      if (ext === '.docx') {
        return await this.extractFromDOCX(filePath);
      } else if (ext === '.pdf') {
        throw new Error('PDF 지원이 필요한 경우 별도 구현 필요');
      } else {
        throw new Error(`지원하지 않는 파일 형식: ${ext}`);
      }

    } catch (error) {
      logger.error('문서 처리 오류:', error.message);
      throw error;
    }
  }

  async extractFromDOCX(docxPath) {
    logger.info('📘 DOCX XML 직접 파싱 시작 (V3.2 - 최종)...');
    
    try {
      const buffer = await fs.readFile(docxPath);
      const zip = await JSZip.loadAsync(buffer);
      
      const documentXml = await zip.file('word/document.xml').async('string');
      const doc = await parseStringPromise(documentXml);
      
      const body = doc['w:document']['w:body'][0];
      
      const sections = this.extractSections(body);
      
      logger.info(`✅ 총 ${sections.length}개 섹션 추출 완료`);
      
      const contextSections = sections.filter(s => s.isContext);
      const guidelineSections = sections.filter(s => !s.isContext);
      
      logger.info(`  📋 Context: ${contextSections.length}개`);
      logger.info(`  📜 Guideline: ${guidelineSections.length}개`);
      
      // Context Rules 디버깅
      logger.info('\n📋 Context Rules 상세:');
      for (const ctx of contextSections) {
        logger.info(`  - ${ctx.number} ${ctx.title} (Level ${ctx.level})`);
        logger.info(`    타입: ${ctx.contextType}`);
        logger.info(`    내용 길이: ${ctx.content.join('\n').length}자`);
      }
      
      // Context 처리
      this.contextRules = contextSections.map(ctx => ({
        ruleId: `ctx.${ctx.contextType}`,
        title: ctx.title,
        sectionNumber: ctx.number,
        fullPath: ctx.fullPath,
        content: ctx.content.join('\n'),
        appliesTo: 'all',
        contextType: ctx.contextType
      }));
      
      // Guideline 처리 (배치)
      this.guidelines = [];
      const batchSize = 5;
      
      for (let i = 0; i < guidelineSections.length; i += batchSize) {
        const batch = guidelineSections.slice(i, i + batchSize);
        logger.info(`\n📦 배치 ${Math.floor(i / batchSize) + 1}/${Math.ceil(guidelineSections.length / batchSize)} 처리 중...`);
        
        await Promise.all(
          batch.map(section => this.convertToGuideline(section))
        );
      }
      
      // 섹션 번호 정렬
      this.sortGuidelines();
      
      logger.info(`\n총 ${this.contextRules.length}개 Context + ${this.guidelines.length}개 Guideline 추출 완료`);
      
      return {
        contextRules: this.contextRules,
        guidelines: this.guidelines
      };
      
    } catch (error) {
      logger.error(`❌ DOCX 파싱 실패: ${error.message}`);
      throw error;
    }
  }

  extractSections(body) {
    const sections = [];
    let currentSection = null;
    let h1 = 0, h2 = 0, h3 = 0, h4 = 0;
    
    for (const [elementType, elements] of Object.entries(body)) {
      if (!Array.isArray(elements)) continue;
      
      for (const element of elements) {
        if (elementType === 'w:sdt') {
          if (this.isTableOfContents(element)) {
            logger.info('📋 목차 건너뜀');
            continue;
          }
        }
        
        if (elementType === 'w:p') {
          const pPr = element['w:pPr']?.[0];
          const pStyle = pPr?.['w:pStyle']?.[0]?.$?.['w:val'];
          const text = this.extractText(element);
          
          if (!text) continue;
          
          const headingInfo = this.getHeadingInfo(pStyle, h1, h2, h3, h4);
          
          if (headingInfo) {
            // 이전 섹션 저장
            if (currentSection) {
              if (currentSection.isContext || this.isValidSection(currentSection)) {
                sections.push(currentSection);
                
                const contentLength = currentSection.content.join('\n').length;
                const marker = currentSection.isContext ? '[CONTEXT]' : '';
                logger.info(`  ✔ ${currentSection.number} ${currentSection.title} ${marker} (${contentLength}자)`);
              }
            }
            
            // 카운터 업데이트
            h1 = headingInfo.h1;
            h2 = headingInfo.h2;
            h3 = headingInfo.h3;
            h4 = headingInfo.h4;
            
            // Heading 제목 추적
            if (headingInfo.level === 1) {
              this.headingTitles.h1 = text;
              this.headingTitles.h2 = null;
              this.headingTitles.h3 = null;
              this.headingTitles.h4 = null;
            } else if (headingInfo.level === 2) {
              this.headingTitles.h2 = text;
              this.headingTitles.h3 = null;
              this.headingTitles.h4 = null;
            } else if (headingInfo.level === 3) {
              this.headingTitles.h3 = text;
              this.headingTitles.h4 = null;
            } else if (headingInfo.level === 4) {
              this.headingTitles.h4 = text;
            }
            
            // 🔧 V3.2: Level 2 Context만 인식
            const isContext = this.isContextSection(text, headingInfo.level, h1);
            const contextType = isContext ? this.inferContextType(text) : null;
            
            const fullPath = this.buildFullPath();
            
            currentSection = {
              level: headingInfo.level,
              number: headingInfo.number,
              title: text,
              fullPath,
              hierarchy: {
                h1: this.headingTitles.h1,
                h2: this.headingTitles.h2,
                h3: this.headingTitles.h3,
                h4: this.headingTitles.h4
              },
              isContext,
              contextType,
              content: []
            };
          }
          else if (currentSection) {
            currentSection.content.push(text);
          }
        }
      }
    }
    
    // 마지막 섹션 저장
    if (currentSection) {
      if (currentSection.isContext || this.isValidSection(currentSection)) {
        sections.push(currentSection);
        
        const contentLength = currentSection.content.join('\n').length;
        const marker = currentSection.isContext ? '[CONTEXT]' : '';
        logger.info(`  ✔ ${currentSection.number} ${currentSection.title} ${marker} (${contentLength}자)`);
      }
    }
    
    return sections;
  }

  /**
   * 🔧 V3.2: H1 Context 인식 제거 (중복 방지)
   * 
   * 변경사항:
   * - Level 1 (H1) Context 인식 제거
   * - Level 2 (H2)만 Context로 인식
   * 
   * 이유:
   * - H1 '1. 개요'와 H2 '1.1 개요'가 모두 ctx.overview 생성 → 중복
   * - H1은 본문이 없어 content = 0자
   * - H2만 Context로 인식하여 문제 해결
   */
  isContextSection(title, level, currentH1) {
    const keywords = ['개요', '대상', '범위', '용어', '아키텍처', 'architecture', 'overview', 'scope'];
    const lowerTitle = title.toLowerCase();
    
    // ❌ V3.1: Level 1도 Context로 인식 (문제 원인)
    // if (level === 1 && currentH1 <= 2) {
    //   return keywords.some(kw => lowerTitle.includes(kw.toLowerCase()));
    // }
    
    // ✅ V3.2: Level 2만 Context로 인식 (첫 번째 H1 내부)
    if (level === 2 && currentH1 === 1) {
      return keywords.some(kw => lowerTitle.includes(kw.toLowerCase()));
    }
    
    return false;
  }

  inferContextType(title) {
    const lowerTitle = title.toLowerCase();
    
    if (lowerTitle.includes('개요') || lowerTitle.includes('overview')) {
      return 'overview';
    }
    if (lowerTitle.includes('범위') || lowerTitle.includes('대상') || lowerTitle.includes('scope')) {
      return 'scope';
    }
    if (lowerTitle.includes('용어')) {
      return 'terminology';
    }
    if (lowerTitle.includes('아키텍처') || lowerTitle.includes('architecture')) {
      return 'architecture';
    }
    
    return 'general';
  }

  buildFullPath() {
    const parts = [
      this.headingTitles.h1,
      this.headingTitles.h2,
      this.headingTitles.h3,
      this.headingTitles.h4
    ].filter(Boolean);
    
    return parts.join(' > ');
  }

  isTableOfContents(sdtElement) {
    try {
      const sdtPr = sdtElement['w:sdtPr']?.[0];
      if (!sdtPr) return false;
      
      const docPartObj = sdtPr['w:docPartObj']?.[0];
      if (!docPartObj) return false;
      
      const gallery = docPartObj['w:docPartGallery']?.[0]?.$?.['w:val'];
      
      return gallery === 'Table of Contents';
    } catch {
      return false;
    }
  }

  getHeadingInfo(pStyle, h1, h2, h3, h4) {
    if (!pStyle) return null;
    
    if (pStyle === 'Heading1' || pStyle === '제목1') {
      h1++; h2 = h3 = h4 = 0;
      return { level: 1, number: `${h1}`, h1, h2, h3, h4 };
    }
    
    if (pStyle === 'Heading2' || pStyle === '제목2') {
      if (h1 === 0) return null;
      h2++; h3 = h4 = 0;
      return { level: 2, number: `${h1}.${h2}`, h1, h2, h3, h4 };
    }
    
    if (pStyle === 'Heading3' || pStyle === '제목3') {
      if (h1 === 0) return null;
      h3++; h4 = 0;
      return { level: 3, number: `${h1}.${h2}.${h3}`, h1, h2, h3, h4 };
    }
    
    if (pStyle === 'Heading4' || pStyle === '제목4') {
      if (h1 === 0) return null;
      h4++;
      return { level: 4, number: `${h1}.${h2}.${h3}.${h4}`, h1, h2, h3, h4 };
    }
    
    return null;
  }

  extractText(para) {
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

  isValidSection(section) {
    if (section.isContext) return true;
    if (section.level < 2) return false;
    
    const contentText = section.content.join('\n').trim();
    if (contentText.length < 5) {
      return false;
    }
    
    const excludeKeywords = ['예제코드', '제/개정'];
    if (excludeKeywords.some(kw => section.title.includes(kw))) {
      return false;
    }
    
    return true;
  }

  async convertToGuideline(section) {
    try {
      const ruleText = [
        `${section.number} ${section.title}`,
        ...section.content
      ].join('\n');
      
      const prompt = this.createGuidelineAnalysisPrompt(ruleText, section);
      const response = await this.llmService.generateGuidelineAnalysis(prompt);
      
      if (!response || !response.enhancedGuideline) {
        logger.warn(`  ⚠️ 분석 실패: ${section.number}`);
        return;
      }
      
      const analysis = response.enhancedGuideline;
      const contextDependencies = this.contextRules.map(c => c.ruleId);
      
      const guideline = {
        ruleId: `${this.inferCategory(section.title, ruleText)}.${section.number.replace(/\./g, '_')}`,
        sectionNumber: section.number,
        title: section.title,
        fullPath: section.fullPath,
        hierarchy: section.hierarchy,
        category: this.inferCategory(section.title, ruleText),
        severity: this.inferSeverity(section.title, ruleText),
        description: analysis.enhancedDescription || ruleText,
        checkType: analysis.checkType || 'static_analysis',
        patterns: analysis.patterns || [],
        examples: analysis.examples || { good: [], bad: [] },
        businessRules: analysis.businessRules || [],
        astHints: analysis.astHints || {},
        contextDependencies
      };
      
      this.guidelines.push(guideline);
      logger.info(`  ✔ 규칙 추출: ${section.fullPath}`);
      
    } catch (error) {
      logger.error(`  ❌ 변환 실패: ${section.number} - ${error.message}`);
    }
  }

  createGuidelineAnalysisPrompt(ruleText, section) {
    return `다음은 Java 코딩 가이드라인 규칙입니다. 이를 분석하여 구조화된 정보로 변환해주세요.

규칙 경로: ${section.fullPath}
규칙 섹션: ${section.number}
규칙 제목: ${section.title}

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

  inferCategory(title, content) {
    const lowerTitle = title.toLowerCase();
    const lowerContent = content.toLowerCase();
    
    if (lowerTitle.includes('명명') || lowerTitle.includes('이름') || 
        lowerTitle.includes('변수') || lowerTitle.includes('클래스') ||
        lowerTitle.includes('메소드') || lowerTitle.includes('패키지')) {
      return 'naming_convention';
    }
    
    if (lowerTitle.includes('주석') || lowerContent.includes('javadoc')) {
      return 'documentation';
    }
    
    if (lowerTitle.includes('들여쓰기') || lowerTitle.includes('공백') ||
        lowerTitle.includes('줄') || lowerContent.includes('indent')) {
      return 'code_style';
    }
    
    if (lowerContent.includes('exception') || lowerContent.includes('try') ||
        lowerContent.includes('catch')) {
      return 'error_handling';
    }
    
    return 'general';
  }

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
    
    const sampleSections = this.guidelines.slice(0, 10).map(g => g.sectionNumber);
    logger.info(`  처음 10개: ${sampleSections.join(', ')}`);
  }

  async saveToJSON(outputPath) {
    const output = {
      metadata: {
        totalRules: this.guidelines.length,
        totalContextRules: this.contextRules.length,
        extractedAt: new Date().toISOString(),
        version: '3.2',
        documentContext: {
          contextRuleIds: this.contextRules.map(c => c.ruleId)
        }
      },
      contextRules: this.contextRules,
      guidelines: this.guidelines
    };
    
    const fileName = path.basename(outputPath);
    await saveJsonData(output, fileName, 'rule');
    
    logger.info(`\n저장 완료: ${outputPath}`);
    logger.info(`추출된 Context: ${this.contextRules.length}개`);
    logger.info(`추출된 Guideline: ${this.guidelines.length}개`);
    
    this.printStatistics();
  }

  printStatistics() {
    logger.info('\n📊 Context Rules:');
    for (const ctx of this.contextRules) {
      logger.info(`  - ${ctx.ruleId}: ${ctx.title}`);
      logger.info(`    섹션: ${ctx.sectionNumber}`);
      logger.info(`    타입: ${ctx.contextType}`);
      logger.info(`    내용: ${ctx.content.length}자`);
    }
    
    const categoryDist = {};
    const severityDist = {};
    const checkTypeDist = {};
    
    for (const g of this.guidelines) {
      categoryDist[g.category] = (categoryDist[g.category] || 0) + 1;
      severityDist[g.severity] = (severityDist[g.severity] || 0) + 1;
      checkTypeDist[g.checkType] = (checkTypeDist[g.checkType] || 0) + 1;
    }
    
    logger.info('\n카테고리별 분포:');
    for (const [cat, count] of Object.entries(categoryDist)) {
      logger.info(`  - ${cat}: ${count}개`);
    }
    
    logger.info('\n심각도별 분포:');
    for (const [sev, count] of Object.entries(severityDist)) {
      logger.info(`  - ${sev}: ${count}개`);
    }
    
    logger.info('\n검사 타입별 분포:');
    for (const [type, count] of Object.entries(checkTypeDist)) {
      logger.info(`  - ${type}: ${count}개`);
    }
  }

  async extractFromPDF(pdfPath) {
    logger.warn('⚠️ extractFromPDF()는 deprecated입니다.');
    return await this.extractFromDocument(pdfPath);
  }
}