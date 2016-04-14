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
var path = require('path');
var url = require('url');
var metricPackages = require('./metricPackages');

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

// TODO change this or just remove once auth is done
var keyfile = 'gcp-test-c4e5388e828e.json';

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

controller.hears(['gcpbot d(eploy)? detail (.*)'], ['message_received','ambient'], function (bot, message) {

  var depId = message.match[2].trim();

  jwtClient.authorize(function(err, tokens) {
    if (err) {
      console.log(err);
      return;
    }

    bot.reply(message, "Deployment detail for deployment " + depId);

    checkDeploy(bot, message, jwtClient, depId );
  });
});

controller.hears(['gcpbot d(eploy)? summary (.*)'], ['message_received','ambient'], function (bot, message) {

    var user = message.match[2].trim();

    var email = user.substring( user.indexOf(':') + 1, user.indexOf('|'));
    console.log(email);

    jwtClient.authorize(function(err, tokens) {
      if (err) {
        console.log(err);
        return;
      }

      bot.reply(message, "Deployment summary for " + email);
      var filterStr = 'operation.user eq ' + email;
      listDeployments(bot, message, filterStr);
    });
})

controller.hears(['gcpbot deploy list'], ['message_received','ambient'], function (bot, message) {

    jwtClient.authorize(function(err, tokens) {
      if (err) {
        console.log(err);
        return;
      }

      bot.reply(message, "Deployment list: ");
      listDeployments(bot, message);
    });
});

// ticketing NOT YET IMPLEMENTED IN NODE API

// DEPLOYMENT of a file from github
controller.hears(['gcpbot d(eploy)? new (.*) (.*)'], ['message_received','ambient'], function (bot, message) {

  //parse the stuff from inbound
  var repo = message.match[2].trim();
  var yamlName = message.match[3].trim();
  
  var ghPref = 'https://github.com/';
  var rawMaster = '/raw/master/';
  var fullPath = ghPref + repo + rawMaster + yamlName + ".yaml";

  fetchConfiguration(fullPath, function(configString, imports) {
    //now do the auth and call to manifest
    jwtClient.authorize(function(err, tokens) {
      if (err) {
        console.log(err);
        return;
      }
      if (!configString) {
        bot.reply(message, "yaml file not found: " + fullPath);
        return;
      }

      var depName = yamlName + Math.floor(new Date() / 1000);
      // Now insert the dependency
      manager.deployments.insert({
          auth: jwtClient,
          project: projectId,
          resource: {
            name: depName,
            target: {
              config: {
                content: configString
              },
              imports: imports
            }
          }
        },
        function( err, resp ) {
          if( err ) {
            console.log(err);
            return;
          }
          checkDeploy(bot, message, jwtClient, depName);
        });
      });
    });
});

function emojiForStatus(status) {
  if (status == "PENDING") {
    return "✋";
  } else if (status == "RUNNING") {
    return "🏃";
  } else if (status == "DONE" || status == "COMPLETE") {
    return "✅";
  }
}

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
        bot.reply(message, "No deployment found");
        return;
      }
      var currDeploy = resp.deployments[0];
      sendDeployDetailReplies(bot, message, resp.deployments[0]);

      if( currDeploy.operation.status != "DONE" && currDeploy.operation.status != "COMPLETE" ) {
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
            if( !resp.resources ) {
              bot.reply(message, "No resourses.");
              return;
            }

            //for each resource, check status of machine - if there's an error - check logs
            resList = resp.resources;
            bot.reply(message, "Deploy *" + depName + "* resource summary:");

            for ( var i = 0; i < resList.length; i++ ) {
              var resName = resList[i].name;
              var resType = resList[i].type;

              //get the yaml for the properties, and pull out some interesting info
              var propObj =  {}
              if (resList[i].finalProperties) {
                propObj = yaml.parse(resList[i].finalProperties);
              }
              bot.reply(message, "📋 Resource #" + i + ":");
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

controller.hears('gcpbot h(elp)?', ['message_received', 'ambient'], function (bot, message) {
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

controller.hears(['gcpbot m(onitor)? m(etrics)?(.*)?'], ['message_received','ambient'], function (bot, message) {
  jwtClient.authorize(function(err, tokens) {
    if (err) {
      console.log(err);
      return;
    }
    
    var metricString = message.match[3]
    var parsedMetrics = parseMetricsFromMessage(metricString);
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

controller.hears(['gcpbot m(onitor)? p(ack)?(.*)?'], ['message_received','ambient'], function (bot, message) {

  jwtClient.authorize(function(err, tokens) {
    if ( err ) {
      console.log(err);
      return;
    }
    
    var metricString = (message.match[3] || '').trim();
    // First see if there's a named package
    if (metricPackages[metricString]) {
      var metrics = metricPackages[metricString].metrics;
      monitorMetrics(bot, message, metrics);
    } else {
      var packages = Object.keys(metricPackages).join('`, `');
      bot.reply(message, 'Metric pack name is required. Try one of: `' + packages + '`');
    }
  });
});

controller.hears(['gcpbot m(onitor)?(.*)?'], ['message_received','ambient'], function (bot, message) {

  jwtClient.authorize(function(err, tokens) {
    if ( err ) {
      console.log(err);
      return;
    }
    
    var metricString = message.match[2];
    var metrics = parseMetricsFromMessage(metricString);
    if ( metrics ) {
      monitorMetrics(bot, message, metrics);
    } else {
      bot.reply(message, "Metrics are required.");
    }
  });
});

function monitorMetrics(bot, message, metrics) {
  var responseData = {};
  var metricsComplete = 0;
  
  for (var i in metrics) {
    var metric = metrics[i];
    responseData[metric] = []
    monitorSeries(metric, function(metric, timeseries, error) {
      if (error) {
        bot.reply(message, error.message);
      }
      if (timeseries) {
        responseData[metric] = timeseries;
      }
      metricsComplete++;
      if (metricsComplete == metrics.length) {
        outputMetricsData(bot, message, metrics, responseData);
      }
    });
  }
}

function outputMetricsData(bot, message, metrics, responseData) {
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
          
          instanceMessage += metric + ': ' + round(newestValue, 3) + ' at ' + newestPoint.end + ' *|* ' +  round(avg, 3) + ' average\n';
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
        callback(metric, null, err);
        return;
      }
      
      if (resp.timeseries) {
        callback(metric, resp.timeseries);
      } else {
        callback(metric);
        console.log("timeseries response:", resp);
      }
    }
  );
}

function parseMetricsFromMessage(metricString) {
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

function round(value, decimals) {
    return Number(Math.round(value+'e'+decimals)+'e-'+decimals);
}

function sendDeployDetailReplies(bot, message, deploy, includeProgressLink) {
  var statusIcon = emojiForStatus(deploy.operation.status);
  var replyMessage = statusIcon + " Deploy *" +
    deploy.name + "* Status: " + deploy.operation.status +
    "\n*Started at*: " + deploy.operation.startTime;
  if (deploy.operation.endTime) {
    replyMessage += " *Completed at*: " + deploy.operation.endTime;
  }
  replyMessage += " by " + deploy.operation.user;
  if (includeProgressLink) {
    replyMessage += "\n" + deploy.operation.progress + "% complete. To view progress, navigate to " +
      " https://console.cloud.google.com/deployments?authuser=1&project=" + process.env.PROJECT_ID
  }
  bot.reply(message, replyMessage);
  
  // print out the errors if the deployed is complete and had errors
  if( deploy.operation.status == "DONE" || deploy.operation.status == "COMPLETE" ) {
    if ( deploy.operation.error ) {
      var errors = deploy.operation.error.errors;
      for ( errorNum in errors ) {
        var error = errors[errorNum];
        console.log("error:", error);
        bot.reply(message, "🚫 *Error*: " + error.code + " *location*: " + error.location + " *message*: " + error.message);
      }
    }
  }
}

function listDeployments(bot, message, filterStr) {
  var params = {
    auth: jwtClient,
    project: projectId,
    region: region };
  if (filterStr) {
    params.filter = filterStr;
  }
  manager.deployments.list(params, function(err, resp) {
      if( err) {
        console.log(err);
        bot.reply(message, "🚫 There was an error listing deployments.");
        return;
      }

      if( !resp.deployments ) {
        bot.reply(message, "No deployments to report on");
        return;
      }

      var deployTotalCount = resp.deployments.length;

      var activeDeploys = [];
      var deadDeploys = [];

      for ( i = 0; i < resp.deployments.length; i++ ) {
          if( resp.deployments[i].operation.status != 'DONE' ) {
            activeDeploys.push( resp.deployments[i] );
          }
          else {
            deadDeploys.push( resp.deployments[i] );
          }
      }

      bot.reply(message, "Deployments *Total Count*: " + deployTotalCount + " *Active*: " + activeDeploys.length);

      for ( i = 0; i < activeDeploys.length; i++ ) {
        sendDeployDetailReplies(bot, message, activeDeploys[i], true);
      }

      for ( i = 0; i < deadDeploys.length; i++ ) {
        sendDeployDetailReplies(bot, message, deadDeploys[i], false);
      }
    });
}

function fetchConfiguration(yamlURL, callback) {
  //get the file, use it as the resource info supplied to the insert cmd in gcp
  var configString = "";
  var imports = [];
  
  console.log('fetching ', yamlURL);
  request(yamlURL, function (error, response, yamlBody) {
    if (!error && response.statusCode == 200) {
      var yamlContent = yaml.parse(yamlBody);
      // If there are no imports, end here
      if (!yamlContent.imports) {
        callback(yamlBody, imports);
      }
      
      // Request each of the imports and then call the callback when they're all done
      var completed = 0;
      for(i = 0; i < yamlContent.imports.length; i++) {
        var imp = yamlContent.imports[i];
        // Resolve the relative path given in the import and the yaml url
        var urlComponents = url.parse(yamlURL);
        urlComponents.pathname = path.join(urlComponents.pathname, '..', imp.path);
        var impURL = url.format(urlComponents);
        console.log('fetching ', impURL);
        // Now fetch this import file
        request(impURL, function (error, response, body) {
          if (!error && response.statusCode == 200) {
            imports.push({
              name: imp.path,
              content: body
            });
          }
          completed++;
          if (completed == yamlContent.imports.length) {
            callback(yamlBody, imports);
          }
        });
      }
    } else {
      callback(null, null);
    }
  });
}
