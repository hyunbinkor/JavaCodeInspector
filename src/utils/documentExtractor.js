/**
 * Document Extractor Utility (XML 직접 파싱 - 수정 버전)
 * 
 * 수정사항:
 * 1. h1=0일 때 Heading2/3/4 무시 (Ver 1.0 같은 표지 제외)
 * 2. 디버그 로그 유지
 */

import fs from 'fs/promises';
import path from 'path';
import PDFParser from 'pdf2json';
import JSZip from 'jszip';
import { parseStringPromise } from 'xml2js';
import logger from './loggerUtils.js';

export class DocumentExtractor {
  constructor() {
    this.supportedFormats = ['.pdf', '.docx'];
  }

  async extractText(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    
    logger.info(`📄 문서 타입 감지: ${ext}`);
    
    switch (ext) {
      case '.pdf':
        return await this.extractFromPDF(filePath);
      
      case '.docx':
        return await this.extractFromDOCX(filePath);
      
      case '.doc':
        throw new Error(
          'DOC 파일은 지원하지 않습니다.\n' +
          '해결 방법:\n' +
          '1. Microsoft Word에서 DOCX로 변환\n' +
          '2. LibreOffice 사용: soffice --headless --convert-to docx ' + 
          path.basename(filePath)
        );
      
      default:
        throw new Error(
          `지원하지 않는 파일 형식: ${ext}\n` +
          `지원 형식: ${this.supportedFormats.join(', ')}`
        );
    }
  }

  async extractFromPDF(pdfPath) {
    return new Promise((resolve, reject) => {
      logger.info('📕 PDF 파일 파싱 시작...');
      
      const pdfParser = new PDFParser();

      pdfParser.on('pdfParser_dataError', errData => {
        logger.error('PDF 파싱 오류:', errData.parserError);
        reject(new Error('PDF 파싱 실패'));
      });

      pdfParser.on('pdfParser_dataReady', pdfData => {
        try {
          let fullText = '';

          if (pdfData.Pages) {
            logger.info(`  📄 페이지 수: ${pdfData.Pages.length}`);

            for (const page of pdfData.Pages) {
              if (page.Texts) {
                for (const text of page.Texts) {
                  if (text.R && text.R[0] && text.R[0].T) {
                    const decodedText = decodeURIComponent(text.R[0].T);
                    fullText += decodedText + ' ';
                  }
                }
                fullText += '\n';
              }
            }
          }

          logger.info(`✅ PDF 텍스트 추출 완료: ${fullText.length}자`);
          resolve(fullText);

        } catch (error) {
          reject(error);
        }
      });

      pdfParser.loadPDF(pdfPath);
    });
  }

  async extractFromDOCX(docxPath) {
    logger.info('📘 DOCX 파일 파싱 시작 (XML 직접 파싱)...');
    
    try {
      const buffer = await fs.readFile(docxPath);
      const zip = await JSZip.loadAsync(buffer);
      
      const documentXml = await zip.file('word/document.xml').async('string');
      const doc = await parseStringPromise(documentXml);
      
      const body = doc['w:document']['w:body'][0];
      
      let h1 = 0, h2 = 0, h3 = 0, h4 = 0;
      const lines = [];
      
      const stylesSeen = new Set();
      let paragraphCount = 0;
      let headingCount = 0;
      
      for (const [elementType, elements] of Object.entries(body)) {
        if (!Array.isArray(elements)) continue;
        
        for (const element of elements) {
          if (elementType === 'w:sdt') {
            if (this.isTableOfContents(element)) {
              logger.info('📋 목차 발견 - 전체 건너뜀');
              continue;
            }
          }
          
          if (elementType === 'w:p') {
            paragraphCount++;
            
            const pPr = element['w:pPr']?.[0];
            const pStyle = pPr?.['w:pStyle']?.[0]?.$?.['w:val'];
            
            if (pStyle) {
              stylesSeen.add(pStyle);
            }
            
            const result = this.processParagraph(element, h1, h2, h3, h4);
            
            if (result.updateCounters) {
              headingCount++;
              logger.info(`  ✔ Heading 발견 (${headingCount}): [${pStyle}] ${result.text?.substring(0, 50)}...`);
            }
            
            if (result.updateCounters) {
              h1 = result.h1;
              h2 = result.h2;
              h3 = result.h3;
              h4 = result.h4;
            }
            
            if (result.text) {
              lines.push(result.text);
            }
          }
        }
      }
      
      logger.info('\n' + '='.repeat(80));
      logger.info('📊 DOCX 파싱 통계');
      logger.info('='.repeat(80));
      logger.info(`총 단락 수: ${paragraphCount}`);
      logger.info(`Heading 수: ${headingCount}`);
      logger.info(`텍스트 라인 수: ${lines.length}`);
      logger.info(`\n발견된 스타일 종류 (${stylesSeen.size}개):`);
      
      const sortedStyles = Array.from(stylesSeen).sort();
      sortedStyles.forEach(style => {
        logger.info(`  - ${style}`);
      });
      logger.info('='.repeat(80) + '\n');
      
      const extractedText = lines.join('\n');
      logger.info(`✅ DOCX 텍스트 추출 완료: ${extractedText.length}자`);
      
      if (extractedText.length === 0) {
        throw new Error('DOCX 파일이 비어있거나 텍스트를 추출할 수 없습니다.');
      }
      
      return extractedText;

    } catch (error) {
      logger.error(`❌ DOCX 파싱 실패: ${error.message}`);
      
      if (error.message.includes('ENOENT')) {
        throw new Error(`DOCX 파일을 찾을 수 없습니다: ${docxPath}`);
      }
      
      throw new Error(`DOCX 파일 읽기 실패: ${error.message}`);
    }
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

  processParagraph(para, h1, h2, h3, h4) {
    const pPr = para['w:pPr']?.[0];
    const text = this.extractTextFromPara(para);
    
    if (!text) {
      return { text: null, updateCounters: false, h1, h2, h3, h4 };
    }
    
    const pStyle = pPr?.['w:pStyle']?.[0]?.$?.['w:val'];
    
    if (!pStyle) {
      return { text, updateCounters: false, h1, h2, h3, h4 };
    }
    
    // === 수정: h1이 0이면 아직 본문 시작 전 (표지, Ver 등) ===
    if (this.isHeading1(pStyle)) {
      h1++; h2 = h3 = h4 = 0;
      return {
        text: `${h1}. ${text}`,
        updateCounters: true,
        h1, h2, h3, h4
      };
    }
    else if (this.isHeading2(pStyle)) {
      // h1이 0이면 표지 부분 (Ver 1.0 등) - 무시
      if (h1 === 0) {
        return { text: null, updateCounters: false, h1, h2, h3, h4 };
      }
      
      h2++; h3 = h4 = 0;
      return {
        text: `${h1}.${h2}. ${text}`,
        updateCounters: true,
        h1, h2, h3, h4
      };
    }
    else if (this.isHeading3(pStyle)) {
      // h1이 0이면 무시
      if (h1 === 0) {
        return { text: null, updateCounters: false, h1, h2, h3, h4 };
      }
      
      h3++; h4 = 0;
      return {
        text: `${h1}.${h2}.${h3}. ${text}`,
        updateCounters: true,
        h1, h2, h3, h4
      };
    }
    else if (this.isHeading4(pStyle)) {
      // h1이 0이면 무시
      if (h1 === 0) {
        return { text: null, updateCounters: false, h1, h2, h3, h4 };
      }
      
      h4++;
      return {
        text: `${h1}.${h2}.${h3}.${h4}. ${text}`,
        updateCounters: true,
        h1, h2, h3, h4
      };
    }
    
    return { text, updateCounters: false, h1, h2, h3, h4 };
  }

  isHeading1(style) {
    return style === 'Heading1' || 
           style === '제목1' || 
           style === 'afe3' ||
           style === '1';
  }

  isHeading2(style) {
    return style === 'Heading2' || 
           style === '제목2' || 
           style === 'afe4' ||
           style === '2';
  }

  isHeading3(style) {
    return style === 'Heading3' || 
           style === '제목3' || 
           style === 'afe5' ||
           style === '3';
  }

  isHeading4(style) {
    return style === 'Heading4' || 
           style === '제목4' || 
           style === 'afe6' ||
           style === '4';
  }

  extractTextFromPara(para) {
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

  isSupported(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return this.supportedFormats.includes(ext);
  }

  getSupportedFormats() {
    return [...this.supportedFormats];
  }

  getDocConversionHelp(docPath) {
    const basename = path.basename(docPath);
    return `
DOC 파일 변환 방법:

방법 1: Microsoft Word
  1. ${basename} 파일 열기
  2. "파일" → "다른 이름으로 저장"
  3. 파일 형식: "Word 문서 (*.docx)" 선택
  4. 저장

방법 2: LibreOffice (무료)
  soffice --headless --convert-to docx "${basename}"

방법 3: 온라인 변환
  https://www.online-convert.com/
  https://convertio.co/kr/doc-docx/
`;
  }
}