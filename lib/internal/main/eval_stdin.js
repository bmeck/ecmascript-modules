'use strict';

// Stdin is not a TTY, we will read it and execute it.

const {
  prepareMainThreadExecution
} = require('internal/bootstrap/pre_execution');

const {
  evalScript,
  readStdin
} = require('internal/process/execution');

prepareMainThreadExecution().then(() => {
  markBootstrapComplete();

  readStdin((code) => {
    process._eval = code;
    evalScript('[stdin]', process._eval, process._breakFirstLine);
  });
}).catch(e => {
  internalBinding('util').triggerFatalException(e);
});