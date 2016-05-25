var vm = require('vm');

// Hack to let us make a new module for each context
var Module = module.constructor;
  
function ScriptRunner(script, context, callback) {
  this.script = script;
  this.callback = callback;
  this.context = Object.assign(context, { module: new Module() });
}

ScriptRunner.prototype.compile = function() {
  if(this.command) { return true; }
  try {
    var vmContext = vm.createContext(this.context);
    console.log(this.script);
    this.command = vm.runInContext(this.script, vmContext);
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
    this.command(this.callback);
  } catch(err) {
    this.callback(err);
  }
};

module.exports = ScriptRunner;
