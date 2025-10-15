#!/bin/bash

echo "🚀 Code Pattern Analyzer 설정 시작"

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 함수 정의
print_step() {
    echo -e "${BLUE}📋 $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Node.js 버전 확인
print_step "Node.js 버전 확인 중..."
if command -v node >/dev/null 2>&1; then
    NODE_VERSION=$(node --version | cut -d'v' -f2)
    REQUIRED_VERSION="18.0.0"
    
    if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$NODE_VERSION" | sort -V | head -n1)" = "$REQUIRED_VERSION" ]; then
        print_success "Node.js $NODE_VERSION 확인됨"
    else
        print_error "Node.js 18.0.0 이상이 필요합니다. 현재: $NODE_VERSION"
        exit 1
    fi
else
    print_error "Node.js가 설치되지 않았습니다."
    echo "다음 명령어로 설치하세요:"
    echo "curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -"
    echo "sudo apt-get install -y nodejs"
    exit 1
fi

# npm 의존성 설치
print_step "npm 의존성 설치 중..."
if npm install; then
    print_success "의존성 설치 완료"
else
    print_error "의존성 설치 실패"
    exit 1
fi

# Docker 설치 확인
print_step "Docker 설치 확인 중..."
if command -v docker >/dev/null 2>&1; then
    print_success "Docker 확인됨"
else
    print_warning "Docker가 설치되지 않았습니다. Weaviate 실행을 위해 필요합니다."
    echo "Docker 설치 가이드: https://docs.docker.com/get-docker/"
fi

# Ollama 설치 확인
print_step "Ollama 설치 확인 중..."
if command -v ollama >/dev/null 2>&1; then
    print_success "Ollama 확인됨"
    
    # Ollama 서비스 상태 확인
    if curl -s http://localhost:11434/api/tags >/dev/null 2>&1; then
        print_success "Ollama 서비스 실행 중"
    else
        print_warning "Ollama 서비스가 실행되지 않았습니다."
        echo "다음 명령어로 시작하세요: ollama serve"
    fi
    
    # Qwen2.5 32B 모델 확인
    if ollama list | grep -q "qwen2.5:32b"; then
        print_success "Qwen2.5 32B 모델 확인됨"
    else
        print_warning "Qwen2.5 32B 모델이 설치되지 않았습니다."
        echo "다음 명령어로 설치하세요: ollama pull qwen2.5:32b"
        echo "참고: 이 모델은 약 20GB의 공간을 사용합니다."
    fi
else
    print_warning "Ollama가 설치되지 않았습니다."
    echo ""
    echo "Ollama 설치 방법:"
    echo "macOS: brew install ollama"
    echo "Linux: curl -fsSL https://ollama.ai/install.sh | sh"
    echo ""
fi

# 환경 설정 파일 생성
print_step "환경 설정 파일 확인 중..."
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        print_success ".env 파일 생성됨"
        print_warning "필요에 따라 .env 파일을 수정하세요"
    else
        print_error ".env.example 파일을 찾을 수 없습니다"
    fi
else
    print_success ".env 파일이 이미 존재합니다"
fi

# Weaviate 실행
print_step "Weaviate 컨테이너 시작 중..."
if command -v docker-compose >/dev/null 2>&1; then
    if docker-compose up -d weaviate; then
        print_success "Weaviate 컨테이너 시작됨"
        
        # Weaviate 준비 대기
        print_step "Weaviate 서비스 준비 대기 중..."
        sleep 10
        
        MAX_ATTEMPTS=30
        ATTEMPT=1
        while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
            if curl -s http://localhost:8080/v1/.well-known/ready >/dev/null 2>&1; then
                print_success "Weaviate 서비스 준비 완료"
                break
            fi
            
            echo -n "."
            sleep 2
            ATTEMPT=$((ATTEMPT + 1))
        done
        
        if [ $ATTEMPT -gt $MAX_ATTEMPTS ]; then
            print_error "Weaviate 서비스 준비 시간 초과"
        fi
    else
        print_error "Weaviate 컨테이너 시작 실패"
    fi
elif command -v docker >/dev/null 2>&1; then
    print_step "Docker Compose를 사용할 수 없습니다. Docker 명령어로 실행 중..."
    docker run -d \
        --name code-pattern-weaviate \
        -p 8080:8080 \
        -e QUERY_DEFAULTS_LIMIT=25 \
        -e AUTHENTICATION_ANONYMOUS_ACCESS_ENABLED=true \
        -e PERSISTENCE_DATA_PATH=/var/lib/weaviate \
        -e DEFAULT_VECTORIZER_MODULE=none \
        semitechnologies/weaviate:1.22.4
    
    if [ $? -eq 0 ]; then
        print_success "Weaviate 컨테이너 시작됨"
    else
        print_error "Weaviate 컨테이너 시작 실패"
    fi
else
    print_error "Docker가 설치되지 않아 Weaviate를 시작할 수 없습니다"
fi

# 시스템 상태 확인
print_step "시스템 상태 확인 중..."
if npm run status >/dev/null 2>&1; then
    print_success "모든 시스템이 정상적으로 설정되었습니다!"
else
    print_warning "일부 시스템에 문제가 있을 수 있습니다. 'npm run status' 명령어로 확인하세요."
fi

echo ""
echo "🎉 설정 완료!"
echo ""
echo "다음 단계:"
echo "1. 샘플 분석 실행: npm start analyze -i examples/sample_issue.json"
echo "2. 시스템 상태 확인: npm start status"
echo "3. 도움말 보기: npm start --help"
echo ""
echo "문제가 있는 경우 README.md의 문제 해결 섹션을 참조하세요."