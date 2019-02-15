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
  firstPort.__stack = new Error().stack;
  lastPort.__stack = new Error().stack;
  let loaders = [];
  for (const specifierToImport of loaderSpecifiers) {
    const beforePort = lastPort;
    const {port1, port2} = new MessageChannel();
    port1.__stack = new Error().stack;
    port2.__stack = new Error().stack;
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
  lastPort.on('message', async ({
    type,
    reqId,
    data: {
      specifier,
      callsite,
    }
  }) => {
    if (type === 'resolveRequest') {
      let value;
      let threw = false;
      try {
        value = await defaultESMResolve(specifier, callsite);
      } catch (e) {
        value = e;
        threw = true;
      }
      lastPort.postMessage({
        type: 'resolveResponse',
        reqId,
        data: {
          threw,
          value
        }
      });
    } else {
      throw new Error('unexpected message');
    }
  });
  let nextId = 1;
  const reqs = {
    __proto__: null
  };
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
    if (pending == 0) {
      firstPort.ref();
      lastPort.ref();
    }
    pending++;
  }
  function unref() {
    if (pending == 1) {
      firstPort.unref();
      lastPort.unref();
    }
    pending--;
  }
  firstPort.unref();
  lastPort.unref();
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
  worker.postMessage({
    beforeThisLoaderPort,
    afterThisLoaderPort,
    specifierToImport,
    baseForImport
  }, [
    beforeThisLoaderPort,
    afterThisLoaderPort,
  ]);
  return new Promise((f, r) => {
    function fatal(e) {
      r(e);
      onError(e);
    }
    worker.on('error', fatal);
    worker.on('exit', () => fatal(new Error('loader exited early')));
    worker.on('message', f);
    worker.unref();
  });
}
