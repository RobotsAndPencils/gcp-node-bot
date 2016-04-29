var CronJob = require('cron').CronJob;

var scheduled = {};

function Scheduler() { }

/**
 * Schedule a function to run at a specific interval. Cancel any existing scheduled
 * function with the same key.
 * 
 * @param {string} key - the key to uniqely identify this scheduled function
 * @param {*} schedule - the schedule to use. (using cron syntax)
 * @param {string} tz - the time zone to run the schedule in
 * @param {function} func - the function to run at the specified interval
 * @returns {boolean} - Whether a job was scheduled successfully or not
 */
Scheduler.prototype.scheduleInterval = function(key, schedule, tz, func) {
  this.cancel(key);
  try {
    scheduled[key] = new CronJob(schedule, func, null, true, tz);
    return true;
  } catch(e) {
    console.error('Could not start cron job.', e.message);
    return false;
  }
};

/**
 * Cancel a function that was scheduled with a specific key.
 * 
 * @param {string} key - the key to uniqely identify the scheduled function to cancel
 */
Scheduler.prototype.cancel = function(key) {
  var func = scheduled[key];
  if(func) {
    func.stop();
  }
  scheduled[key] = null;
};

module.exports = Scheduler;
