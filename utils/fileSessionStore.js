'use strict';
const session = require('express-session');
const { readJSON, writeJSON } = require('./jsonStore');

class FileSessionStore extends session.Store {
  constructor(file) {
    super();
    this.file = file;
    this.writeQueue = Promise.resolve();
  }
  allRows() { return readJSON(this.file, {}); }
  get(sid, callback) {
    this.writeQueue.then(() => {
      const rows = this.allRows(), row = rows[sid];
      if (!row || (row.cookie && row.cookie.expires && new Date(row.cookie.expires) <= new Date())) return callback(null, null);
      callback(null, row);
    }).catch(callback);
  }
  mutate(change, callback = () => {}) {
    const operation = this.writeQueue.then(() => {
      const rows = this.allRows();
      change(rows);
      writeJSON(this.file, rows);
    });
    this.writeQueue = operation.catch(() => {});
    operation.then(() => callback(null), callback);
  }
  set(sid, value, callback = () => {}) { this.mutate(rows => { rows[sid] = value; }, callback); }
  destroy(sid, callback = () => {}) { this.mutate(rows => { delete rows[sid]; }, callback); }
  touch(sid, value, callback = () => {}) { this.set(sid, value, callback); }
}
module.exports = FileSessionStore;
