/* Created: 2026-09-30 11:16 */
/*
 * pdf_extract.js — PDF 문서 요약 앱의 PDF 검증·텍스트 추출 계층 (브라우저 전용, 빌드 없음, file:// 에서 동작)
 * 계약: PRD_pdf.md 3.0 / 3.1. 요구사항: P1-5 ~ P1-12, P1-21(추출 부분), PN1-3, PN1-4, PN1-5, PN1-10, PN1-12
 *
 * 로드 순서 (index_pdf.html):
 *   <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"
 *           integrity="sha512-q+4l…oCQ==" crossorigin="anonymous"></script>   <!-- window.pdfjsLib -->
 *   <script src="pdf_extract.js"></script>                                      <!-- window.PdfExtract -->
 *   (pdf.js 태그가 없거나 로드에 실패했으면 extractText가 같은 URL을 한 번 지연 로드해 본다)
 *
 * ── 전역 API: window.PdfExtract ──────────────────────────────────────────
 *
 *   상수
 *     PdfExtract.LIMITS   = { maxBytes: 20971520, maxPages: 100, minTextChars: 30, headerScanBytes: 1024 }
 *     PdfExtract.PDFJS    = { version: '3.11.174', workerSrc: '…/pdf.worker.min.js', cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
 *                             standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/',
 *                             libSrc, libIntegrity, workerIntegrity }   // 뒤 네 개는 PRD 계약에 덧붙인 필드 (표준 폰트·지연 로드·SRI)
 *                           ※ 값은 호출 시점에 읽는다. Node 테스트에서 cMapUrl·standardFontDataUrl을 로컬 경로로 바꿔 쓸 수 있다.
 *     getDocument 옵션: isEvalSupported:false, cMapUrl, cMapPacked:true, standardFontDataUrl, useSystemFonts:false,
 *                       verbosity: ERRORS (pdf.js 경고를 콘솔에 남기지 않음)
 *     PdfExtract.MESSAGES = { <code>: <사용자에게 보여 줄 한국어 문장> }
 *
 *   PdfExtract.isReady() : boolean
 *     window.pdfjsLib이 있고 pdfjsLib.version === '3.11.174'이면 true
 *
 *   PdfExtract.validateFile(file) : Promise<{ name, size }>                     (P1-5)
 *     file: File 또는 { name, size, type?, slice(start,end) → { arrayBuffer() } }
 *     검사 순서: NO_FILE → NOT_PDF(확장자) → EMPTY_FILE → FILE_TOO_LARGE → NOT_PDF(앞 1024바이트에 "%PDF-" 없음)
 *     앞의 네 검사는 파일을 읽지 않는다.
 *
 *   PdfExtract.extractText(file, { signal?, onProgress? }?) : Promise<ExtractResult>   (P1-6 ~ P1-12, P1-21)
 *     이미 abort된 signal → 파일을 읽지 않고 바로 ABORTED.
 *     onProgress({ stage: 'load' })                         PDF 열기 시작
 *     onProgress({ stage: 'page', page: n, pageCount: N })  n쪽 추출 완료 (1..N 오름차순, 쪽마다 1회)
 *     (onProgress 안에서 던진 예외는 무시한다. 추출을 멈추지 않음)
 *
 *   ExtractResult = {
 *     fileName, fileSize, pageCount,
 *     pages      : [{ pageNumber, text }],   // 쪽 순서
 *     text       : pages[].text를 "\n\n"로 이은 전체 텍스트
 *     charCount  : text에서 공백 문자를 뺀 글자 수
 *     emptyPages : 공백 제외 글자 수가 10 미만인 쪽 번호 배열
 *     warnings   : ['PARTIAL_TEXT'] (빈 쪽이 전체의 절반 이상) 또는 []
 *     title      : PDF 메타데이터 Title (없거나 공백이면 null)
 *   }
 *   ※ 모든 문자열은 일반 텍스트. 화면에는 반드시 textContent로 넣을 것.
 *
 *   PdfExtract.normalizePageText(items) : string    순수 함수 (P1-8)
 *   PdfExtract.classifyError(err) : PdfExtractError 순수 함수 (P1-10, P1-11)
 *
 *   실패 시 PdfExtract.PdfExtractError 로 reject (문자열·일반 Error로 reject하지 않음):
 *     err.name 'PdfExtractError', err.code, err.message(= MESSAGES[code]), err.retryable, err.status(null), err.detail(개발자용, ≤300자, 문서 본문 없음)
 *     NO_FILE         파일 없음
 *     NOT_PDF         확장자가 .pdf 아님 / 확장자만 .pdf이고 내용은 PDF 아님
 *     EMPTY_FILE      0바이트
 *     FILE_TOO_LARGE  20MB 초과 (내용은 읽지 않음)
 *     TOO_MANY_PAGES  100쪽 초과 (문서를 연 직후 판정, getPage 호출 없음)
 *     ENCRYPTED       열람 암호 (소유자 암호만 걸린 PDF는 정상 처리)
 *     CORRUPTED       헤더는 PDF지만 pdf.js가 열지 못함
 *     NO_TEXT         전체 글자 수(공백 제외) < 30 — 스캔 PDF 의심 (OCR 미지원)
 *     LIB_LOAD_FAILED pdf.js 없음/버전 다름, 또는 워커 준비 실패      (retryable)
 *     EXTRACT_FAILED  그 외 예상 못한 오류                            (retryable)
 *     ABORTED         signal로 취소
 *
 * ── file:// 워커 대응 (P1-6) ─────────────────────────────────────────────
 *   첫 extractText 때 한 번만 준비하고, 성공하면 결과를 기억한다 (두 번째부터 워커 fetch 없음).
 *   ⓪ GlobalWorkerOptions.workerPort가 이미 있거나 window.pdfjsWorker(메인 스레드용 워커 코드)가 있으면 그대로 사용
 *   ① 워커 스크립트를 fetch(SRI integrity 포함)로 받아 Blob URL을 만들고, new Worker(blobURL)이 'ready'를 보내면
 *      GlobalWorkerOptions.workerPort에 넣는다 → 진짜 별도 스레드. (workerSrc에 Blob URL을 넣는 방식은 file://에서
 *      pdf.js의 same-origin 검사 때문에 항상 메인 스레드로 떨어져서 쓰지 않는다)
 *   ② ①이 실패하면 워커 코드를 <script>로 넣어 window.pdfjsWorker를 만든다 (메인 스레드, 큰 파일에서 느릴 수 있음).
 *      ①에서 받은 Blob URL이 있으면 그것을, 없으면 CDN 주소를 integrity + crossorigin으로 넣는다.
 *   ③ 둘 다 실패하면 LIB_LOAD_FAILED. 실패는 기억하지 않으므로 [다시 시도] 때 처음부터 다시 시도한다.
 *   PdfExtract._internal.getWorkerMode() : null | 'preloaded' | 'worker' | 'main' — 실제로 쓰는 방식
 *   워커 포트 하나를 모든 문서가 공유하므로 extractText 호출은 모듈 안에서 한 번에 하나씩 순서대로 처리한다
 *   (앞 문서의 destroy가 끝난 뒤 다음 문서를 연다. 동시에 부르면 뒤 호출은 앞 호출이 끝날 때까지 기다린다).
 *
 * 로드 시점에는 document, fetch, pdfjsLib 등에 접근하지 않는다 (PN1-10, Node 16에서 require/vm 로드 가능).
 */
(function (root) {
  'use strict';

  // ── 상수 (PRD 3.1) ─────────────────────────────────────────────────────
  var LIMITS = { maxBytes: 20971520, maxPages: 100, minTextChars: 30, headerScanBytes: 1024 };

  var PDFJS = {
    version: '3.11.174',
    workerSrc: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    // 한글 CID 폰트용 CMap: cdnjs에는 없어서 jsDelivr 사용 (PRD R9)
    cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
    // 계약에 덧붙인 필드: 표준 14 폰트(Helvetica 등) 데이터. 없으면 콘솔에 standardFontDataUrl 경고가 난다
    standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/',
    // 아래는 계약에 덧붙인 필드: pdf.js 지연 로드와 SRI (PN1-3). npm 배포본 해시와 일치 확인함
    libSrc: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
    libIntegrity: 'sha512-q+4liFwdPC/bNdhUpZx6aXDx/h77yEQtn4I1slHydcbZK34nLaR3cAeYSJshoxIOq3mjEf7xJE8YWIUHMn+oCQ==',
    workerIntegrity: 'sha512-BbrZ76UNZq5BhH7LL7pn9A4TKQpQeNCHOo65/akfelcIBbcVvYWOFQKPXIrykE3qZxYjmDX573oa4Ywsc7rpTw=='
  };

  var LOAD_TIMEOUT_MS = 30000;   // 라이브러리·워커 스크립트 받기 한도
  var EMPTY_PAGE_CHARS = 10;     // 공백 제외 글자 수가 이보다 적으면 빈 쪽 (P1-12)
  var DETAIL_MAX = 300;

  var MESSAGES = {
    NO_FILE: '요약할 PDF 파일을 선택해 주세요.',
    NOT_PDF: 'PDF 파일이 아니에요. .pdf 파일을 올려 주세요.',
    EMPTY_FILE: '빈 파일이에요. 내용이 있는 PDF를 올려 주세요.',
    FILE_TOO_LARGE: '파일이 너무 커요. 20MB 이하의 PDF만 요약할 수 있어요.',
    TOO_MANY_PAGES: '쪽수가 너무 많아요. 100쪽 이하의 PDF만 요약할 수 있어요.',
    ENCRYPTED: '암호가 걸린 PDF는 열 수 없어요. 암호를 해제한 뒤 다시 올려 주세요.',
    CORRUPTED: 'PDF 파일이 손상되어 열 수 없어요. 다른 파일로 시도해 주세요.',
    NO_TEXT: '이 PDF에서 글자를 찾지 못했어요. 스캔한 이미지 PDF는 아직 지원하지 않아요 (OCR 미지원).',
    LIB_LOAD_FAILED: 'PDF 읽기 도구를 불러오지 못했어요. 인터넷 연결을 확인하고 잠시 후 [다시 시도]를 누르거나 페이지를 새로 고쳐 주세요.',
    EXTRACT_FAILED: 'PDF를 읽는 중 문제가 생겼어요. 다시 시도해 주세요.',
    ABORTED: '취소했어요.'
  };

  var RETRYABLE = { LIB_LOAD_FAILED: true, EXTRACT_FAILED: true };

  // ── 오류 객체 (PRD 3.0) ────────────────────────────────────────────────
  // new 없이 호출해도 되고, instanceof PdfExtractError 가 참이다.
  function PdfExtractError(code, detail) {
    if (!Object.prototype.hasOwnProperty.call(MESSAGES, code)) code = 'EXTRACT_FAILED';
    var err = new Error(MESSAGES[code]);
    err.name = 'PdfExtractError';
    err.code = code;
    err.retryable = !!RETRYABLE[code];
    err.status = null;
    err.detail = detail ? String(detail).slice(0, DETAIL_MAX) : '';
    if (Object.setPrototypeOf) Object.setPrototypeOf(err, PdfExtractError.prototype);
    return err;
  }
  PdfExtractError.prototype = Object.create(Error.prototype);
  PdfExtractError.prototype.constructor = PdfExtractError;
  PdfExtractError.prototype.name = 'PdfExtractError';

  function isOurError(e) {
    return e instanceof PdfExtractError || !!(e && e.name === 'PdfExtractError' && typeof e.code === 'string');
  }

  function describe(e) {
    if (!e) return 'unknown error';
    var name = e.name ? String(e.name) : 'Error';
    var msg = e.message ? String(e.message) : String(e);
    return name + ': ' + msg;
  }

  // ── 외부 의존은 호출 시점에 읽는다 (PRD 3.0, PN1-10) ────────────────────
  function lib() { return root.pdfjsLib || null; }
  function doc() { return typeof root.document !== 'undefined' ? root.document : null; }

  function isReady() {
    var p = lib();
    return !!(p && typeof p.getDocument === 'function' && p.version === PDFJS.version);
  }

  // ── 작은 유틸 ──────────────────────────────────────────────────────────
  function withTimeout(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error(label + ' timeout ' + ms + 'ms')); }, ms);
      promise.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
    });
  }

  // 취소되면 즉시 ABORTED로 끝나는 경쟁용 Promise (P1-21)
  function raceAbort(promise, signal) {
    if (!signal) return promise;
    if (signal.aborted) return Promise.reject(PdfExtractError('ABORTED'));
    return new Promise(function (resolve, reject) {
      function onAbort() { reject(PdfExtractError('ABORTED')); }
      signal.addEventListener('abort', onAbort);
      promise.then(function (v) { signal.removeEventListener('abort', onAbort); resolve(v); },
                   function (e) { signal.removeEventListener('abort', onAbort); reject(e); });
    });
  }

  // 쪽 사이마다 이벤트 루프에 양보 → [취소] 버튼이 반응한다 (PN1-5)
  function yieldToLoop() { return new Promise(function (r) { setTimeout(r, 0); }); }

  function safeProgress(fn, ev) {
    if (typeof fn !== 'function') return;
    try { fn(ev); } catch (e) { /* UI 콜백 오류로 추출을 멈추지 않는다 */ }
  }

  // <script> 주입 (pdf.js 지연 로드 / 워커 메인 스레드 폴백). document가 없으면 실패
  function injectScript(src, integrity) {
    var d = doc();
    if (!d || typeof d.createElement !== 'function') return Promise.reject(new Error('document unavailable'));
    return withTimeout(new Promise(function (resolve, reject) {
      var s = d.createElement('script');
      s.src = src;
      if (integrity) {
        s.integrity = integrity;
        s.crossOrigin = 'anonymous';
      }
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () {
        if (s.parentNode) s.parentNode.removeChild(s);
        reject(new Error('script load failed: ' + src));
      };
      (d.head || d.documentElement || d.body).appendChild(s);
    }), LOAD_TIMEOUT_MS, 'script load');
  }

  // ── pdf.js 준비 (P1-6) ────────────────────────────────────────────────
  var libPromise = null;   // 지연 로드 진행 중인 Promise (실패하면 비움)

  function ensureLib() {
    if (isReady()) return Promise.resolve(lib());
    var p = lib();
    if (p && p.version !== PDFJS.version) {
      // 다른 버전이 이미 올라와 있으면 섞어 쓰지 않는다
      return Promise.reject(PdfExtractError('LIB_LOAD_FAILED', 'pdfjsLib version mismatch: ' + p.version));
    }
    if (!libPromise) {
      libPromise = injectScript(PDFJS.libSrc, PDFJS.libIntegrity).then(function () {
        if (!isReady()) throw new Error('pdfjsLib missing after load');
        return lib();
      });
      libPromise.catch(function () { libPromise = null; });
    }
    return libPromise.catch(function (e) {
      throw PdfExtractError('LIB_LOAD_FAILED', 'pdfjsLib unavailable (' + describe(e) + ')');
    });
  }

  var extractQueue = Promise.resolve();   // extractText 순서 잠금 (공유 워커 포트 보호)
  var DESTROY_WAIT_MS = 10000;

  var workerMode = null;        // 'preloaded' | 'worker' | 'main' — 준비 성공 시에만 기억 (P1-6 (4))
  var workerPromise = null;     // 준비 진행 중인 Promise (동시 호출 공유, 실패하면 비움)
  var workerBlobUrl = null;     // ①에서 받은(SRI 검증된) 워커 코드의 Blob URL. ②에서 재사용
  var WORKER_READY_MS = 15000;  // 새 Worker가 'ready'를 보낼 때까지 기다리는 한도

  function hasMainThreadWorker() {
    try { return !!(root.pdfjsWorker && root.pdfjsWorker.WorkerMessageHandler); } catch (e) { return false; }
  }

  // 워커 스크립트를 SRI integrity와 함께 받아 Blob URL로 만든다 (한 번 성공하면 재사용)
  function fetchWorkerBlobUrl() {
    if (workerBlobUrl) return Promise.resolve(workerBlobUrl);
    var fetchFn = root.fetch;
    var BlobCtor = root.Blob;
    var URLCtor = root.URL;
    if (typeof fetchFn !== 'function') return Promise.reject(new Error('fetch unavailable'));
    if (typeof BlobCtor !== 'function' || !URLCtor || typeof URLCtor.createObjectURL !== 'function') {
      return Promise.reject(new Error('Blob URL unavailable'));
    }
    var req = Promise.resolve().then(function () {
      return fetchFn.call(root, PDFJS.workerSrc, {
        integrity: PDFJS.workerIntegrity, mode: 'cors', credentials: 'omit', cache: 'force-cache'
      });
    });
    return withTimeout(req.then(function (res) {
      if (!res || !res.ok) throw new Error('worker fetch HTTP ' + (res && res.status));
      return res.text();
    }), LOAD_TIMEOUT_MS, 'worker fetch').then(function (code) {
      if (typeof code !== 'string' || code.length < 1000) throw new Error('worker script empty');
      workerBlobUrl = URLCtor.createObjectURL(new BlobCtor([code], { type: 'text/javascript' }));
      return workerBlobUrl;
    });
  }

  // ① Blob URL로 진짜 Worker를 만들고 GlobalWorkerOptions.workerPort로 넘긴다.
  //    workerSrc에 Blob URL을 넣으면 file:// 페이지에서는 pdf.js의 isSameOrigin 검사("file://" ≠ "null")에 걸려
  //    importScripts 래퍼로 감싸지고, 그 래퍼가 NetworkError로 실패해 항상 메인 스레드로 떨어진다 (QA BUG-2).
  //    workerPort를 직접 주면 그 검사를 거치지 않는다. 워커가 'ready' 메시지를 보내야 성공으로 본다.
  function prepareRealWorker(pdfjs) {
    var WorkerCtor = root.Worker;
    if (typeof WorkerCtor !== 'function') return Promise.reject(new Error('Worker unavailable'));
    return fetchWorkerBlobUrl().then(function (url) {
      return new Promise(function (resolve, reject) {
        var w;
        try { w = new WorkerCtor(url); } catch (e) { reject(e); return; }
        var timer = setTimeout(function () { fail(new Error('worker ready timeout ' + WORKER_READY_MS + 'ms')); }, WORKER_READY_MS);
        function done() {
          clearTimeout(timer);
          w.removeEventListener('message', onMsg);
          w.removeEventListener('error', onErr);
        }
        function fail(e) {
          done();
          try { w.terminate(); } catch (x) { /* 무시 */ }
          reject(e);
        }
        function onMsg(ev) {
          var d = ev && ev.data;
          if (d && d.action === 'ready') {   // pdf.worker의 WorkerMessageHandler.initializeFromPort가 보내는 첫 메시지
            done();
            pdfjs.GlobalWorkerOptions.workerPort = w;   // 페이지가 살아 있는 동안 이 워커 하나를 계속 쓴다
            resolve('worker');
          }
        }
        function onErr(ev) {
          if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
          fail(new Error('worker error: ' + ((ev && ev.message) || 'error event')));
        }
        w.addEventListener('message', onMsg);
        w.addEventListener('error', onErr);
      });
    });
  }

  // ② 메인 스레드 처리: 워커 코드를 <script>로 넣어 window.pdfjsWorker를 만든다.
  //    ①에서 SRI 검증을 마친 Blob URL이 있으면 그것을(다운로드 1회 절약), 없으면 CDN 주소를 integrity와 함께 넣는다.
  function prepareMainThreadWorker(pdfjs) {
    var first = workerBlobUrl
      ? injectScript(workerBlobUrl, null).then(function () { if (!hasMainThreadWorker()) throw new Error('pdfjsWorker missing'); })
      : Promise.reject(new Error('no blob'));
    return first.catch(function () {
      return injectScript(PDFJS.workerSrc, PDFJS.workerIntegrity);
    }).then(function () {
      if (!hasMainThreadWorker()) throw new Error('pdfjsWorker missing after load');
      if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = PDFJS.workerSrc;
      return 'main';
    });
  }

  function ensureWorker(pdfjs) {
    if (workerMode) return Promise.resolve(workerMode);
    if (!workerPromise) {
      workerPromise = Promise.resolve().then(function () {
        if (!pdfjs.GlobalWorkerOptions) throw new Error('GlobalWorkerOptions missing');
        // ⓪ 이미 워커 포트나 메인 스레드용 워커 코드가 있으면 그대로 쓴다
        if (pdfjs.GlobalWorkerOptions.workerPort) return 'worker';
        if (hasMainThreadWorker()) return 'preloaded';
        return prepareRealWorker(pdfjs).catch(function (e1) {
          return prepareMainThreadWorker(pdfjs).catch(function (e2) {
            throw new Error('worker: ' + describe(e1) + ' / script: ' + describe(e2));
          });
        });
      }).then(function (mode) {
        workerMode = mode;
        return mode;
      }, function (e) {
        workerPromise = null;   // ③ 실패는 기억하지 않는다 (다시 시도 가능)
        throw PdfExtractError('LIB_LOAD_FAILED', 'worker setup failed (' + describe(e) + ')');
      });
    }
    return workerPromise;
  }

  // ── 파일 읽기 ─────────────────────────────────────────────────────────
  function readSlice(file, start, end) {
    var part = file.slice(start, end);
    if (!part || typeof part.arrayBuffer !== 'function') throw new Error('slice().arrayBuffer unavailable');
    return part.arrayBuffer();
  }

  function readAll(file) {
    return Promise.resolve().then(function () {
      if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
      return readSlice(file, 0, file.size);
    });
  }

  function hasPdfHeader(buf) {
    var bytes = new Uint8Array(buf);
    var sig = [0x25, 0x50, 0x44, 0x46, 0x2d];   // "%PDF-"
    var n = Math.min(bytes.length, LIMITS.headerScanBytes);
    for (var i = 0; i + sig.length <= n; i++) {
      var ok = true;
      for (var j = 0; j < sig.length; j++) if (bytes[i + j] !== sig[j]) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  }

  // ── validateFile (P1-5) ───────────────────────────────────────────────
  function validateFile(file) {
    return Promise.resolve().then(function () {
      // 1) 파일 없음
      if (file === null || file === undefined) throw PdfExtractError('NO_FILE');
      if (typeof file !== 'object' && typeof file !== 'function') throw PdfExtractError('NO_FILE', 'not a file object');
      var name = typeof file.name === 'string' ? file.name : '';
      var size = file.size;
      if (typeof size !== 'number' || !isFinite(size) || size < 0) throw PdfExtractError('NO_FILE', 'invalid size');
      // 2) 확장자 (대소문자 무시)
      if (!/\.pdf$/i.test(name)) throw PdfExtractError('NOT_PDF', 'extension is not .pdf');
      // 3) 빈 파일
      if (size === 0) throw PdfExtractError('EMPTY_FILE');
      // 4) 크기 상한 — 파일 내용은 읽지 않는다
      if (size > LIMITS.maxBytes) throw PdfExtractError('FILE_TOO_LARGE', 'size ' + size + ' > ' + LIMITS.maxBytes);
      // 5) 앞 headerScanBytes 바이트 안에 "%PDF-"
      if (typeof file.slice !== 'function') throw PdfExtractError('NO_FILE', 'file.slice unavailable');
      return Promise.resolve()
        .then(function () { return readSlice(file, 0, Math.min(size, LIMITS.headerScanBytes)); })
        .then(function (buf) {
          if (!hasPdfHeader(buf)) throw PdfExtractError('NOT_PDF', 'no %PDF- header in first ' + LIMITS.headerScanBytes + ' bytes');
          return { name: name, size: size };
        }, function (e) {
          if (isOurError(e)) throw e;
          throw PdfExtractError('EXTRACT_FAILED', 'header read failed (' + describe(e) + ')');
        });
    });
  }

  // ── normalizePageText (P1-8) ──────────────────────────────────────────
  // str을 이어 붙이고 hasEOL이면 "\n". \n을 뺀 연속 공백은 한 칸, 줄 앞뒤 공백 제거,
  // 3줄 이상 연속 줄바꿈(빈 줄 2개 이상)은 2줄로, 전체 앞뒤 공백 제거.
  function normalizePageText(items) {
    if (!items || typeof items.length !== 'number') return '';
    var out = '';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it) continue;
      if (typeof it.str === 'string') out += it.str;   // TextMarkedContent 항목(str 없음)은 건너뜀
      if (it.hasEOL) out += '\n';
    }
    return out
      .replace(/[\u0000-\u0008\u000E-\u001F\u007F]/g, '')   // 제어 문자 제거 (\t \n \v \f \r은 아래에서 처리)
      .replace(/[^\S\n]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // ── classifyError (P1-10, P1-11) ──────────────────────────────────────
  function classifyError(err) {
    if (isOurError(err)) {
      if (err instanceof PdfExtractError) return err;
      var copy = PdfExtractError(err.code, err.detail);   // 다른 realm에서 온 경우 우리 클래스로 다시 만든다
      return copy;
    }
    var name = err && err.name ? String(err.name) : '';
    var msg = err && err.message ? String(err.message) : '';
    var detail = describe(err);
    if (name === 'PasswordException') return PdfExtractError('ENCRYPTED', detail);
    if (name === 'InvalidPDFException' || name === 'FormatError') return PdfExtractError('CORRUPTED', detail);
    if (name === 'MissingPDFException' || name === 'UnexpectedResponseException') return PdfExtractError('CORRUPTED', detail);
    if (name === 'AbortException' || name === 'AbortError') return PdfExtractError('ABORTED', detail);
    // 계약 확장: pdf.js가 워커를 끝내 못 띄운 경우는 "워커 준비 실패"이므로 LIB_LOAD_FAILED
    if (/Setting up fake worker failed/i.test(msg)) return PdfExtractError('LIB_LOAD_FAILED', detail);
    return PdfExtractError('EXTRACT_FAILED', detail);
  }

  function cleanTitle(v) {
    if (typeof v !== 'string') return null;
    var t = v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
    return t ? t : null;
  }

  function nonSpaceLength(s) { return s.replace(/\s/g, '').length; }

  // ── extractText (P1-6 ~ P1-12, P1-21) ─────────────────────────────────
  function extractText(file, opts) {
    opts = opts || {};
    var signal = opts.signal || null;
    var onProgress = opts.onProgress;
    var loadingTask = null;
    var pdfDoc = null;
    var onAbort = null;
    var destroyPromise = null;   // destroy는 한 번만 (취소 리스너와 정리 단계가 공유)
    // 순서 잠금: 내 차례(myTurn)는 앞 호출이 잠금을 풀 때. 나는 destroy가 끝나면 잠금을 푼다
    var releaseTurn;
    var myGate = new Promise(function (r) { releaseTurn = r; });
    var myTurn = extractQueue;
    extractQueue = extractQueue.then(function () { return myGate; });

    function checkAbort() { if (signal && signal.aborted) throw PdfExtractError('ABORTED'); }

    var run = Promise.resolve().then(function () {
      // 이미 abort된 signal → 파일도 읽지 않는다 (PRD 3.0)
      checkAbort();
      return raceAbort(validateFile(file), signal);
    }).then(function (info) {
      checkAbort();
      return raceAbort(ensureLib(), signal).then(function (pdfjs) {
        return raceAbort(ensureWorker(pdfjs), signal).then(function () {
          checkAbort();
          return raceAbort(readAll(file), signal).then(function (buf) {
            checkAbort();
            // 워커 포트를 공유하므로 앞 문서의 처리·destroy가 끝날 때까지 기다린다
            return raceAbort(myTurn, signal).then(function () {
              checkAbort();
              return { info: info, pdfjs: pdfjs, buf: buf };
            });
          });
        });
      });
    }).then(function (ctx) {
      safeProgress(onProgress, { stage: 'load' });
      // P1-7 / PN1-4: eval 금지, CMap 지정, 시스템 폰트 미사용. 렌더링은 하지 않는다
      loadingTask = ctx.pdfjs.getDocument({
        data: new Uint8Array(ctx.buf),
        isEvalSupported: false,
        cMapUrl: PDFJS.cMapUrl,
        cMapPacked: true,
        standardFontDataUrl: PDFJS.standardFontDataUrl,
        useSystemFonts: false,
        // 경고 로그(손상 PDF의 "Indexing all PDF objects" 등)는 콘솔에 남기지 않는다. 오류는 코드로 전달됨
        verbosity: ctx.pdfjs.VerbosityLevel ? ctx.pdfjs.VerbosityLevel.ERRORS : 0
      });
      ctx.buf = null;
      if (signal) {
        onAbort = function () { destroyOnce(); };
        signal.addEventListener('abort', onAbort);
      }
      return raceAbort(loadingTask.promise, signal).then(function (d) {
        pdfDoc = d;
        ctx.doc = d;
        return ctx;
      });
    }).then(function (ctx) {
      var pageCount = ctx.doc.numPages;
      // P1-9: 텍스트 추출 전에 쪽수 판정
      if (!(pageCount >= 1)) throw PdfExtractError('CORRUPTED', 'numPages=' + pageCount);
      if (pageCount > LIMITS.maxPages) throw PdfExtractError('TOO_MANY_PAGES', 'numPages=' + pageCount);

      var pages = [];
      function step(n) {
        if (n > pageCount) return Promise.resolve();
        checkAbort();   // 남은 쪽 getPage 0회 (P1-21 (3))
        return raceAbort(ctx.doc.getPage(n), signal).then(function (page) {
          checkAbort();
          return raceAbort(page.getTextContent(), signal).then(function (tc) {
            pages.push({ pageNumber: n, text: normalizePageText(tc && tc.items) });
            try { if (typeof page.cleanup === 'function') page.cleanup(); } catch (e) { /* 무시 */ }
            safeProgress(onProgress, { stage: 'page', page: n, pageCount: pageCount });
            return yieldToLoop();
          });
        }).then(function () { return step(n + 1); });
      }

      return step(1).then(function () {
        checkAbort();
        return raceAbort(Promise.resolve().then(function () { return ctx.doc.getMetadata(); })
          .catch(function () { return null; }), signal);
      }).then(function (meta) {
        var title = null;
        if (meta) {
          title = cleanTitle(meta.info && meta.info.Title);
          if (!title && meta.metadata && typeof meta.metadata.get === 'function') {
            try { title = cleanTitle(meta.metadata.get('dc:title')); } catch (e) { /* 무시 */ }
          }
        }
        var text = pages.map(function (p) { return p.text; }).join('\n\n');
        var charCount = nonSpaceLength(text);
        // P1-12 (1): 글자가 거의 없으면 스캔 PDF로 보고 거부
        if (charCount < LIMITS.minTextChars) throw PdfExtractError('NO_TEXT', 'charCount=' + charCount + ', pages=' + pageCount);
        var emptyPages = [];
        pages.forEach(function (p) { if (nonSpaceLength(p.text) < EMPTY_PAGE_CHARS) emptyPages.push(p.pageNumber); });
        var warnings = [];
        // P1-12 (2): 빈 쪽이 절반 이상이면 경고
        if (emptyPages.length * 2 >= pageCount) warnings.push('PARTIAL_TEXT');
        return {
          fileName: ctx.info.name,
          fileSize: ctx.info.size,
          pageCount: pageCount,
          pages: pages,
          text: text,
          charCount: charCount,
          emptyPages: emptyPages,
          warnings: warnings,
          title: title
        };
      });
    });

    return run.then(function (result) {
      return cleanup().then(function () { return result; });
    }, function (e) {
      var err = (signal && signal.aborted) ? PdfExtractError('ABORTED', isOurError(e) ? e.detail : describe(e)) : classifyError(e);
      return cleanup().then(function () { throw err; });
    });

    // PN1-12: 성공·실패·취소 모두 pdf.js 자원 해제
    function cleanup() {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      // 다음 문서는 destroy가 실제로 끝난 뒤(최대 DESTROY_WAIT_MS) 연다. pdf.js 3.x는 공유 포트가 destroy 중이면
      // 다음 getDocument에서 "the worker is being destroyed"를 던진다
      withTimeout(destroyOnce(), DESTROY_WAIT_MS, 'destroy').catch(function () {}).then(function () { releaseTurn(); });
      // 호출 측에는 destroy가 오래 걸려도 결과를 늦게 주지 않는다
      return withTimeout(destroyOnce(), 2000, 'destroy').catch(function () {});
    }

    function destroyOnce() {
      if (!destroyPromise) {
        var p = null;
        try {
          if (loadingTask && typeof loadingTask.destroy === 'function') p = loadingTask.destroy();
          else if (pdfDoc && typeof pdfDoc.destroy === 'function') p = pdfDoc.destroy();
        } catch (e) { p = null; }
        destroyPromise = Promise.resolve(p).catch(function () {});
      }
      return destroyPromise;
    }
  }

  root.PdfExtract = {
    LIMITS: LIMITS,
    PDFJS: PDFJS,
    MESSAGES: MESSAGES,
    PdfExtractError: PdfExtractError,
    isReady: isReady,
    validateFile: validateFile,
    extractText: extractText,
    normalizePageText: normalizePageText,
    classifyError: classifyError,
    // 테스트용: 워커 준비 상태 확인·초기화
    _internal: {
      getWorkerMode: function () { return workerMode; },
      resetWorker: function () { workerMode = null; workerPromise = null; libPromise = null; workerBlobUrl = null; }
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
