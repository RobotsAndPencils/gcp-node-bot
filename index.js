var Botkit = require('botkit')
var jsonfile = require('jsonfile')
var querystring = require('querystring');
var http = require('http');
var request = require('request');
var google = require('googleapis');
var manager = google.deploymentmanager('v2');
var monitoring = google.cloudmonitoring('v2beta2');
var compute = google.compute('v1');
var yaml = require('yamljs');

// Expect a SLACK_TOKEN environment variable
var slackToken = process.env.SLACK_TOKEN
if (!slackToken) {
  console.error('SLACK_TOKEN is required!')
  process.exit(1)
}

// Expect a PROJECT_ID environment variable
var projectId = process.env.PROJECT_ID;
if (!projectId) {
  console.error('PROJECT_ID is required!')
  process.exit(1)
}

// Expect a PROJECT_REGION environment variable
var region = process.env.PROJECT_REGION;
if (!region) {
  console.error('PROJECT_REGION is required!')
  process.exit(1)
}
// TODO: this should probably be part of the monitor command
var zone = "us-central1-a";

// TODO change this or just remove once auth is done
var keyfile = 'gcp-bot-test-9c7dbb93f7ba.json';

var key = require("./" + keyfile);
var jwtClient = new google.auth.JWT(key.client_email, null, key.private_key,
  [
    'https://www.googleapis.com/auth/ndev.cloudman',
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/monitoring',
  ], null);

var controller = Botkit.slackbot()
var bot = controller.spawn({
  token: slackToken
})

bot.startRTM(function (err, bot, payload) {
  if (err) {
    throw new Error('Could not connect to Slack')
  }
})

controller.on('bot_channel_join', function (bot, message) {
  bot.reply(message, "I'm here!")
})

controller.hears(['gcpbot deploy detail (.*)'], ['message_received','ambient'], function (bot, message) {

  var depId = message.match[1].trim();

  jwtClient.authorize(function(err, tokens) {
    if (err) {
      console.log(err);
      return;
    }

    bot.reply(message, "Deployment detail for deployment " + depId);

    checkDeploy(bot, message, jwtClient, depId );
  });
});

controller.hears(['gcpbot deploy summary (.*)'], ['message_received','ambient'], function (bot, message) {

    var user = message.match[1].trim();

    var email = user.substring( user.indexOf(':') + 1, user.indexOf('|'));
    console.log(email);

    jwtClient.authorize(function(err, tokens) {
      if (err) {
        console.log(err);
        return;
      }

      bot.reply(message, "Deployment summary for " + email);

      var filterStr = 'operation.user eq ' + email;

      // Make an authorized request to list Drive files.
      manager.deployments.list({
        auth: jwtClient,
        project: projectId,
        region: region,
        filter: filterStr },
        function(err, resp) {
          if( err) {
            console.log(err);
            return;
          }

          if( !resp.deployments ) {
            bot.reply(message, "no deployments to report on");
            return;
          }

          var deployTotalCount = resp.deployments.length;
          var deployActiveCount = 0;

          var activeDeploys = [];
          var deadDeploys = [];


          for ( i = 0; i < resp.deployments.length; i++ ) {
              if( resp.deployments[i].operation.status != 'DONE' ) {
                deployActiveCount++;
                activeDeploys.push( resp.deployments[i] );
              }
              else {
                deadDeploys.push( resp.deployments[i] );
              }
          }

          bot.reply(message, "deployment total count: " + deployTotalCount);
          bot.reply(message, "deployments active: " + deployActiveCount);

          for ( i = 0; i < activeDeploys.length; i++ ) {
            bot.reply(message, "Deploy " +
              activeDeploys[i].name + " with id " + activeDeploys[i].id + " Active: started at " +
              activeDeploys[i].operation.startTime + " by " +
              activeDeploys[i].operation.user + " ---- deployment is " +
              activeDeploys[i].operation.progress + " percent complete. To view progress, navigate to " +
              " https://console.cloud.google.com/deployments?authuser=1&project=" + process.env.PROJECT_ID );
          }

          for ( i = 0; i < deadDeploys.length; i++ ) {
            bot.reply(message, "Deploy " +
              deadDeploys[i].name + " with id " + deadDeploys[i].id + " COMPLETE: started at " +
              deadDeploys[i].operation.startTime + " by " +
              deadDeploys[i].operation.user + " ---- deployment completed at " +
              deadDeploys[i].operation.endTime );
          }
        });
    });
})

controller.hears(['gcpbot deploy list'], ['message_received','ambient'], function (bot, message) {

    jwtClient.authorize(function(err, tokens) {
      if (err) {
        console.log(err);
        return;
      }

      bot.reply(message, "Deployment list: ");

      // Make an authorized request to list Drive files.
      manager.deployments.list({
        auth: jwtClient,
        project: projectId,
        region: region },
        function(err, resp) {
          if( err) {
            console.log(err);
            return;
          }

          if( !resp.deployments ) {
            bot.reply(message, "no deployments to report on");
            return;
          }

          var deployTotalCount = resp.deployments.length;
          var deployActiveCount = 0;

          var activeDeploys = [];
          var deadDeploys = [];


          for ( i = 0; i < resp.deployments.length; i++ ) {
              if( resp.deployments[i].operation.status != 'DONE' ) {
                deployActiveCount++;
                activeDeploys.push( resp.deployments[i] );
              }
              else {
                deadDeploys.push( resp.deployments[i] );
              }
          }

          bot.reply(message, "deployment total count: " + deployTotalCount);
          bot.reply(message, "deployments active: " + deployActiveCount);

          for ( i = 0; i < activeDeploys.length; i++ ) {
            bot.reply(message, "Deploy " +
              activeDeploys[i].name + " with id " + activeDeploys[i].id + " Active: started at " +
              activeDeploys[i].operation.startTime + " by " +
              activeDeploys[i].operation.user + " ---- deployment is " +
              activeDeploys[i].operation.progress + " percent complete. To view progress, navigate to " +
              " https://console.cloud.google.com/deployments?authuser=1&project=" + process.env.PROJECT_ID );
          }

          for ( i = 0; i < deadDeploys.length; i++ ) {
            bot.reply(message, "Deploy " +
              deadDeploys[i].name + " with id " + deadDeploys[i].id + " COMPLETE: started at " +
              deadDeploys[i].operation.startTime + " by " +
              deadDeploys[i].operation.user + " ---- deployment completed at " +
              deadDeploys[i].operation.endTime );
          }
        });
    });
})

// ticketing NOT YET IMPLEMENTED IN NODE API

// DEPLOYMENT of a file from github
controller.hears(['gcpbot deploy new (.*) (.*)'], ['message_received','ambient'], function (bot, message) {

  var ghPref = 'https://github.com/';
  var rawMaster = '/raw/master/';

  //parse the stuff from inbound
  var repo = message.match[1].trim();
  var yaml = message.match[2].trim();

  var fullPath = ghPref + repo + rawMaster + yaml + ".yaml";

  //get the file, use it as the resource info supplied to the insert cmd in gcp
  var resContent = "";

  request(fullPath, function (error, response, body) {

    if (!error && response.statusCode == 200) {
      resContent = body;

      //now do the auth and call to manifest
      jwtClient.authorize(function(err, tokens) {
        if (err) {
          console.log(err);
          return;
        }

        var depName = yaml + Math.floor(new Date() / 1000);

        manager.deployments.insert({
          auth: jwtClient,
          project: projectId,
          resource: {
            name: depName,
            target: {
              config: {
                content: resContent
              }
            }
          }
         },
         function( err, resp ) {

            if( err ) {
              console.log(err);
              return;
            }

            var complete = false;

            checkDeploy(bot, message, jwtClient, depName );
          });
        });
      }
      else {
        console.log(error, response.statusCode);
        bot.reply(message, "yaml file not found: " + fullPath);
      }
  });
});


function checkDeploy( bot, message, jwtClient, depName ) {

  var status = "";
  var filterStr = 'name eq ' + depName;

  return manager.deployments.list({
    auth: jwtClient,
    project: projectId,
    region: region,
    filter: filterStr },
    function(err, resp) {
      if( err) {
        console.log(err);
        return;
      }

      if( !resp.deployments ) {
        bot.reply(message, "no deployment found");
        return;
      }

      var currDeploy = resp.deployments[0];

      bot.reply(message, "Deploy " +
        currDeploy.name + " status = " + currDeploy.operation.status + " : started at " +
        currDeploy.operation.startTime + " by " +
        currDeploy.operation.user);
      if (currDeploy.operation.endTime) {
        bot.reply(message, "Deployment completed at " + currDeploy.operation.endTime);
      }

      if( currDeploy.operation.status != "DONE" && currDeploy.operation.status != "COMPLETE" ) {
        bot.reply(message, "Current progress: " + currDeploy.operation.progress);

        setTimeout(function() {
          checkDeploy( bot, message, jwtClient, depName );
        }, 2000);
      }
      else {
        //now get the resources based on the dep name
        manager.resources.list({
          auth: jwtClient,
          project: projectId,
          deployment: depName
         },
          function( err, resp ) {

            if( err ) {
              console.log(err);
              return;
            }

            //for each resource, check status of machine - if there's an error - check logs
            resList = resp.resources;
            bot.reply(message, "Deployment " + depName + " resource summary");

            for ( var i = 0; i < resList.length; i++ ) {
              var resName = resList[i].name;
              var resType = resList[i].type;

              //get the yaml for the properties, and pull out some interesting info
              var propObj =  {}
              if (resList[i].finalProperties) {
                propObj = yaml.parse(resList[i].finalProperties);
              }
              bot.reply(message, "Resource #" + i + ":");
              bot.reply(message, "*Name:* " + resName +
                "\n*Type:* " + resType +
                "\n*Machine Class:* " + propObj.machineType +
                "\n*Zone:* " + propObj.zone );
            }
          });
        return;
      }
    });
}

controller.hears('gcpbot help', ['message_received', 'ambient'], function (bot, message) {
  var help = 'I will respond to the following messages: \n' +
      '`gcpbot deploy list` for a list of all deployment manager jobs and their status.\n' +
      '`gcpbot deploy summary <email>` for a list of all deployment manager jobs initiated by the provided user and their status.\n' +
      '`gcpbot deploy new <repo> <depfile>` to create a new deployment using a yaml file in the github repo identified with a yaml file called <depfile>.yaml.\n' +
      '`gcpbot deploy detail <depname>` to show info and status for a given deployment manager job.\n' +
      '`gcpbot monitor metrics <filter...>` to list all metrics. Add one or more strings to filter the results (space-separated list, results match ALL strings).\n' +
      '`gcpbot monitor <metrics...>` to show the values for a set of metrics (space-separated list).\n' +
      '`gcpbot help` to see this again.'
  bot.reply(message, help)
})

controller.hears(['gcpbot monitor metrics (.*)', 'gcpbot monitor metrics', 'gcpbot m metrics (.*)', 'gcpbot m metrics'], ['message_received','ambient'], function (bot, message) {
  jwtClient.authorize(function(err, tokens) {
    if (err) {
      console.log(err);
      return;
    }
    
    var parsedMetrics = parseMetricsFromMessage(message);
    var query = parsedMetrics ? parsedMetrics.join(' ') : '';
    monitoring.metricDescriptors.list({
      auth: jwtClient,
      project: projectId,
      query: query,
      count: 100 },
      function( err, resp ) {

        if( err ) {
          console.log(err);
          return;
        }

        metrics = resp.metrics;
        console.log("metrics:", metrics.length, "query:", query);

        var responseMessage = metrics.length + " metrics:";
        for( i = 0; i < metrics.length; i++ ) {
          responseMessage += "\n `" + metrics[i].name + "` - " + metrics[i].description;
        }
        bot.reply(message, responseMessage);

      }
    );
  });
});

controller.hears(['gcpbot monitor (.*)', 'gcpbot m (.*)', 'gcpbot monitor', 'gcpbot m'], ['message_received','ambient'], function (bot, message) {

  jwtClient.authorize(function(err, tokens) {
    if ( err ) {
      console.log(err);
      return;
    }
    var metrics = parseMetricsFromMessage(message) || ['compute.googleapis.com/instance/cpu/utilization']; // Parse a space-separated list of metrics
    var responseData = {};
    var metricsComplete = 0;
    
    for (var i in metrics) {
      var metric = metrics[i];
      responseData[metric] = []
      monitorSeries(metric, function(metric, timeseries) {
        if (timeseries) {
          responseData[metric] = timeseries;
        }
        metricsComplete++;
        if (metricsComplete == metrics.length) {
          outputData(bot, message, metrics, responseData);
        }
      });
    }
  });
});

function outputData(bot, message, metrics, responseData) {
  // Swap around the data to be per instance instead of per metric
  var instanceData = {};
  for (var metric in responseData) {
    var timeseries = responseData[metric];
    for (i = 0; i < timeseries.length; i++) {
      var instance = timeseries[i].timeseriesDesc.labels["compute.googleapis.com/instance_name"];
      if (!instanceData[instance]) {
        instanceData[instance] = {}
      }
      instanceData[instance][metric] = timeseries[i];
    }
  }
  
  // Now build one slack message per instance
  for (var instance in instanceData) {
    var instanceMessage = '*' + instance + '*\n';
    
    for (var i in metrics) {
      var metric = metrics[i];
      var timeseries = instanceData[instance][metric];
      if (timeseries) {
        var desc = timeseries.timeseriesDesc.labels["compute.googleapis.com/instance_name"]; 
        var points = timeseries.points;
        if (points && points.length > 0) {
          var newestPoint = points[0];
          var newestValue = getTimeseriesValue(newestPoint);
          var avg = 0;
          for( j = 0; j < points.length; j++ ) {
              avg += getTimeseriesValue(points[j]);
          }
          avg = avg / points.length;
          
          instanceMessage += metric + ': ' + newestValue.toFixed(3) + ' at ' + newestPoint.end + ' *|* ' + avg.toFixed(3) + ' average\n';
        }
      } else {
        instanceMessage += metric + ': No data\n';
      }
    }
    bot.reply(message, instanceMessage);
  }
  
  
}

function monitorSeries(metric, callback) {
  monitoring.timeseries.list({
      auth: jwtClient,
      project: projectId,
      metric: encodeURIComponent(metric),
      youngest: new Date().toJSON()
    },
    function( err, resp ) {
      if (err) {
        console.log(err);
        return;
      }
      
      if (resp.timeseries) {
        callback(metric, resp.timeseries);
      } else {
        callback(metric, null);
        console.log("timeseries response:", resp);
      }
    }
  );
}

function parseMetricsFromMessage(message) {
  var metricString = message.match[1];
  if (metricString) {
      var metrics = metricString.trim().split(' ');
      // Pull metric out of the Slack link syntax (because it looks like a URL)
      for (i = 0; i < metrics.length; i++) {
        var metric = metrics[i]
        var result = /<.*\|(.*)>/.exec(metric);
        if (result) {
          metrics[i] = result[1] || metric;
        }
      }
      return metrics;
  }
  return null;
}

function getTimeseriesValue(point) {
  if (point.doubleValue) {
    return parseFloat(point.doubleValue);
  } else if (point.int64Value) {
    return parseInt(point.int64Value);
  }
  return;
}
