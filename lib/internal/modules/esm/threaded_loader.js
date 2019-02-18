'use strict';

const defaultESMResolve = require('internal/modules/esm/default_resolve');
const { Response, deserializeResponse } = require('internal/response');
const {
  MessageChannel,
} = require('worker_threads');
const {
  InternalWorker,
} = require ('internal/worker');
const {
  pathToFileURL
} = require('url');
const fs = require('fs');
const util = require('util');
const readFile = util.promisify(fs.readFile);
exports.makeLoaderChain = async function makeLoaderChain(baseForImport, loaderSpecifiers, onError) {
  if (loaderSpecifiers.length === 0) {
    // don't spin up threads
    return {
      resolve: defaultESMResolve,
    };
  }
  // firstPort = entrypoint to start propagation through loaders
  // lastPort = final propagation of loaders
  //            feeds to next loader, or null for default
  let {port1: firstPort, port2: lastPort} = new MessageChannel();
  let loaders = [];
  for (let i = 0; i < loaderSpecifiers.length - 1; i++) {
    const specifierToImport = loaderSpecifiers[i];
    const beforePort = lastPort;
    const {port1, port2} = new MessageChannel();
    const afterPort = port1;
    lastPort = port2;
    loaders.push(makeLoader({
      beforeThisLoaderPort: beforePort,
      afterThisLoaderPort: afterPort,
      specifierToImport,
      baseForImport,
    }));
  }
  loaders.push(makeLoader({
    beforeThisLoaderPort: lastPort,
    afterThisLoaderPort: null,
    specifierToImport: loaderSpecifiers[loaderSpecifiers.length - 1],
    baseForImport,
  }));
  let nextId = 1;
  const reqs = {
    __proto__: null
  };
  firstPort.on('close', () => onError(new Error('loader exited early')));
  firstPort.on('message', (_) => {
    const {
      type,
      reqId,
      data: {
        threw,
        value
      }
    } = _;
    if (type === 'resolveResponse') {
      reqs[reqId][
        threw ? 'reject' : 'fulfill'
      ](value);
    } else {
      throw new Error('unexpected message');
    }
  });
  await Promise.all(loaders);
  let pending = 0;
  function ref() {
    if (pending === 0) {
      firstPort.ref();
    }
    pending++;
  }
  function unref() {
    if (pending === 1) {
      firstPort.unref();
    }
    pending--;
  }
  firstPort.unref();
  return {
    async resolve(specifier, callsite) {
      const reqId = nextId;
      nextId++;
      ref();
      firstPort.postMessage({
        type: 'resolveRequest',
        reqId,
        data: {
          specifier,
          callsite,
        }
      });
      try {
        // do not return immediately
        // need to have finally{} work
        const res = await new Promise((fulfill, reject) => {
          reqs[reqId] = {fulfill, reject};
        });
        return res;
      } finally {
        unref();
      }
    },
  }
}
async function makeLoader({
  beforeThisLoaderPort,
  afterThisLoaderPort,
  specifierToImport,
  baseForImport,
}) {
  const worker = new InternalWorker('internal/modules/esm/loader_worker', {
    loaderModules: [],
  });
  return new Promise((f, r) => {
    function fatal(e = new Error('loader failed to initialize')) {
      worker.removeAllListeners();
      r(e);
    }
    worker.on('error', fatal);
    worker.on('exit', fatal);
    worker.on('message', (_) => {
      worker.removeAllListeners();
      f(_);
    });
    worker.unref();
    worker.postMessage({
      beforeThisLoaderPort,
      afterThisLoaderPort,
      specifierToImport,
      baseForImport
    }, afterThisLoaderPort ? [
      beforeThisLoaderPort,
      afterThisLoaderPort,
    ] : [
      beforeThisLoaderPort
    ]);
  });
}
exports.resolvedToResponse = async (resolved) => {
  console.error('RESOLVE TO RESP', {resolved})
  if (resolved.type === 'builtin') {
    return Response.redirect(`node:${resolved.specifier}`, 301);
  } else if (resolved.type === 'lazy') {
    const url = new URL(resolved.url);
    if (url.protocol !== 'file:') {
      throw new TypeError('can only expose files for now');
    }
    const body = await readFile(url);
    return ResponseWithPrivate(body, {
      headers: {
        'content-type': resolved.format
      }
    }, (data) => {
      data.url_list = [url];
      return data;
    });
  } else if (resolved.type === 'synthetic') {
    return deserializeResponse(resolved.value);
  }
  throw new Error('unknown resolution type');
}
