var vm = require('vm');

// Hack to let us make a new module for each context
var Module = module.constructor;
  
function ScriptRunner(script, context, args) {
  this.script = script;
  this.arguments = args;
  // Add a Module to the context so scripts can do "module.exports = ..."
  this.context = Object.assign(context || {}, { module: new Module() });
}

ScriptRunner.prototype.compile = function() {
  if(this.command) { return true; }
  try {
    var vmContext = vm.createContext(this.context);
    this.command = vm.runInContext(this.script, vmContext, { filename: "userscript.js" });
    this.argCount = this.command.length;
    this.name = this.command.name;
    return true;
  } catch(err) {
    this.callback(err);
    return false;
  }
};

ScriptRunner.prototype.run = function() {
  if(!this.compile()) { return; }
  try {
    this.command.apply({}, this.arguments);
  } catch(err) {
    this.callback(err);
  }
};

module.exports = ScriptRunner;
