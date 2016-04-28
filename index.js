var Botkit = require('botkit');
var firebaseStorage = require('botkit-storage-firebase');
var CronJob = require('cron').CronJob;
var google = require('googleapis');
var yaml = require('yamljs');
var Metrics = require('./lib/metrics');
var GCPClient = require('./lib/gcpclient');
var BotData = require('./lib/botdata');
var Scheduler = require('./lib/scheduler');

function requireEnvVariable(name) {
  var value = process.env[name];
  if(!value) {
    throw new Error(name + ' is required!');
  }
  return value;
}

// Expect a bunch of environment variables
var slackToken = requireEnvVariable('SLACK_TOKEN');
var private_key = requireEnvVariable('PRIVATE_KEY');
var client_email = requireEnvVariable('CLIENT_EMAIL');
var firebase_uri = process.env.FIREBASE_URI; // not required, defaults to JSON store

var jwtClient = new google.auth.JWT(client_email, null, private_key,
  [
    'https://www.googleapis.com/auth/ndev.cloudman',
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/monitoring',
  ], null);

var botkitOptions = {};
if (firebase_uri) {
  botkitOptions.storage = firebaseStorage({ firebase_uri: firebase_uri });
} else {
  botkitOptions.json_file_store = './userdata/';
}

var controller = Botkit.slackbot(botkitOptions);
var botData = new BotData(controller);
var scheduler = new Scheduler();
var bot = controller.spawn({
  token: slackToken
});
bot.startRTM(function (err, bot, payload) {
  if (err) {
    throw new Error('Could not connect to Slack');
  }
  botData.fetchBotIdentity(bot);
});

function replier(bot, message) {
  return function(reply) {
    if(typeof message != "string") {
      // Required to add image attachments
      reply.username = bot.identity.name;
      reply.icon_url = bot.identity.icon;
    }
    bot.reply(message, reply);
  };
}

function sayer(bot, user, channel) {
  return function(message) {
    if(typeof message == "string") {
      bot.say({ text: message, channel: channel });
    } else {
      message.username = bot.identity.name;
      message.icon_url = bot.identity.icon;
      message.channel = channel;
      bot.say(message);
    }
  };
}

function scheduleDigest(user, channel, projectId, schedule, tz) {
  return scheduler.scheduleInterval(user + channel + projectId, schedule, tz, function() {
    var say = sayer(bot, user, channel);
    say("Here's your digest!");
    botData.getUserChannelData(user, channel).then(function(userData) {
      var gcpClient = new GCPClient(jwtClient, say);
      var monitorUserData = { projectId: userData.schedule.projectId };
      return gcpClient.monitorMetricPack(monitorUserData, "simple");
    }, userDataErrorHandler(say));
  });
}

// Schedule all jobs that were saved
botData.getAllUserData().then(function(allData) {
  for(var i = 0; i < allData.length; i++) {
    var data = allData[i];
    var user = data.id;
    for(var channel in data.channels) {
      var channelData = data.channels[channel];
      console.log('scheduling user:', user, 'channel:', channel, 'project:', channelData.schedule.projectId, 'schedule:', channelData.schedule.schedule, 'timezone:', channelData.schedule.tz);
      var result = scheduleDigest(user, channel, channelData.projectId, channelData.schedule.schedule, channelData.schedule.tz);
      if(!result) {
        console.error('scheduling failed');
      }
    }
  }
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
    var success = scheduleDigest(message.user, message.channel, projectId, scheduleString, tz);
    
    if(success) {
      // Then save the data so it can be used later (especially on bot restart)
      var channelData = { schedule: {
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
  });
});

controller.hears(['gcpbot d(eploy)? detail (.*)'], ['message_received','ambient'], function (bot, message) {
  var gcpClient = new GCPClient(jwtClient, replier(bot, message));
  var depId = message.match[2].trim();
  botData.getUserChannelData(message.user, message.channel).then(function(userData) {
    return gcpClient.showDeployDetail(userData, depId);
  }, userDataErrorHandler(gcpClient.replier));
});

controller.hears(['gcpbot d(eploy)? summary (.*)'], ['message_received','ambient'], function (bot, message) {
  var gcpClient = new GCPClient(jwtClient, replier(bot, message));
  var user = message.match[2].trim();
  var email = user.substring( user.indexOf(':') + 1, user.indexOf('|'));
  console.log(email);

  botData.getUserChannelData(message.user, message.channel).then(function(userData) {
    return gcpClient.showDeploySummary(userData, email);
  }, userDataErrorHandler(gcpClient.replier));
});

controller.hears(['gcpbot deploy list'], ['message_received','ambient'], function (bot, message) {
  var gcpClient = new GCPClient(jwtClient, replier(bot, message));
  botData.getUserChannelData(message.user, message.channel).then(function(userData) {
    return gcpClient.showDeployList(userData);
  }, userDataErrorHandler(gcpClient.replier));
});

// DEPLOYMENT of a file from github
controller.hears(['gcpbot d(eploy)? new (.*) (.*)'], ['message_received','ambient'], function (bot, message) {
  var gcpClient = new GCPClient(jwtClient, replier(bot, message));
  var repo = message.match[2].trim();
  var depFile = message.match[3].trim();
  
  botData.getUserChannelData(message.user, message.channel).then(function(userData) {
    return gcpClient.newDeploy(userData, repo, depFile);
  }, userDataErrorHandler(gcpClient.replier));
});

controller.hears('gcpbot h(elp)?', ['message_received', 'ambient'], function (bot, message) {
  var packs = '`' + Object.keys(Metrics.packages).join('`, `') + '`';
  var help = 'I will respond to the following messages: \n' +
      '`gcpbot schedule <projectId> <schedule>` to schedule a daily digest.\n' +
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
  var gcpClient = new GCPClient(jwtClient, replier(bot, message));
  var metricString = message.match[3];
  var parsedMetrics = parseMetricsFromMessage(metricString);
  
  botData.getUserChannelData(message.user, message.channel).then(function(userData) {
    return gcpClient.listMetrics(userData, parsedMetrics);
  }, userDataErrorHandler(gcpClient.replier));
});

controller.hears(['gcpbot m(onitor)? p(ack)?(.*)?'], ['message_received','ambient'], function (bot, message) {
  var metricString = (message.match[3] || '').trim();
  
  // First see if there's a named package
  if(Metrics.packages[metricString]) {
    var gcpClient = new GCPClient(jwtClient, replier(bot, message));
    botData.getUserChannelData(message.user, message.channel).then(function(userData) {
      return gcpClient.monitorMetricPack(userData, metricString);
    }, userDataErrorHandler(gcpClient.replier));
  } else {
    var packages = '`' + Object.keys(Metrics.packages).join('`, `') + '`';
    bot.reply(message, 'Metric pack name is required. Try one of: ' + Metrics.packages);
  }
});

controller.hears(['gcpbot m(onitor)?(.*)?'], ['message_received','ambient'], function (bot, message) {
  var metricString = message.match[2];
  var metrics = parseMetricsFromMessage(metricString);
  if (metrics) {
    var gcpClient = new GCPClient(jwtClient, replier(bot, message));
    botData.getUserChannelData(message.user, message.channel).then(function(userData) {
      return gcpClient.monitorMetricList(userData, metrics);
    }, userDataErrorHandler(gcpClient.replier));
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

function userDataErrorHandler(replier) {
  return function(err) {
    replier('You need to tell me what project to use first. Use `gcpbot project <projectId>` to select a project to manage.');
  };
}
