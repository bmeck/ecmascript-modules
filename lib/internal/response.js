'use strict';

const ArrayBufferSource = {
  __proto__: null,
  [Symbol.hasInstance](v) {
    return v instanceof Uint8Array ||
      v instanceof Uint16Array ||
      v instanceof Uint32Array ||
      v instanceof Int8Array ||
      v instanceof Int16Array ||
      v instanceof Int32Array ||
      v instanceof Float32Array ||
      v instanceof Float64Array ||
      v instanceof Uint8ClampedArray ||
      v instanceof DataView ||
      v instanceof ArrayBuffer;
  }
};
const { Blob, _BLOB_DATA } = require('internal/blob');
const { TextEncoder, TextDecoder } = require('util');
const { URL } = require('url');
const ENCODER = new TextEncoder('utf8');
const DECODER = new TextDecoder('utf8');
const RESPONSE_DATA = new WeakMap();
const HEADER_DATA = new WeakMap();
const $ = (self, map) => {
  if (!map.has(self)) {
    throw new TypeError('Invalid receiver');
  }
  return map.get(self);
};
const bufferIfBodyNotUsed = (self) => {
  const data = $(self, RESPONSE_DATA);
  if (data.bodyUsed) {
    throw new Error('body already used');
  }
  data.bodyUsed = true;
  // copy the buffer, this works but looks weird
  // most of the constructors do views instead of
  // copy
  // this is done to ensure we do as little copying as we can when
  // clone is used, could be made better with ref counting
  return new Uint8Array(new Uint8Array(data.buffer)).buffer;
}
class Response {
  constructor(body, init) {
    let buffer, type = null;
    if (typeof body === 'string') {
      buffer = ENCODER.encode(body).buffer;
      type = 'text/plain;charset=UTF-8';
    } else if (body instanceof ArrayBufferSource) {
      buffer = new Uint8Array(body).buffer;
    } else if (body instanceof Blob) {
      ({ buffer, type } = _BLOB_DATA.get(body));
    }
    const headers = new Headers(init && init.headers);
    if (headers.has('content-type') === false) {
      if (type !== null) {
        headers.append('content-type', type);
      }
    } else {
      type = headers.get('content-type');
    }
    RESPONSE_DATA.set(this, {
      __proto__: null,
      url_list: null,
      headers,
      type,
      buffer,
      bodyUsed: false,
    });
  }
  static redirect(url) {
    url = new URL(url);
    const response = primordials.Object.create(Response.prototype);
    const headers = new Headers();
    headers.append('Location', url);
    const header_data = HEADER_DATA.get(headers);
    HEADER_DATA.set(headers, {
      ...header_data,
      guard: 'immutable',
    });
    RESPONSE_DATA.set(response, {
      __proto__: null,
      url_list: [url.href],
      headers,
      type: '',
      buffer: new Uint8Array().buffer,
      bodyUsed: false,
    });
    return response;
  }
  clone() {
    const response_data = { ...$(this, RESPONSE_DATA) };
    const response = primordials.Object.create(Response.prototype);
    const headers = primordials.Object.create(Headers.prototype);
    const header_privy = $(response_data.headers, HEADER_DATA);
    const header_data = {
      guard: header_privy.guard,
      list: primordials.Array.of(header_privy.list),
    }
    HEADER_DATA.set(headers, header_data);
    response_data.headers = headers;
    RESPONSE_DATA.set(response, response_data);
    return response;
  }
  get url() {
    const { url_list } = $(this, RESPONSE_DATA);
    const last = url_list[url_list.length - 1];
    if (last) {
      return last;
    }
    return '';
  }
  get bodyUsed() {
    return $(this, RESPONSE_DATA).bodyUsed;
  }
  get headers() {
    return $(this, RESPONSE_DATA).headers;
  }
  async arrayBuffer() {
    return bufferIfBodyNotUsed(this);
  }
  async text() {
    return DECODER.decode(bufferIfBodyNotUsed(this));
  }
  async json() {
    return JSON.parse(DECODER.decode(bufferIfBodyNotUsed(this)));
  }
  async blob() {
    const { type } = $(this, RESPONSE_DATA);
    return new Blob([bufferIfBodyNotUsed(this)], { type });
  }
}
class Headers {
  constructor(init) {
    let list;
    if (init !== null && init !== undefined) {
      list = Object.entries(init).map(([k, v]) => {
        return [k.toLowerCase(), `${v}`];
      });
    } else {
      list = [];
    }
    HEADER_DATA.set(this, {
      guard: 'none',
      list
    });
  }
  append(k, v) {
    const { guard, list } = $(this, HEADER_DATA);
    if (guard === 'none') {
      list[list.length] = [k, `${v}`];
    } else {
      // this is a willful deviation to reserve some space rather than noop
      throw Error('cannot append to list');
    }
  }
  get(k) {
    const { list } = $(this, HEADER_DATA);
    const found = list.findIndex(([name]) => k === name);
    if (found === -1) return null;
    return list[found][1];
  }
  getAll(k) {
    const { list } = $(this, HEADER_DATA);
    return list.filter(([name]) => k === name).map(p => p[1]);
  }
  has(k) {
    const { list } = $(this, HEADER_DATA);
    return list.some(([name]) => {
      return k === name
    });
  }
  set(k, v) {
    const { guard, list } = $(this, HEADER_DATA);
    if (guard === 'none') {
      var i = 0;
      for (; i < list.length; i++) {
        if (list[i][0] === k) list[i][1] = `${v}`;
      }
      for (; i < list.length; i++) {
        if (list[i][0] === k) list.splice(i, 1);
        i--;
      }
    } else {
      // this is a willful deviation to reserve some space rather than noop
      throw Error('cannot append to list');
    }
  }
}
function serializeResponse(res) {
  const response_data = $(res, RESPONSE_DATA);
  const header_data = $(response_data.headers, HEADER_DATA);
  return {
    ...response_data,
    headers: header_data
  };
}
function deserializeResponse(obj) {
  const { headers: header_data, ...response_data } = obj;
  const response = primordials.Object.create(Response.prototype); 
  const headers = primordials.Object.create(Headers.prototype);
  RESPONSE_DATA.set(response, {
    ...response_data,
    headers
  });
  HEADER_DATA.set(headers, header_data);
  return response;
}
module.exports = {
  Response,
  RESPONSE_DATA,
  HEADER_DATA,
  serializeResponse,
  deserializeResponse,
};
