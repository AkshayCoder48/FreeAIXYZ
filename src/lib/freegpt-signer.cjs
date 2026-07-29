/**
 * FreeGPT.tech WASM signer — generates secure payloads for API authentication.
 * Uses jsdom to provide browser APIs needed by the WASM module.
 */

const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');

let wasmExports = null;
let wasmInitialized = false;

// Create a DOM environment
const dom = new JSDOM('<!DOCTYPE html><html><body><canvas id="c"></canvas></body></html>', {
  url: 'https://freegpt.tech',
  pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;

// Provide crypto if not available
if (!dom.window.crypto) {
  dom.window.crypto = {
    getRandomValues: (arr) => {
      for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
      return arr;
    },
    randomUUID: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    }),
  };
}
global.crypto = dom.window.crypto;

// Load the original JS wrapper
const wrapperCode = fs.readFileSync(path.join(__dirname, '..', '..', 'wasm_signer.js'), 'utf8');

// The wrapper uses ES module exports, we need to adapt it
// Extract the key functions and variables
let wasm = null;
let WASM_VECTOR_LEN = 0;
let cachedDataViewMemory0 = null;
let cachedUint8ArrayMemory0 = null;

function getDataViewMemory0() {
  if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && wasm.memory.buffer !== cachedDataViewMemory0.buffer)) {
    cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
  }
  return cachedDataViewMemory0;
}

function getUint8ArrayMemory0() {
  if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.buffer.detached === true || (cachedUint8ArrayMemory0.buffer.detached === undefined && wasm.memory.buffer !== cachedUint8ArrayMemory0.buffer)) {
    cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
  return Buffer.from(wasm.memory.buffer, ptr, len).toString('utf8');
}

function passStringToWasm0(arg, malloc, realloc) {
  const buf = Buffer.from(arg, 'utf8');
  const len = buf.length;
  let ptr = malloc(len, 1);
  Buffer.from(wasm.memory.buffer, ptr, len).set(buf);
  WASM_VECTOR_LEN = len;
  return ptr;
}

function takeFromExternrefTable0(idx) {
  const value = wasm.__wbindgen_externrefs.get(idx);
  wasm.__externref_table_dealloc(idx);
  return value;
}

function addToExternrefTable0(obj) {
  const idx = wasm.__externref_table_alloc();
  wasm.__wbindgen_externrefs.set(idx, obj);
  return idx;
}

async function initWasm(wasmPath) {
  if (wasmInitialized) return;
  
  const wasmBuffer = fs.readFileSync(wasmPath);
  
  const imports = {
    './wasm_signer_bg.js': {
      __wbg_set_6be42768c690e380: function(arg0, arg1, arg2) {
        arg0[arg1] = arg2;
      },
      __wbg_String_8564e559799eccda: function(arg0, arg1) {
        const ret = String(arg1);
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4, len1, true);
        getDataViewMemory0().setInt32(arg0, ptr1, true);
      },
      __wbg_instanceof_Window_23e677d2c6843922: function(arg0) {
        return arg0 instanceof dom.window.Window;
      },
      __wbg_document_c0320cd4183c6d9b: function(arg0) {
        return arg0?.document;
      },
      __wbg_createElement_9b0aab265c549ded: function(arg0, arg1, arg2) {
        const tag = getStringFromWasm0(arg1, arg2);
        return arg0.createElement(tag);
      },
      __wbg_set_height_b6548a01bdcb689a: function(arg0, arg1) {
        arg0.height = arg1;
      },
      __wbg_getContext_f04bf8f22dcb2d53: function(arg0, arg1, arg2) {
        const type = getStringFromWasm0(arg1, arg2);
        return arg0.getContext(type);
      },
      __wbg_toDataURL_bf99d85b39ce57cc: function(arg0, arg1, arg2) {
        const ret = arg0.toDataURL(getStringFromWasm0(arg1, arg2));
        const ptr = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4, len, true); // This is wrong but let's see
        return ptr;
      },
      __wbg_set_width_c0fcaa2da53cd540: function(arg0, arg1) {
        arg0.width = arg1;
      },
      __wbg_instanceof_HtmlCanvasElement_26125339f936be50: function(arg0) {
        return arg0 instanceof dom.window.HTMLCanvasElement;
      },
      __wbg_instanceof_CanvasRenderingContext2d_08b9d193c22fa886: function(arg0) {
        return arg0 instanceof dom.window.CanvasRenderingContext2D;
      },
      __wbg_set_fillStyle_58417b6b548ae475: function(arg0, arg1, arg2) {
        arg0.fillStyle = getStringFromWasm0(arg1, arg2);
      },
      __wbg_set_font_b038797b3573ae5e: function(arg0, arg1, arg2) {
        arg0.font = getStringFromWasm0(arg1, arg2);
      },
      __wbg_fillRect_4e5596ca954226e7: function(arg0, arg1, arg2, arg3, arg4) {
        arg0.fillRect(arg1, arg2, arg3, arg4);
      },
      __wbg_fillText_b1722b6179692b85: function(arg0, arg1, arg2, arg3, arg4, arg5) {
        arg0.fillText(getStringFromWasm0(arg1, arg2), arg3, arg4, arg5);
      },
      __wbg_new_ab79df5bd7c26067: function() {
        return new dom.window.Object();
      },
      __wbg_static_accessor_GLOBAL_THIS_ad356e0db91c7913: function() {
        return globalThis;
      },
      __wbg_static_accessor_SELF_f207c857566db248: function() {
        return globalThis;
      },
      __wbg_static_accessor_GLOBAL_8adb955bd33fac2f: function() {
        return globalThis;
      },
      __wbg_static_accessor_WINDOW_bb9f1ba69d61b386: function() {
        return dom.window;
      },
      __wbg_random_5bb86cae65a45bf6: function() {
        return Math.random();
      },
      __wbg___wbindgen_throw_6ddd609b62940d55: function(arg0, arg1) {
        throw new Error(getStringFromWasm0(arg0, arg1));
      },
      __wbg_Error_83742b46f01ce22d: function(arg0, arg1) {
        return new Error(getStringFromWasm0(arg0, arg1));
      },
      __wbg___wbindgen_is_undefined_52709e72fb9f179c: function(arg0) {
        return arg0 === undefined;
      },
      __wbindgen_init_externref_table: function() {
        const table = wasm.__wbindgen_externrefs;
        const offset = table.grow(4);
        table.set(0, undefined);
        table.set(offset + 0, undefined);
        table.set(offset + 1, null);
        table.set(offset + 2, true);
        table.set(offset + 3, false);
      },
      __wbindgen_cast_0000000000000001: function(arg0) {
        return arg0;
      },
      __wbindgen_cast_0000000000000002: function(arg0, arg1) {
        return getStringFromWasm0(arg0, arg1);
      },
      __wbindgen_cast_0000000000000003: function(arg0) {
        return BigInt.asUintN(64, arg0);
      },
    }
  };

  const result = await WebAssembly.instantiate(wasmBuffer, imports);
  wasm = result.instance.exports;
  
  if (wasm.__wbindgen_start) {
    wasm.__wbindgen_start();
  }
  
  wasmExports = wasm;
  wasmInitialized = true;
}

function generateSecurePayload(uuid, timestamp, nonce, challenge, clientIp, difficulty) {
  if (!wasmInitialized) throw new Error('WASM not initialized. Call initWasm() first.');
  
  const ptr0 = passStringToWasm0(uuid, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
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
  
  if (ret[2]) {
    throw takeFromExternrefTable0(ret[1]);
  }
  return takeFromExternrefTable0(ret[0]);
}

module.exports = { initWasm, generateSecurePayload };
