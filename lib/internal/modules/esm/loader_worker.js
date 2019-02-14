'use strict';

const worker_threads = require('worker_threads');
const esmLoader = require('internal/process/esm_loader');
const parentPort = worker_threads.parentPort;

delete worker_threads.parentPort;
parentPort.on('message', async ({
  beforeThisLoaderPort,
  afterThisLoaderPort,
  specifierToImport,
  baseForImport
}) => {
  let nextId = 1;
  const reqs = {
    __proto__: null
  };
  afterThisLoaderPort.on('message', async ({
    type,
    reqId,
    data: {
      threw,
      value
    }
  }) => {
    if (type === 'resolveResponse') {
      reqs[reqId][
        threw ? 'fulfill' : 'reject'
      ](value);
    } else {
      throw new Error('unexpected message');
    }
  });
  // needs to be setup prior to user code
  // freeze it because we may wish to add more
  // hooks, someone can completely punch away
  // global.parent if they wish to virtualize
  global.parent = Object.freeze({
    __proto__: null,
    async resolve(specifier, callsite) {
      const reqId = nextId;
      nextId++;
      afterThisLoaderPort.postMessage({
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
    }
  });
  // should this be moved to a static form to avoid the
  // export then() implication here?
  const loader = await esmLoader.loaderPromise;
  let userResolve;
  try {
    const userLoader = await loader.import(specifierToImport, baseForImport);
    userResolve = userLoader.resolve;
  } catch (e) {
    internalBinding('util').triggerFatalException(e);
  }
  parentPort.postMessage({ready: true});
  //parentPort.close();

  beforeThisLoaderPort.on('message', async ({
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
        value = await userResolve(specifier, callsite);
      } catch (e) {
        value = e;
        threw = true;
      }
      beforeThisLoaderPort.postMessage({
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
});
