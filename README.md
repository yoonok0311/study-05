<!-- Created: 2026-09-30 16:34 -->
# study-05

서버 없이 브라우저에서 OpenRouter 무료 AI 모델을 직접 부르는 웹 앱 두 개입니다.

| 앱 | 바로 열기 | 설명 |
|---|---|---|
| PDF 문서 요약 | [index_pdf.html](https://yoonok0311.github.io/study-05/index_pdf.html) | PDF를 끌어다 놓으면 한 줄 요약, 핵심 요점, 섹션별 요약, 키워드를 한국어로 보여 줍니다 |
| AI 공감 다이어리 | [index.html](https://yoonok0311.github.io/study-05/) | 오늘 하루를 한 줄로 쓰면 감정을 알아보고 공감과 위로를 건넵니다 |

## API 키

처음 열면 OpenRouter API 키를 입력하는 창이 뜹니다. 키는 [openrouter.ai/keys](https://openrouter.ai/keys)에서 무료로 만들 수 있고, 입력한 키는 내 브라우저(localStorage)에만 저장됩니다.

무료 모델은 계정당 하루 약 50회까지 요청할 수 있습니다.

## 내 PC에서 쓰기

1. `.env`에 `OPENROUTER_API_KEY=...`를 넣습니다.
2. `py build_config.py`를 실행해 `config.js`를 만듭니다. 이 파일에는 키가 들어 있으니 커밋하지 마세요(`.gitignore`에 등록되어 있음).
3. `index_pdf.html` 또는 `index.html`을 더블클릭합니다.

## 파일

- `index_pdf.html`, `pdf_extract.js`(pdf.js로 텍스트 추출), `pdf_summarizer.js`(OpenRouter 요약): PDF 요약 앱
- `index.html`, `llm.js`: 공감 다이어리
- `PRD_pdf.md`: PDF 요약 앱 요구사항 문서
