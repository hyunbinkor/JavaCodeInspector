// test_ollama.js - Ollama 연결 테스트 스크립트
import axios from 'axios';

const OLLAMA_URL = 'http://149.36.1.227:19846';

console.log('🔍 Node.js에서 Ollama 연결 테스트 시작...\n');

async function testOllamaConnection() {
  try {
    console.log('1. 기본 연결 테스트...');
    
    const client = axios.create({
      baseURL: OLLAMA_URL,
      timeout: 30000, // 30초
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // 1. 태그 API 테스트
    console.log('   /api/tags 호출 중...');
    const tagsResponse = await client.get('/api/tags');
    console.log('   ✅ 태그 API 성공:', tagsResponse.status);
    
    const models = tagsResponse.data.models;
    console.log(`   📋 사용 가능한 모델 (${models.length}개):`);
    models.forEach(model => {
      console.log(`      - ${model.name} (크기: ${(model.size/1024/1024/1024).toFixed(1)}GB)`);
    });

    // 2. 간단한 생성 테스트
    console.log('\n2. 간단한 텍스트 생성 테스트...');
    const generatePayload = {
      model: 'qwen3:32b',
      prompt: 'Hello, respond with just "OK"',
      stream: false,
      options: {
        temperature: 0.1,
        max_tokens: 10
      }
    };

    console.log('   /api/generate 호출 중...');
    const startTime = Date.now();
    
    const generateResponse = await client.post('/api/generate', generatePayload);
    
    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(1);
    
    console.log(`   ✅ 생성 API 성공: ${generateResponse.status} (응답시간: ${duration}초)`);
    console.log(`   📝 응답 내용: "${generateResponse.data.response.trim()}"`);

    // 3. 한글 프롬프트 테스트
    console.log('\n3. 한글 프롬프트 테스트...');
    const koreanPayload = {
      model: 'qwen3:32b',
      prompt: '안녕하세요. "네, 안녕하세요"라고만 대답해주세요.',
      stream: false,
      options: {
        temperature: 0.1,
        max_tokens: 20
      }
    };

    const koreanResponse = await client.post('/api/generate', koreanPayload);
    console.log(`   ✅ 한글 테스트 성공: ${koreanResponse.status}`);
    console.log(`   📝 한글 응답: "${koreanResponse.data.response.trim()}"`);

    console.log('\n🎉 모든 테스트 통과! Ollama 서버가 정상 작동합니다.');
    return true;

  } catch (error) {
    console.error('\n❌ 테스트 실패:');
    console.error('   오류 메시지:', error.message);
    
    if (error.response) {
      console.error('   HTTP 상태:', error.response.status);
      console.error('   응답 데이터:', error.response.data);
    } else if (error.request) {
      console.error('   요청은 보냈지만 응답 없음');
      console.error('   요청 설정:', error.config?.url);
    } else {
      console.error('   요청 설정 오류');
    }
    
    return false;
  }
}

// 테스트 실행
testOllamaConnection()
  .then(success => {
    if (success) {
      console.log('\n✅ 결론: Ollama 서버 연결에 문제 없음');
      console.log('   → 원본 코드의 다른 부분에 문제가 있을 수 있습니다');
    } else {
      console.log('\n❌ 결론: Node.js에서 Ollama 연결에 문제 있음');
    }
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('💥 예상치 못한 오류:', error);
    process.exit(1);
  });