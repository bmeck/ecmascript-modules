// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// This test starts two clustered HTTP servers on the same port. It expects the
// first cluster to succeed and the second cluster to fail with EADDRINUSE.
//
// The test may seem complex but most of it is plumbing that routes messages
// from the child processes back to the "super" master. As a tree it looks
// something like this:
//
//         <super master>
//         /           \
//     <master 1>   <master 2>
//       /               \
//   <worker 1>       <worker 2>
//
// The first worker starts a server on a fixed port and fires a ready message
// that is routed to the second worker. When it tries to bind, it expects to
// see an EADDRINUSE error.
//
// See https://github.com/joyent/node/issues/2721 for more details.

var common = require('../common');
var assert = require('assert');
var cluster = require('cluster');
var fork = require('child_process').fork;
var http = require('http');

var id = process.argv[2];

if (!id) {
  var a = fork(__filename, ['one']);
  var b = fork(__filename, ['two']);

  a.on('message', function(m) {
    if (typeof m === 'object') return;
    assert.equal(m, 'READY');
    b.send('START');
  });

  var ok = false;

  b.on('message', function(m) {
    if (typeof m === 'object') return; // ignore system messages
    assert.equal(m, 'EADDRINUSE');
    a.kill();
    b.kill();
    ok = true;
  });

  process.on('exit', function() {
    a.kill();
    b.kill();
    assert(ok);
  });
}
else if (id === 'one') {
  if (cluster.isMaster) return startWorker();

  http.createServer(assert.fail).listen(common.PORT, function() {
    process.send('READY');
  });
}
else if (id === 'two') {
  if (cluster.isMaster) return startWorker();

  var ok = false;
  process.on('SIGTERM', process.exit);
  process.on('exit', function() {
    assert(ok);
  });

  process.on('message', function(m) {
    if (typeof m === 'object') return; // ignore system messages
    assert.equal(m, 'START');
    var server = http.createServer(assert.fail);
    server.listen(common.PORT, assert.fail);
    server.on('error', function(e) {
      assert.equal(e.code, 'EADDRINUSE');
      process.send(e.code);
      ok = true;
    });
  });
}
else {
  assert(0); // bad command line argument
}

function startWorker() {
  var worker = cluster.fork();
  worker.on('message', process.send);
  process.on('message', worker.send.bind(worker));
  process.on('SIGTERM', function() {
    worker.kill();
    process.exit();
  });
}
