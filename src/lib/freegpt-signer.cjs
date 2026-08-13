/**
 * FreeGPT.tech WASM signer — generates secure payloads for API authentication.
 * Uses lightweight browser API mocks (no jsdom dependency) for serverless compatibility.
 */

const fs = require('fs');
const path = require('path');

let wasm = null;
let wasmInitialized = false;
let WASM_VECTOR_LEN = 0;
let cachedDataViewMemory0 = null;
let cachedUint8ArrayMemory0 = null;

// --- Lightweight browser API mocks (no jsdom needed) ---

// Canvas mock — returns a fixed fingerprint data URL
function createCanvasMock() {
  const ctx = {
    fillStyle: '',
    font: '14px Arial',
    fillRect: function() {},
    fillText: function() {},
  };
  return {
    width: 200,
    height: 200,
    getContext: function() { return ctx; },
    toDataURL: function() {
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAoCAYAAACM/rhtAAABhGlDQ1BJQ0MgcHJvZmlsZQAAeJx9kT1Iw0AcxV/TSoUi';
    },
  };
}

// Document mock — includes querySelector/querySelectorAll to avoid breaking
// Next.js SSR which checks for these methods on global.document.
const documentMock = {
  createElement: function(tag) {
    if (tag === 'canvas') return createCanvasMock();
    return { style: {}, setAttribute: function() {}, appendChild: function() {} };
  },
  querySelector: function() { return null; },
  querySelectorAll: function() { return []; },
  getElementById: function() { return null; },
  getElementsByClassName: function() { return []; },
  getElementsByTagName: function() { return []; },
  body: null,
  head: null,
  documentElement: null,
};

// Window mock
const windowMock = {
  document: documentMock,
  Object: Object,
  Array: Array,
  String: String,
  Number: Number,
  Boolean: Boolean,
  Math: Math,
  Date: Date,
  JSON: JSON,
  Error: Error,
  Uint8Array: Uint8Array,
  Uint32Array: Uint32Array,
  DataView: DataView,
  ArrayBuffer: ArrayBuffer,
  TextEncoder: TextEncoder,
  TextDecoder: TextDecoder,
  Buffer: Buffer,
  location: {
    href: "https://freegpt.tech/",
    protocol: "https:",
    host: "freegpt.tech",
    hostname: "freegpt.tech",
    port: "",
    pathname: "/",
    search: "",
    hash: "",
    origin: "https://freegpt.tech",
  },
  navigator: {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    platform: "Linux x86_64",
    language: "en-US",
  },
};

// Set globals only when needed (not at module load time)
// to avoid polluting Next.js's SSR environment.

/** Temporarily install browser globals for WASM execution. */
function installGlobals() {
  if (typeof global.window === 'undefined') global.window = windowMock;
  if (typeof global.document === 'undefined') global.document = documentMock;
}

/** Remove browser globals after WASM execution. */
function removeGlobals() {
  if (global.window === windowMock) delete global.window;
  if (global.document === documentMock) delete global.document;
}

// --- WASM helper functions ---

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

// --- WASM initialization ---

async function initWasm(wasmPath) {
  if (wasmInitialized) return;

  // Temporarily install globals for WASM init
  installGlobals();

  // Resolve path relative to project root
  let resolvedPath = wasmPath;
  if (!fs.existsSync(resolvedPath)) {
    // Try relative to this file
    resolvedPath = path.resolve(__dirname, '..', '..', wasmPath);
  }
  if (!fs.existsSync(resolvedPath)) {
    // Try relative to cwd
    resolvedPath = path.join(process.cwd(), wasmPath);
  }
  if (!fs.existsSync(resolvedPath)) {
    // Try just the filename in cwd
    resolvedPath = path.join(process.cwd(), path.basename(wasmPath));
  }

  const wasmBuffer = fs.readFileSync(resolvedPath);

  const imports = {
    './wasm_signer_bg.js': {
      __wbg_set_6be42768c690e380: function(arg0, arg1, arg2) {
        if (arg0) arg0[arg1] = arg2;
      },
      __wbg_String_8564e559799eccda: function(arg0, arg1) {
        const ret = String(arg1);
        const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        getDataViewMemory0().setInt32(arg0 + 4, len1, true);
        getDataViewMemory0().setInt32(arg0, ptr1, true);
      },
      __wbg_instanceof_Window_23e677d2c6843922: function(arg0) {
        return arg0 === windowMock;
      },
      __wbg_document_c0320cd4183c6d9b: function(arg0) {
        return arg0 ? arg0.document : documentMock;
      },
      __wbg_createElement_9b0aab265c549ded: function(arg0, arg1, arg2) {
        const tag = getStringFromWasm0(arg1, arg2);
        const doc = arg0 ? arg0 : documentMock;
        return doc.createElement(tag);
      },
      __wbg_set_height_b6548a01bdcb689a: function(arg0, arg1) {
        if (arg0) arg0.height = arg1;
      },
      __wbg_getContext_f04bf8f22dcb2d53: function(arg0, arg1, arg2) {
        if (!arg0 || !arg0.getContext) return null;
        const type = getStringFromWasm0(arg1, arg2);
        return arg0.getContext(type);
      },
      __wbg_toDataURL_bf99d85b39ce57cc: function(arg0, arg1, arg2) {
        if (!arg0 || !arg0.toDataURL) return '';
        const type = getStringFromWasm0(arg1, arg2);
        const ret = arg0.toDataURL(type);
        const ptr = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len = WASM_VECTOR_LEN;
        // The original wrapper writes ptr/len to memory at arg0's location
        // But arg0 here is the canvas object, not a pointer
        // This is a simplification — the fingerprint will be "fp_error" which is fine
        return ptr;
      },
      __wbg_set_width_c0fcaa2da53cd540: function(arg0, arg1) {
        if (arg0) arg0.width = arg1;
      },
      __wbg_instanceof_HtmlCanvasElement_26125339f936be50: function(arg0) {
        return arg0 && typeof arg0.toDataURL === 'function';
      },
      __wbg_instanceof_CanvasRenderingContext2d_08b9d193c22fa886: function(arg0) {
        return arg0 && typeof arg0.fillRect === 'function';
      },
      __wbg_set_fillStyle_58417b6b548ae475: function(arg0, arg1, arg2) {
        if (arg0) arg0.fillStyle = getStringFromWasm0(arg1, arg2);
      },
      __wbg_set_font_b038797b3573ae5e: function(arg0, arg1, arg2) {
        if (arg0) arg0.font = getStringFromWasm0(arg1, arg2);
      },
      __wbg_fillRect_4e5596ca954226e7: function(arg0, arg1, arg2, arg3, arg4) {
        if (arg0) arg0.fillRect(arg1, arg2, arg3, arg4);
      },
      __wbg_fillText_b1722b6179692b85: function(arg0, arg1, arg2, arg3, arg4, arg5) {
        if (arg0) arg0.fillText(getStringFromWasm0(arg1, arg2), arg3, arg4, arg5);
      },
      __wbg_new_ab79df5bd7c26067: function() {
        return {};
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
        return windowMock;
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

  wasmInitialized = true;

  // Remove globals after WASM init
  removeGlobals();
}

// --- Public API ---

function generateSecurePayload(uuid, timestamp, nonce, challenge, clientIp, difficulty) {
  if (!wasmInitialized) throw new Error('WASM not initialized. Call initWasm() first.');

  // Temporarily set globals for WASM execution (it accesses window/document)
  installGlobals();

  try {
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
  } finally {
    // Remove globals after WASM execution
    removeGlobals();
  }
}

module.exports = { initWasm, generateSecurePayload };
