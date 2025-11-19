/**
 * Document Extractor Utility (DOCX 전용)
 * 
 * PDF, DOCX 파일에서 텍스트를 추출하는 통합 유틸리티
 * DOC 파일은 DOCX로 변환 후 사용 권장
 * 
 * 지원 형식:
 * - PDF: pdf2json (기존)
 * - DOCX: mammoth (신규)
 * - DOC: 지원 안 함 (DOCX 변환 권장)
 * 
 * @module DocumentExtractor
 */

import fs from 'fs/promises';
import path from 'path';
import PDFParser from 'pdf2json';
import mammoth from 'mammoth';
import logger from './loggerUtils.js';
import * as cheerio from 'cheerio';

export class DocumentExtractor {
  constructor() {
    this.supportedFormats = ['.pdf', '.docx'];
  }

  /**
   * 파일 확장자를 기반으로 적절한 추출 메서드 선택
   * 
   * @param {string} filePath - 문서 파일 경로
   * @returns {Promise<string>} 추출된 텍스트
   */
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
          '   - 파일 열기 → "다른 이름으로 저장" → DOCX 선택\n' +
          '2. LibreOffice 사용:\n' +
          '   soffice --headless --convert-to docx ' + path.basename(filePath) + '\n' +
          '3. 온라인 변환 도구 사용'
        );
      
      default:
        throw new Error(
          `지원하지 않는 파일 형식: ${ext}\n` +
          `지원 형식: ${this.supportedFormats.join(', ')}`
        );
    }
  }

  /**
   * PDF 텍스트 추출 (pdf2json 사용)
   * 
   * @param {string} pdfPath - PDF 파일 경로
   * @returns {Promise<string>} 추출된 텍스트
   */
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

            for (let pageIndex = 0; pageIndex < pdfData.Pages.length; pageIndex++) {
              const page = pdfData.Pages[pageIndex];

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

  /**
   * DOCX 텍스트 추출 (mammoth 사용)
   * 
   * mammoth는 DOCX 파일을 읽어서 순수 텍스트로 변환
   * 서식은 제거되고 텍스트만 추출됨
   * 
   * @param {string} docxPath - DOCX 파일 경로
   * @returns {Promise<string>} 추출된 텍스트
   */
  async extractFromDOCX(docxPath) {
    logger.info('📘 DOCX 파일 파싱 시작...');
    
    try {
      // mammoth.extractRawText: 순수 텍스트만 추출 (서식 제거)
      const result = await mammoth.extractRawText({
        path: docxPath,
        styleMap: [
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh"
        ]
      });
      
      // HTML에서 텍스트 추출
      const $ = cheerio.load(result.value);
      const text = $('body').text();
      
      // 경고 메시지 처리
      if (result.messages && result.messages.length > 0) {
        const warnings = result.messages.filter(m => m.type === 'warning');
        if (warnings.length > 0) {
          logger.warn(`⚠️ DOCX 파싱 경고 ${warnings.length}개:`);
          warnings.slice(0, 3).forEach(msg => {
            logger.warn(`  - ${msg.message}`);
          });
          if (warnings.length > 3) {
            logger.warn(`  ... 외 ${warnings.length - 3}개`);
          }
        }
      }

      logger.info(`✅ DOCX 텍스트 추출 완료: ${text.length}자`);
      
      if (text.length === 0) {
        throw new Error('DOCX 파일이 비어있거나 텍스트를 추출할 수 없습니다.');
      }
      
      return text;

    } catch (error) {
      logger.error('❌ DOCX 파싱 실패:', error.message);
      
      if (error.message.includes('ENOENT')) {
        throw new Error(`DOCX 파일을 찾을 수 없습니다: ${docxPath}`);
      }
      
      throw new Error(`DOCX 파일 읽기 실패: ${error.message}`);
    }
  }

  /**
   * 파일 형식 지원 여부 확인
   * 
   * @param {string} filePath - 파일 경로
   * @returns {boolean} 지원 여부
   */
  isSupported(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return this.supportedFormats.includes(ext);
  }

  /**
   * 지원 형식 목록 반환
   * 
   * @returns {string[]} 지원 형식 배열
   */
  getSupportedFormats() {
    return [...this.supportedFormats];
  }

  /**
   * DOC 파일 변환 안내 메시지
   * 
   * @param {string} docPath - DOC 파일 경로
   * @returns {string} 변환 안내 메시지
   */
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