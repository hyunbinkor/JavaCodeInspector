#!/bin/bash
# extract-and-apply-guidelines.sh
# PDF 가이드라인 추출 및 코드 분석기 적용 통합 스크립트

set -e

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 기본 설정
PDF_FILE=""
OUTPUT_DIR="./guidelines"
CODE_FILE=""
USE_LLM=false
VERBOSE=false

# 도움말 출력
show_help() {
    cat << EOF
PDF 개발가이드 추출 및 코드 품질 검사 통합 도구

사용법: $0 [OPTIONS]

OPTIONS:
    -p, --pdf <file>        개발가이드 PDF 파일 경로
    -o, --output <dir>      가이드라인 출력 디렉토리 (기본값: ./guidelines)
    -c, --code <file>       검사할 Java 코드 파일
    --use-llm              LLM을 사용한 고급 추출 활성화
    --verbose              상세 로그 출력
    -h, --help             이 도움말 출력

예시:
    # PDF에서 가이드라인 추출
    $0 -p development_guide.pdf -o ./my_guidelines

    # 추출 후 바로 코드 검사
    $0 -p development_guide.pdf -c MyClass.java

    # LLM 사용하여 고급 추출
    $0 -p development_guide.pdf --use-llm

EOF
}

# 파라미터 파싱
while [[ $# -gt 0 ]]; do
    case $1 in
        -p|--pdf)
            PDF_FILE="$2"
            shift 2
            ;;
        -o|--output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        -c|--code)
            CODE_FILE="$2"
            shift 2
            ;;
        --use-llm)
            USE_LLM=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        -h|--help)
            show_help
            exit 0
            ;;
        *)
            echo "알 수 없는 옵션: $1"
            show_help
            exit 1
            ;;
    esac
done

# 필수 파라미터 체크
if [[ -z "$PDF_FILE" ]]; then
    echo -e "${RED}오류: PDF 파일을 지정해주세요 (-p 옵션)${NC}"
    show_help
    exit 1
fi

if [[ ! -f "$PDF_FILE" ]]; then
    echo -e "${RED}오류: PDF 파일이 존재하지 않습니다: $PDF_FILE${NC}"
    exit 1
fi

# 로그 함수
log() {
    if [[ "$VERBOSE" == true ]]; then
        echo -e "${BLUE}[INFO]${NC} $1"
    fi
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 의존성 확인
check_dependencies() {
    log "의존성 확인 중..."
    
    # Node.js 확인
    if ! command -v node &> /dev/null; then
        log_error "Node.js가 설치되어 있지 않습니다."
        exit 1
    fi
    
    # PDF 파싱 라이브러리 확인
    if ! node -e "require('pdf-parse')" 2>/dev/null; then
        log_warning "pdf-parse 모듈이 설치되어 있지 않습니다. 설치 중..."
        npm install pdf-parse
    fi
    
    # 코드 분석기 확인
    if [[ ! -f "./main.js" ]]; then
        log_error "통합 코드 분석기 (main.js)를 찾을 수 없습니다."
        exit 1
    fi
    
    log_success "모든 의존성 확인 완료"
}

# 출력 디렉토리 준비
prepare_output_directory() {
    log "출력 디렉토리 준비: $OUTPUT_DIR"
    
    mkdir -p "$OUTPUT_DIR"
    
    # 백업 디렉토리 생성
    if [[ -d "$OUTPUT_DIR" ]] && [[ "$(ls -A $OUTPUT_DIR)" ]]; then
        backup_dir="${OUTPUT_DIR}_backup_$(date +%Y%m%d_%H%M%S)"
        log_warning "기존 가이드라인이 존재합니다. 백업 생성: $backup_dir"
        cp -r "$OUTPUT_DIR" "$backup_dir"
    fi
}

# PDF에서 가이드라인 추출
extract_guidelines() {
    log "PDF 가이드라인 추출 시작: $PDF_FILE"
    
    local extract_command="node guideline-extractor.js \"$PDF_FILE\" \"$OUTPUT_DIR/extracted_guidelines.json\""
    
    if [[ "$USE_LLM" == true ]]; then
        extract_command="$extract_command --use-llm"
        log "LLM 기반 고급 추출 모드 활성화"
    fi
    
    if [[ "$VERBOSE" == true ]]; then
        eval $extract_command
    else
        eval $extract_command > /tmp/extract_log.txt 2>&1
    fi
    
    if [[ $? -eq 0 ]]; then
        log_success "가이드라인 추출 완료"
        
        # 통계 출력
        local rule_count=$(jq length "$OUTPUT_DIR/extracted_guidelines.json" 2>/dev/null || echo "0")
        echo "  - 추출된 규칙 수: $rule_count개"
        
        # 카테고리별 통계
        if command -v jq &> /dev/null; then
            echo "  - 카테고리별 분포:"
            jq -r 'group_by(.category) | .[] | "\(.length)개 - \(.[0].category)"' "$OUTPUT_DIR/extracted_guidelines.json" | sed 's/^/    /'
        fi
    else
        log_error "가이드라인 추출 실패"
        if [[ "$VERBOSE" != true ]] && [[ -f /tmp/extract_log.txt ]]; then
            echo "오류 로그:"
            cat /tmp/extract_log.txt
        fi
        exit 1
    fi
}

# 가이드라인을 분석기에 적용
apply_guidelines() {
    log "추출된 가이드라인을 코드 분석기에 적용 중..."
    
    local guideline_file="$OUTPUT_DIR/extracted_guidelines.json"
    
    if [[ ! -f "$guideline_file" ]]; then
        log_error "가이드라인 파일을 찾을 수 없습니다: $guideline_file"
        exit 1
    fi
    
    # 기존 통합 분석기에 가이드라인 import
    node main.js manage-guidelines --import "$guideline_file"
    
    if [[ $? -eq 0 ]]; then
        log_success "가이드라인 적용 완료"
    else
        log_error "가이드라인 적용 실패"
        exit 1
    fi
}

# 코드 품질 검사 실행
run_code_analysis() {
    if [[ -n "$CODE_FILE" ]]; then
        log "코드 품질 검사 실행: $CODE_FILE"
        
        if [[ ! -f "$CODE_FILE" ]]; then
            log_error "코드 파일을 찾을 수 없습니다: $CODE_FILE"
            exit 1
        fi
        
        local analysis_output="$OUTPUT_DIR/analysis_result.json"
        
        # 통합 코드 검사 실행
        node main.js check -c "$CODE_FILE" -o "$analysis_output" --generate-fixes
        
        if [[ $? -eq 0 ]]; then
            log_success "코드 분석 완료"
            echo "  - 분석 결과: $analysis_output"
            
            # 간단한 요약 출력
            if command -v jq &> /dev/null && [[ -f "$analysis_output" ]]; then
                echo "  - 분석 요약:"
                local total_issues=$(jq -r '.overview.totalIssues // 0' "$analysis_output")
                local overall_score=$(jq -r '.overview.overallScore // 0' "$analysis_output")
                echo "    * 전체 점수: $overall_score/100"
                echo "    * 총 이슈: $total_issues개"
            fi
        else
            log_error "코드 분석 실패"
            exit 1
        fi
    else
        log "코드 파일이 지정되지 않아 분석을 건너뜁니다."
    fi
}

# 결과 리포트 생성
generate_report() {
    log "최종 리포트 생성 중..."
    
    local report_file="$OUTPUT_DIR/extraction_report.md"
    
    cat > "$report_file" << EOF
# 가이드라인 추출 및 적용 리포트

## 실행 정보
- 실행 일시: $(date)
- PDF 파일: $PDF_FILE
- 출력 디렉토리: $OUTPUT_DIR
- LLM 사용: $USE_LLM
- 분석 대상 코드: ${CODE_FILE:-"없음"}

## 추출 결과
EOF

    if [[ -f "$OUTPUT_DIR/extracted_guidelines.json" ]]; then
        local rule_count=$(jq length "$OUTPUT_DIR/extracted_guidelines.json" 2>/dev/null || echo "0")
        echo "- 총 추출된 규칙 수: $rule_count개" >> "$report_file"
        echo "" >> "$report_file"
        
        if command -v jq &> /dev/null; then
            echo "### 카테고리별 분포" >> "$report_file"
            echo "" >> "$report_file"
            jq -r 'group_by(.category) | .[] | "- \(.[0].category): \(.length)개"' "$OUTPUT_DIR/extracted_guidelines.json" >> "$report_file"
            echo "" >> "$report_file"
        fi
    fi

    if [[ -f "$OUTPUT_DIR/analysis_result.json" ]] && command -v jq &> /dev/null; then
        echo "## 코드 분석 결과" >> "$report_file"
        echo "" >> "$report_file"
        
        local total_issues=$(jq -r '.overview.totalIssues // 0' "$OUTPUT_DIR/analysis_result.json")
        local overall_score=$(jq -r '.overview.overallScore // 0' "$OUTPUT_DIR/analysis_result.json")
        
        echo "- 전체 점수: $overall_score/100" >> "$report_file"
        echo "- 총 발견된 이슈: $total_issues개" >> "$report_file"
        echo "" >> "$report_file"
    fi

    echo "## 생성된 파일" >> "$report_file"
    echo "" >> "$report_file"
    find "$OUTPUT_DIR" -type f -name "*.json" -o -name "*.md" | while read file; do
        echo "- $(basename "$file"): $file" >> "$report_file"
    done
    
    log_success "리포트 생성 완료: $report_file"
}

# 메인 실행 흐름
main() {
    echo "=== PDF 개발가이드 추출 및 코드 품질 검사 도구 ==="
    echo ""
    
    check_dependencies
    prepare_output_directory
    extract_guidelines
    apply_guidelines
    run_code_analysis
    generate_report
    
    echo ""
    log_success "모든 작업이 완료되었습니다!"
    echo ""
    echo "생성된 파일들:"
    find "$OUTPUT_DIR" -type f | sort | while read file; do
        echo "  - $file"
    done
    
    if [[ -n "$CODE_FILE" ]]; then
        echo ""
        echo "다음 명령으로 상세한 분석 결과를 확인할 수 있습니다:"
        echo "  cat $OUTPUT_DIR/analysis_result.json | jq ."
    fi
}

# 스크립트 실행
main "$@"