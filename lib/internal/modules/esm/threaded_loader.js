'use strict';

const defaultESMResolve = require('internal/modules/esm/default_resolve');
const {
  Worker,
  MessageChannel,
} = require('worker_threads');
exports.setup = false;
exports.makeLoaderChain = async function makLoaderChain(loaderSpecifiers) {
  if (loaderSpecifiers.length === 0) {
    // don't spin up threads
    return {
      resolve: defaultESMResolve
    };
  }
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
      specifierToImport: specifierToImport,
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
  firstPort.on('message', ({
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
  return {
    async resolve(specifier, callsite) {
      const reqId = nextId;
      nextId++;
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
    }
  }
}
async function makeLoader({
  beforeThisLoaderPort,
  afterThisLoaderPort,
  specifierToImport
}) {
  const worker = new Worker(`'use strict';

  const worker_threads = require('worker_threads');
  const parentPort = worker_threads.parentPort;
  delete worker_threads.parentPort;
  parentPort.on('message', ({
    beforeThisLoaderPort,
    afterThisLoaderPort,
    specifierToImport
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
    import(specifierToImport).then(async ({
      resolve: userResolve
    }) => {
      parentPort.postMessage({ready: true});
      parentPort.close();

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
  });
  `, {
    eval: true,
  });
  worker.postMessage({
    beforeThisLoaderPort,
    afterThisLoaderPort,
    specifierToImport
  }, [
    beforeThisLoaderPort,
    afterThisLoaderPort,
  ]);
  return new Promise((f, r) => {
    worker.on('error', r);
    worker.on('exit', () => r(new Error('loader exited early')));
    worker.on('message', f);
  });
}
