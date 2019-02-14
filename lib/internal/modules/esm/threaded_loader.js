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
  for (const specifierToImport of loaderSpecifiers) {
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
  await Promise.all(loaders);
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
  firstPort.unref();
  lastPort.unref();
  return {
    async resolve(specifier, callsite) {
      const reqId = nextId;
      nextId++;
      console.error('sending to loader', specifier, callsite)
      firstPort.postMessage({
        type: 'resolveRequest',
        reqId,
        data: {
          specifier,
          callsite,
        }
      });
      return new Promise((fulfill, reject) => {
        reqs[reqId] = {fulfill, reject};
      });
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
  const ret = new Promise((f, r) => {
    function fatal(e) {
      r(e);
      onError(e);
    }
    worker.on('error', fatal);
    worker.on('exit', () => fatal(new Error('loader exited early')));
    worker.on('message', f);
  });
  await ret;
  // if we unref, the worker thread dies early
  // if we don't unref the main thread never dies
  // worker.unref();
  return ret;
}
