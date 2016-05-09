var BeepBoop = require('beepboop-botkit');
var CronJob = require('cron').CronJob;
var GCPClient = require('./gcpclient');
var Metrics = require('./metrics');
var Scheduler = require('./scheduler');
var yaml = require('yamljs');

var bots = {};
function connect(controller, slackToken) {
  if(slackToken) {
    console.log('Connecting to single slack team');
    var bot = controller.spawn({
      token: slackToken
    });
    
    bot.startRTM(function (err, bot, payload) {
      if (err) {
        throw new Error('Could not connect to Slack');
      }
      bots[bot.team_info.id] = bot;
    });
  } else {
    var beepboop = BeepBoop.start(controller);
    console.log('Connecting to BeepBoop resourcer');
    beepboop.on('add_resource', function (msg) {
      var resource = beepboop.workers[msg.resourceID];
      if(resource) {
        var teamId = resource.SlackTeamID;
        bots[teamId] = resource.worker;
      } else {
        console.error('No bot found when added to team.');
      }
    });
  }
}

function Bot(controller, botData, authCache, slackToken) {
  var scheduler = new Scheduler();
  connect(controller, slackToken);
  
  function sayOrReply(bot, user, message, channel, parentMessage, private) {
    if(typeof message == "string") {
      message = { text: message };
    }
    // Required to add image attachments
    message.as_user = true;
    
    if(private) {
      bot.api.im.open({user: user}, function (err, response) {
        if(err) { console.error(err); }
        message.channel = response.channel.id;
        bot.say(message);
      });
    } else if(parentMessage) {
      bot.reply(parentMessage, message);
    } else {
      message.channel = channel;
      bot.say(message);
    }
  }

  function replier(bot, message) {
    return function(reply, private) {
      sayOrReply(bot, message.user, reply, null, message, private);
    };
  }

  function sayer(bot, user, channel) {
    return function(message, private) {
      sayOrReply(bot, user, message, channel, null, private);
    };
  }

  function showDigest(user, teamId, channel) {
    var say = sayer(bot, user, channel);
    botData.getUserChannelData(user, channel).then(function(userData) {
      if(userData && userData.schedule) {
        var gcpClient = new GCPClient(authCache, teamId, user, say);
        var monitorUserData = { projectId: userData.schedule.projectId };
        return gcpClient.monitorMetricPack(monitorUserData, "simple");
      } else {
        console.error("Trying to run digest with no data. User:", user, "Channel:", channel);
      }
    }).catch(catchAll);
  }

  function scheduleDigest(user, teamId, channel, projectId, schedule, tz) {
    return scheduler.scheduleInterval(user + channel + projectId, schedule, tz, function() {
      showDigest(user, teamId, channel);
    });
  }

  // Schedule all jobs that were saved
  botData.getAllUserData().then(function(allData) {
    for(var i = 0; i < allData.length; i++) {
      var data = allData[i];
      var user = data.id;
      for(var channel in data.channels) {
        var channelData = data.channels[channel];
        if(channelData && channelData.schedule) {
          console.log('scheduling user:', user, 'channel:', channel, 'project:', channelData.schedule.projectId, 'schedule:', channelData.schedule.schedule, 'timezone:', channelData.schedule.tz);
          var result = scheduleDigest(user, channelData.teamId, channel, channelData.projectId, channelData.schedule.schedule, channelData.schedule.tz);
          if(!result) {
            console.error('scheduling failed');
          }
        }
      }
    }
  }).catch(function(err) {
    console.error("Error scheduling digests:", err);
  });

  controller.on('bot_channel_join', function (bot, message) {
    bot.reply(message, "I'm here! Type `gpcbot help` to see what I can do.");
  });

  controller.hears(['gcpbot project (.*)'], ['message_received','ambient'], function (bot, message) {
    var projectId = message.match[1].trim();
    var data = {
      projectId: projectId
    };
    botData.saveUserChannelData(message.user, message.channel, data);
    bot.reply(message, 'Ok, using project `' + projectId + '` in this channel');
  });

  controller.hears(['gcpbot schedule (\\S+)(.*)?'], ['message_received','ambient'], function (bot, message) {
    var projectId = message.match[1].trim();
    var scheduleString = (message.match[2] || '0 9 * * *').trim(); // Default to every day at 9AM
    console.log('projectId:', projectId, 'scheduleString:', scheduleString);
    
    // Fetch the user data so we know the time zone
    botData.fetchUserInfo(message.user, bot).then(function(userInfo) {
      // First do the actual scheduling
      var tz = userInfo.user.tz;
      var success = scheduleDigest(message.user, bot.team_info.id, message.channel, projectId, scheduleString, tz);
      
      if(success) {
        // Then save the data so it can be used later (especially on bot restart)
        var channelData = { schedule: {
            teamId: bot.team_info.id,
            projectId: projectId,
            schedule: scheduleString,
            tz: tz
        } };
        botData.saveUserChannelData(message.user, message.channel, channelData);
        bot.reply(message, 'Ok, I scheduled a digest for `' + scheduleString + '` in this channel');
      } else {
        // Or tell the user that the scheduling failed
        bot.reply(message, 'I could not schedule a digest for `' + scheduleString + '`. Is something wrong with your cron string?');
      }
    }, function(err) {
      bot.reply(message, 'Are you a real person?');
    }).catch(catchAll);
  });

  controller.hears(['gcpbot unschedule'], ['message_received','ambient'], function (bot, message) {
    botData.getUserChannelData(message.user, message.channel).then(function(userData) {
      if(userData.schedule) {
        var projectId = userData.schedule.projectId;
        scheduler.cancel(message.user + message.channel + projectId);
        delete userData.schedule;
        return botData.saveUserChannelData(message.user, message.channel, userData, false).then(function() {
          bot.reply(message, 'Ok, your digest for `' + projectId + '` has been cancelled.');
        });
      } else {
        bot.reply(message, 'You have no digest scheduled. Use `gcpbot schedule <projectId>` to schedule one.');
      }
    }, function(err) {
      console.error('Error unscheduling digest:', err);
      bot.reply(message, 'I could not unschedule this digest.');
    }).catch(catchAll);
  });

  controller.hears(['gcpbot digest'], ['message_received','ambient'], function (bot, message) {
    showDigest(message.user, bot.team_info.id, message.channel).catch(catchAll);
  });

  controller.hears(['gcpbot d(eploy)? detail (.*)'], ['message_received','ambient'], function (bot, message) {
    var gcpClient = new GCPClient(authCache, message.user, bot.team_info.id, replier(bot, message));
    var depId = message.match[2].trim();
    botData.getUserChannelData(message.user, message.channel).then(function(userData) {
      if(!userData.projectId) { userDataErrorHandler(gcpClient.replier, userData); return; }
      return gcpClient.showDeployDetail(userData, depId);
    }).catch(catchAll);
  });

  controller.hears(['gcpbot d(eploy)? summary (.*)'], ['message_received','ambient'], function (bot, message) {
    var gcpClient = new GCPClient(authCache, message.user, bot.team_info.id, replier(bot, message));
    var user = message.match[2].trim();
    var email = user.substring( user.indexOf(':') + 1, user.indexOf('|'));
    console.log(email);

    botData.getUserChannelData(message.user, message.channel).then(function(userData) {
      if(!userData.projectId) { userDataErrorHandler(gcpClient.replier, userData); return; }
      return gcpClient.showDeploySummary(userData, email);
    }).catch(catchAll);
  });

  controller.hears(['gcpbot deploy list'], ['message_received','ambient'], function (bot, message) {
    var gcpClient = new GCPClient(authCache, message.user, bot.team_info.id, replier(bot, message));
    botData.getUserChannelData(message.user, message.channel).then(function(userData) {
      if(!userData.projectId) { userDataErrorHandler(gcpClient.replier, userData); return; }
      return gcpClient.showDeployList(userData);
    }).catch(catchAll);
  });

  // DEPLOYMENT of a file from github
  controller.hears(['gcpbot d(eploy)? new (.*) (.*)'], ['message_received','ambient'], function (bot, message) {
    var gcpClient = new GCPClient(authCache, message.user, bot.team_info.id, replier(bot, message));
    var repo = message.match[2].trim();
    var depFile = message.match[3].trim();
    
    botData.getUserChannelData(message.user, message.channel).then(function(userData) {
      if(!userData.projectId) { userDataErrorHandler(gcpClient.replier, userData); return; }
      return gcpClient.newDeploy(userData, repo, depFile);
    }).catch(catchAll);
  });

  controller.hears('gcpbot h(elp)?', ['message_received', 'ambient'], function (bot, message) {
    var packs = '`' + Object.keys(Metrics.packages).join('`, `') + '`';
    var help = 'I will respond to the following messages: \n' +
        '`gcpbot schedule <projectId> <schedule>` to schedule a digest. Schedule is specified with cron syntax. Leave blank to schedule for 9am every morning.\n' +
        '`gcpbot unschedule` to cancel a scheduled digest in this channel.\n' +
        '`gcpbot digest` to show the currently scheduled digest now.\n' +
        '`gcpbot project <projectId>` to select a project to use for the other commands in this channel. This is a per user setting. You can change it at any time.\n' +
        '`gcpbot deploy list` for a list of all deployment manager jobs and their status.\n' +
        '`gcpbot deploy summary <email>` for a list of all deployment manager jobs initiated by the provided user and their status.\n' +
        '`gcpbot deploy new <repo> <depfile>` to create a new deployment using a yaml file in the github repo identified with a yaml file called <depfile>.yaml.\n' +
        '`gcpbot deploy detail <depname>` to show info and status for a given deployment manager job.\n' +
        '`gcpbot monitor metrics <filter...>` to list all metrics. Add one or more strings to filter the results (space-separated list, results match ALL strings).\n' +
        '`gcpbot monitor pack <pack name>` to show the values for a named group of metrics. Available packs: ' + packs + '.\n' +
        '`gcpbot monitor <metrics...>` to show the values for a set of metrics (space-separated list).\n' +
        '`gcpbot help` to see this again.';
    bot.reply(message, help);
  });

  controller.hears(['gcpbot m(onitor)? m(etrics)?(.*)?'], ['message_received','ambient'], function (bot, message) {
    var gcpClient = new GCPClient(authCache, message.user, bot.team_info.id, replier(bot, message));
    var metricString = message.match[3];
    var parsedMetrics = parseMetricsFromMessage(metricString);
    
    botData.getUserChannelData(message.user, message.channel).then(function(userData) {
      if(!userData.projectId) { userDataErrorHandler(gcpClient.replier, userData); return; }
      return gcpClient.listMetrics(userData, parsedMetrics);
    }).catch(catchAll);
  });

  controller.hears(['gcpbot m(onitor)? p(ack)?(.*)?'], ['message_received','ambient'], function (bot, message) {
    var metricString = (message.match[3] || '').trim();
    
    // First see if there's a named package
    if(Metrics.packages[metricString]) {
      var gcpClient = new GCPClient(authCache, message.user, bot.team_info.id, replier(bot, message));
      botData.getUserChannelData(message.user, message.channel).then(function(userData) {
        if(!userData.projectId) { userDataErrorHandler(gcpClient.replier, userData); return; }
        return gcpClient.monitorMetricPack(userData, metricString);
      }).catch(catchAll);
    } else {
      var packages = '`' + Object.keys(Metrics.packages).join('`, `') + '`';
      bot.reply(message, 'Metric pack name is required. Try one of: ' + Metrics.packages);
    }
  });

  controller.hears(['gcpbot m(onitor)?(.*)?'], ['message_received','ambient'], function (bot, message) {
    var metricString = message.match[2];
    var metrics = parseMetricsFromMessage(metricString);
    if (metrics) {
      var gcpClient = new GCPClient(authCache, message.user, bot.team_info.id, replier(bot, message));
      botData.getUserChannelData(message.user, message.channel).then(function(userData) {
        if(!userData.projectId) { userDataErrorHandler(gcpClient.replier, userData); return; }
        return gcpClient.monitorMetricList(userData, metrics);
      }).catch(catchAll);
    } else {
      bot.reply(message, "Metrics are required.");
    }
  });

  function parseMetricsFromMessage(metricString) {
    if (metricString) {
        var metrics = metricString.trim().split(' ');
        // Pull metric out of the Slack link syntax (because it looks like a URL)
        for (i = 0; i < metrics.length; i++) {
          var metric = metrics[i];
          var result = /<.*\|(.*)>/.exec(metric);
          if (result) {
            metrics[i] = result[1] || metric;
          }
        }
        return metrics;
    }
    return null;
  }

  function userDataErrorHandler(replier, userData) {
    replier('You need to tell me what project to use first. Use `gcpbot project <projectId>` to select a project to manage.');
  }
  
  function catchAll(err) { 
    console.error(err); 
  }
  
  return bots;
}

module.exports = Bot;
