'use strict';

const defaultESMResolve = require('internal/modules/esm/default_resolve');
const {
  MessageChannel,
} = require('worker_threads');
const {
  InternalWorker,
} = require ('internal/worker');
const {
  pathToFileURL
} = require('url');
exports.makeLoaderChain = async function makeLoaderChain(cwd, loaderSpecifiers, onError) {
  if (loaderSpecifiers.length === 0) {
    // don't spin up threads
    return {
      resolve: defaultESMResolve,
    };
  }
  const cwdURL = pathToFileURL(cwd);
  cwdURL.pathname += '/';
  const baseForImport = cwdURL.href;
  // firstPort = entrypoint to start propagation through loaders
  // lastPort = final propagation of loaders (which feeds to next/default)
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
      onError
    }));
  }
  {
    const specifierToImport = loaderSpecifiers[loaderSpecifiers.length - 1];
      loaders.push(makeLoader({
        beforeThisLoaderPort: lastPort,
        afterThisLoaderPort: null,
        specifierToImport,
        baseForImport,
        onError
      }));
  }
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
    console.log('ref');
    if (pending === 0) {
      firstPort.ref();
    }
    pending++;
  }
  function unref() {
    console.log('unref');
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
  onError
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
