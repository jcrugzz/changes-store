var EE = require('events').EventEmitter;
var PassThrough = require('stream').PassThrough;
var url = require('url');
var util = require('util');
var Changes = require('changes-stream');
var http = require('http-https');
var parse = require('parse-json-response');

var slice = Array.prototype.slice;

module.exports = Store;

util.inherits(Store, EE);

function Store (options) {
  if (!(this instanceof Store)) return new Store(options);
  EE.call(this);

  options = options || {};

  if (typeof options === 'string') {
    this.db = options;
    options = {};
  }

  this.db = this.db || options.db;

  if (!this.db) {
    throw new Error('A database is required guys');
  }

  this.stream = options.stream || new PassThrough({ objectMode: true, highWaterMark: 16 });
  this.view = options.view;
  // Only cache a specific key of the documents if specified
  this.key = options.key;
  this._index = undefined;
  this.indicies = [];

  this.fetch();
}

Store.prototype.fetch = function() {
  var fullUrl = this.db + '/' +
    (this.view ? this.view : '_all_docs') +
    '?include_docs=true&update_seq=true';

  var opts = url.parse(fullUrl);
  opts.method = 'GET';
  opts.headers = {
    'content-type': 'application/json',
    'connection': 'close'
  };

  // TODO: impelement retry if its worth it
  var req = http.request(opts);
  req.on('error', this.emit.bind(this, 'error'));
  req.on('response', parse(this.preload.bind(this)));
  req.end();
};

Store.prototype.preload = function (err, data, res) {
  if (err) {
    return this.emit('error', err);
  }

  this._index = data.rows
    .map(function (r) { return r.doc })
    .filter(function (doc) {
      return !/^_design/.test(doc._id);
    })
    .reduce(function (acc, doc) {
      acc[doc._id] = doc;
      return acc;
    }.bind(this), {})

    this.emit('initialized');
    this.listen(data.update_seq);
};

Store.prototype.keys = function (idx) {
  return Object.keys(this._index);
};

// Index a particular key and create its own Getter function
Store.prototype.index = function (idx) {
  if (!~this.indicies.indexOf(idx)) {
    if (this[idx]) {
      return this.emit('error', new Error('Cannot override internal function/object'));
    }
    this.indicies.push(idx);
    this[idx] = this.getter(idx);
  }
  return this;
};

Store.prototype.get = function(key) {
  if (!key) return undefined;
  return this._index[key]
};

//
// Create simple getters for particular keys that we set with `index`
//
Store.prototype.getter = function (index) {
  var self = this;
  return function (key) {
    if (!key || key && !self.index[key]) return undefined;
    return self._index[key][index];
  };
};

Store.prototype.listen = function (since) {
  this.changes = new Changes({
    db: this.db,
    include_docs: true,
    since: +since || 'now',
    inactivity_ms: this.inactivity_ms || 60 * 1000 * 1000
  });

  this.changes.on('error', this.emit.bind(this, 'error'));
  this.changes.on('retry', this.emit.bind(this, 'retry'));

  this.changes.pipe(this.stream)
    .on('data', this.invalidate.bind(this))
    .on('error', this.emit.bind(this, 'error'));

};

Store.prototype.invalidate = function (change) {
  this.emit('invalidate', change.doc);
  this._index[change.id] = change.doc;
};
