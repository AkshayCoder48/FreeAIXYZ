/**
 * FreeGPT.tech WASM signer — loaded from the backup host.
 * Generates the secure payload needed for FreeGPT API authentication.
 */

const fs = require('fs');
const path = require('path');

let wasmInstance = null;
let cachedMemory = null;
let cachedDataView = null;
let WASM_VECTOR_LEN = 0;

function getDataViewMemory0() {
  if (cachedDataView === null || cachedDataView.buffer.detached === true || (cachedDataView.buffer.detached === undefined && cachedMemory.buffer !== cachedDataView.buffer)) {
    cachedDataView = new DataView(wasmInstance.exports.memory.buffer);
  }
  return cachedDataView;
}

function getStringFromWasm0(ptr, len) {
  return Buffer.from(wasmInstance.exports.memory.buffer, ptr, len).toString();
}

function passStringToWasm0(arg, malloc, realloc) {
  const buf = Buffer.from(arg, 'utf8');
  const len = buf.length;
  let ptr = malloc(len, 1);
  Buffer.from(wasmInstance.exports.memory.buffer, ptr, len).set(buf);
  WASM_VECTOR_LEN = len;
  return ptr;
}

// Mock browser APIs for canvas fingerprinting
function createCanvasMock() {
  return {
    width: 200,
    height: 200,
    getContext: () => ({
      fillStyle: '',
      font: '14px Arial',
      fillRect: () => {},
      fillText: () => {},
    }),
    toDataURL: () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAABhGlDQ1BJQ0MgcHJvZmlsZQAAeJx9kT1Iw0AcxV/TSoUi',
  };
}

const windowMock = {
  document: {
    createElement: (tag) => tag === 'canvas' ? createCanvasMock() : {},
  },
};

const externrefTable = [];

async function loadWasm(wasmPath) {
  if (wasmInstance) return wasmInstance;
  
  const wasmBuffer = fs.readFileSync(wasmPath);
  const wasmModule = new WebAssembly.Module(wasmBuffer);
  
  const imports = {
    './wasm_signer_bg.js': {
      __wbg_set_6be42768c690e380: (obj, key, val) => { if (obj) obj[key] = val; },
      __wbg_String_8564e559799eccda: (arg0, arg1) => String(arg1),
      __wbg_instanceof_Window_23e677d2c6843922: (arg0) => arg0 === windowMock,
      __wbg_document_c0320cd4183c6d9b: (arg0) => arg0?.document || windowMock.document,
      __wbg_createElement_9b0aab265c549ded: (arg0, arg1, arg2) => {
        const tag = getStringFromWasm0(arg1, arg2);
        return windowMock.document.createElement(tag);
      },
      __wbg_set_height_b6548a01bdcb689a: (arg0, arg1) => { if (arg0) arg0.height = arg1; },
      __wbg_getContext_f04bf8f22dcb2d53: (arg0, arg1, arg2) => arg0?.getContext?.() || null,
      __wbg_toDataURL_bf99d85b39ce57cc: (arg0) => arg0?.toDataURL?.() || '',
      __wbg_set_width_c0fcaa2da53cd540: (arg0, arg1) => { if (arg0) arg0.width = arg1; },
      __wbg_instanceof_HtmlCanvasElement_26125339f936be50: (arg0) => arg0?.toDataURL !== undefined,
      __wbg_instanceof_CanvasRenderingContext2d_08b9d193c22fa886: (arg0) => arg0?.fillRect !== undefined,
      __wbg_set_fillStyle_58417b6b548ae475: (arg0, arg1, arg2) => { if (arg0) arg0.fillStyle = ''; },
      __wbg_set_font_b038797b3573ae5e: (arg0, arg1, arg2) => { if (arg0) arg0.font = ''; },
      __wbg_fillRect_4e5596ca954226e7: () => {},
      __wbg_fillText_b1722b6179692b85: () => {},
      __wbg_new_ab79df5bd7c26067: () => ({}),
      __wbg_static_accessor_GLOBAL_THIS_ad356e0db91c7913: () => globalThis,
      __wbg_static_accessor_SELF_f207c857566db248: () => globalThis,
      __wbg_static_accessor_GLOBAL_8adb955bd33fac2f: () => globalThis,
      __wbg_static_accessor_WINDOW_bb9f1ba69d61b386: () => windowMock,
      __wbg_random_5bb86cae65a45bf6: () => Math.random(),
      __wbg___wbindgen_throw_6ddd609b62940d55: (arg0, arg1) => {
        throw new Error(getStringFromWasm0(arg0, arg1));
      },
      __wbg_Error_83742b46f01ce22d: (arg0, arg1) => new Error(getStringFromWasm0(arg0, arg1)),
      __wbg___wbindgen_is_undefined_52709e72fb9f179c: (arg0) => arg0 === undefined,
      __wbindgen_init_externref_table: () => {},
      __wbindgen_cast_0000000000000001: (val) => val,
      __wbindgen_cast_0000000000000002: (val) => val,
      __wbindgen_cast_0000000000000003: (val) => val,
    }
  };

  const { instance } = await WebAssembly.instantiate(wasmModule, imports);
  wasmInstance = instance.exports;
  cachedMemory = wasmInstance.memory;
  
  // Call start if available
  if (wasmInstance.__wbindgen_start) {
    wasmInstance.__wbindgen_start();
  }
  
  return wasmInstance;
}

function generateSecurePayload(username, timestamp, nonce, challenge, clientIp, difficulty) {
  if (!wasmInstance) throw new Error('WASM not loaded. Call loadWasm() first.');
  
  const wasm = wasmInstance;
  
  const ptr0 = passStringToWasm0(username, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
  const len0 = WASM_VECTOR_LEN;
  const ptr1 = passStringToWasm0(timestamp, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
  const len1 = WASM_VECTOR_LEN;
  const ptr2 = passStringToWasm0(nonce, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
  const len2 = WASM_VECTOR_LEN;
  const ptr3 = passStringToWasm0(challenge, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
  const len3 = WASM_VECTOR_LEN;
  const ptr4 = passStringToWasm0(clientIp, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
  const len4 = WASM_VECTOR_LEN;
  
  const ret = wasm.generate_secure_payload(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, difficulty);
  
  // ret is [ptr, len, is_err]
  const resultPtr = getDataViewMemory0().getInt32(ret / 4 * 4, true);
  const resultLen = getDataViewMemory0().getInt32(ret / 4 * 4 + 4, true);
  const isError = getDataViewMemory0().getInt32(ret / 4 * 4 + 8, true);
  
  if (isError) {
    throw new Error(getStringFromWasm0(resultPtr, resultLen));
  }
  
  // The result is a JSON string
  const resultJson = getStringFromWasm0(resultPtr, resultLen);
  return JSON.parse(resultJson);
}

module.exports = { loadWasm, generateSecurePayload };
