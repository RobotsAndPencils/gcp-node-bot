var Botkit = require('botkit');
var google = require('googleapis');
var yaml = require('yamljs');
var Metrics = require('./lib/metrics');
var GCPClient = require('./lib/gcpclient');

// Expect a SLACK_TOKEN environment variable
var slackToken = process.env.SLACK_TOKEN;
if (!slackToken) {
  console.error('SLACK_TOKEN is required!');
  process.exit(1);
}

// Expect a PROJECT_ID environment variable
var projectId = process.env.PROJECT_ID;
if (!projectId) {
  console.error('PROJECT_ID is required!');
  process.exit(1);
}

// Expect a PROJECT_REGION environment variable
var region = process.env.PROJECT_REGION;
if (!region) {
  console.error('PROJECT_REGION is required!');
  process.exit(1);
}

var private_key = process.env.PRIVATE_KEY;
if (!private_key) {
  console.error('PRIVATE_KEY is required!');
  process.exit(1);
}
var client_email = process.env.CLIENT_EMAIL;
if (!client_email) {
  console.error('CLIENT_EMAIL is required!');
  process.exit(1);
}

var jwtClient = new google.auth.JWT(client_email, null, private_key,
  [
    'https://www.googleapis.com/auth/ndev.cloudman',
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/monitoring',
  ], null);

var gcpClient = new GCPClient(jwtClient, projectId, region);
var controller = Botkit.slackbot();
var bot = controller.spawn({
  token: slackToken
});

bot.startRTM(function (err, bot, payload) {
  if (err) {
    throw new Error('Could not connect to Slack');
  }
});

controller.on('bot_channel_join', function (bot, message) {
  bot.reply(message, "I'm here!");
});

controller.hears(['gcpbot d(eploy)? detail (.*)'], ['message_received','ambient'], function (bot, message) {
  var depId = message.match[2].trim();
  gcpClient.showDeployDetail(bot, message, depId);
});

controller.hears(['gcpbot d(eploy)? summary (.*)'], ['message_received','ambient'], function (bot, message) {
  var user = message.match[2].trim();
  var email = user.substring( user.indexOf(':') + 1, user.indexOf('|'));
  console.log(email);

  gcpClient.showDeploySummary(bot, message, email);
});

controller.hears(['gcpbot deploy list'], ['message_received','ambient'], function (bot, message) {
  gcpClient.showDeployList(bot, message);
});

// DEPLOYMENT of a file from github
controller.hears(['gcpbot d(eploy)? new (.*) (.*)'], ['message_received','ambient'], function (bot, message) {
  var repo = message.match[2].trim();
  var depFile = message.match[3].trim();
  
  gcpClient.newDeploy(bot, message, repo, depFile);
});

controller.hears('gcpbot h(elp)?', ['message_received', 'ambient'], function (bot, message) {
  var packs = '`' + Object.keys(Metrics.packages).join('`, `') + '`';
  var help = 'I will respond to the following messages: \n' +
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
  var metricString = message.match[3];
  var parsedMetrics = parseMetricsFromMessage(metricString);
  gcpClient.listMetrics(bot, message, parsedMetrics);
});

controller.hears(['gcpbot m(onitor)? p(ack)?(.*)?'], ['message_received','ambient'], function (bot, message) {
  var metricString = (message.match[3] || '').trim();
  
  // First see if there's a named package
  if (Metrics.packages[metricString]) {
    var metrics = Metrics.packages[metricString].metrics;
    gcpClient.monitorMetricList(bot, message, metrics);
  } else {
    var packages = '`' + Object.keys(Metrics.packages).join('`, `') + '`';
    bot.reply(message, 'Metric pack name is required. Try one of: ' + Metrics.packages);
  }
});

controller.hears(['gcpbot m(onitor)?(.*)?'], ['message_received','ambient'], function (bot, message) {
  var metricString = message.match[2];
  var metrics = parseMetricsFromMessage(metricString);
  if ( metrics ) {
    gcpClient.monitorMetricList(bot, message, metrics);
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
