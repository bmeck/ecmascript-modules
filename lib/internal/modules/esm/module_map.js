'use strict';

const ModuleJob = require('internal/modules/esm/module_job');
const {
  SafeMap
} = primordials;
const debug = require('util').debuglog('esm');
const { ERR_INVALID_ARG_TYPE } = require('internal/errors').codes;
const { validateString } = require('internal/validators');

// Tracks the state of the loader-level module cache
// unique id, even across maps (pending stage 2-1 issue)
let nextId = 1;
class ModuleMap extends SafeMap {
  createSyntheticLocation() {
    const id = nextId;
    nextId++;
    return `synthetic:${id}`;
  }
  get(location) {
    validateString(location, 'url');
    return super.get(location);
  }
  set(location, job) {
    validateString(location, 'location');
    if (job instanceof ModuleJob !== true) {
      throw new ERR_INVALID_ARG_TYPE('job', 'ModuleJob', job);
    }
    debug(`Storing ${location} in ModuleMap`);
    return super.set(location, job);
  }
  has(location) {
    validateString(location, 'url');
    return super.has(location);
  }
}
module.exports = ModuleMap;
