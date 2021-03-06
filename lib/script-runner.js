var vm = require('vm');

// Hack to let us make a new module for each context
var Module = module.constructor;
  
function ScriptRunner(script, context, callback) {
  this.script = script;
  if(typeof callback === 'function') {
    this.callback = callback;
  } else {
    this.callback = function() {};
  }
  // Add a Module to the context so scripts can do "module.exports = ..."
  this.context = Object.assign(context || {}, { module: new Module() });
}

ScriptRunner.prototype.compile = function() {
  if(this.command) { return true; }
  try {
    var vmContext = vm.createContext(this.context);
    this.command = vm.runInContext(this.script, vmContext, { filename: "userscript.js" });
    if(typeof this.command === 'function') {
      this.argCount = this.command.length;
      this.name = this.command.name;
      return true;
    } else {
      this.callback(new Error("Script is not a function."));
      return false;
    }
  } catch(err) {
    this.callback(err);
    return false;
  }
};

ScriptRunner.prototype.run = function(args) {
  if(!this.compile()) { return; }
  try {
    this.command.apply({}, args);
  } catch(err) {
    this.callback(err);
  }
};

module.exports = ScriptRunner;
