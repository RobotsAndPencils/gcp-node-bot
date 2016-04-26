var request = require('request');
var google = require('googleapis');
var manager = google.deploymentmanager('v2');
var monitoring = google.monitoring('v3');
var yaml = require('yamljs');
var url = require('url');
var Metrics = require('./metrics');
var GoogleChart = require('./googlechart');
var Utils = require('./utils');

function GCPClient(jwtClient) {
  this.jwtClient = jwtClient;
}

/**
 * Shows the detail for a specific deployment, including resources.
 * 
 * @param {object} userData - an object containing the projectId and region to use
 * @param {*} bot - the botkit bot to send messages with
 * @param {*} message - the slack message to reply to
 * @param {string} deployId - the id of the deployment to show detail for
 */
GCPClient.prototype.showDeployDetail = function(userData, bot, message, deployId) {
  var client = this;
  this.jwtClient.authorize(function(err, tokens) {
    if (err) {
      console.log(err);
      return;
    }

    bot.reply(message, "Deployment detail for deployment " + deployId);
    checkDeploy(userData, client, bot, message, deployId);
  });
};

/**
 * Shows a list of all deployments in the project
 * 
 * @param {object} userData - an object containing the projectId and region to use
 * @param {*} bot - the botkit bot to send messages with
 * @param {*} message - the slack message to reply to
 */
GCPClient.prototype.showDeployList = function(userData, bot, message) {
  var client = this;
  this.jwtClient.authorize(function(err, tokens) {
    if (err) {
      console.log(err);
      return;
    }

    bot.reply(message, "Deployment list: ");
    listDeployments(userData, client, bot, message);
  });
};

/**
 * Shows a summary of the deploys associated with a certain email address
 * 
 * @param {object} userData - an object containing the projectId and region to use
 * @param {*} bot - the botkit bot to send messages with
 * @param {*} message - the slack message to reply to
 * @param {string} email - the email address to search by
 */
GCPClient.prototype.showDeploySummary = function(userData, bot, message, email) {
  var client = this;
  this.jwtClient.authorize(function(err, tokens) {
    if (err) {
      console.log(err);
      return;
    }

    bot.reply(message, "Deployment summary for " + email);
    var filterStr = 'operation.user eq ' + email;
    listDeployments(userData, client, bot, message, filterStr);
  });
};

/**
 * Creates a new deploy from a specified yaml file in a github repo.
 * 
 * @param {object} userData - an object containing the projectId and region to use
 * @param {*} bot - the botkit bot to send messages with
 * @param {*} message - the slack message to reply to
 * @param {string} repo - the github repo to look in
 * @param {string} depFile - the name of the config file (without extension)
 */
GCPClient.prototype.newDeploy = function(userData, bot, message, repo, depFile) {
  var client = this;
  var yamlName = depFile + ".yaml";
  var ghPref = 'https://github.com/';
  var rawMaster = '/raw/master/';
  var baseURL = ghPref + repo + rawMaster;

  fetchConfiguration(baseURL, yamlName, function(configString, imports, errors) {
    if (errors) {
      for(i = 0; i < errors.length; i++) {
        bot.reply(message, '🚫 ' + errors[i]);
      }
    }
    
    if (!configString) {
      if (!errors) {
        bot.reply(message, "yaml file not found: " + url.resolve(baseURL, yamlName));
      }
      return;
    }
    
    //now do the auth and call to manifest
    client.jwtClient.authorize(function(err, tokens) {
      if (err) {
        console.log(err);
        return;
      }

      var depName = depFile + Math.floor(new Date() / 1000);
      // Now insert the dependency
      manager.deployments.insert({
          auth: this.jwtClient,
          project: userData.projectId,
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
        function(err, resp) {
          if(err) {
            console.log(err);
            return;
          }
          checkDeploy(userData, client, bot, message, depName);
        });
      });
    });
};

/**
 * Show a list of metrics with an optional array of filter strings. The filter works by matching
 * any metric that contains ALL the provided strings. Metrics will be truncated at 50.
 * 
 * @param {object} userData - an object containing the projectId and region to use
 * @param {*} bot - the botkit bot to send messages with
 * @param {*} message - the slack message to reply to
 * @param {string[]} metricFilters - an array of Strings that filters the metrics to only ones that contain ALL of the Strings
 */
GCPClient.prototype.listMetrics = function(userData, bot, message, metricFilters) {
  var client = this;
  var query = '';
  if (metricFilters) {
    query = 'metric.type : "' + metricFilters.join('" AND metric.type : "') + '"';
  }
  
  this.jwtClient.authorize(function(err, tokens) {
    if (err) {
      console.log(err);
      return;
    }
    
    monitoring.projects.metricDescriptors.list({
      auth: client.jwtClient,
      name: 'projects/' + userData.projectId,
      filter: query },
      function(err, resp) {

        if(err) {
          console.log(err);
          return;
        }

        var metrics = resp.metricDescriptors;
        console.log("metrics:", metrics.length, "query:", query);

        var limit = Math.min(50, metrics.length);
        var responseMessage = limit >= metrics.length ? (metrics.length + " metrics:") : limit + ' of ' + metrics.length + ' metrics. Filter the results to find what you are looking for.';
        for(i = 0; i < limit; i++) {
          responseMessage += "\n `" + metrics[i].type + "` - " + metrics[i].description;
        }
        bot.reply(message, responseMessage);

      }
    );
  });
};

/**
 * Reply with the results of monitoring a list of metrics.
 * 
 * @param {object} userData - an object containing the projectId and region to use
 * @param {slackbot} bot - the botkit bot to send messages with
 * @param {message} message - the slack message to reply to
 * @param {string[]} metrics - a list of GCP metrics that should be monitored. e.g. "compute.googleapis.com/instance/cpu/utilization"
 * @param {string} instance - the instance to filter to
 */
GCPClient.prototype.monitorMetricList = function(userData, bot, message, metrics, instance) {
  var client = this;
  this.jwtClient.authorize(function(err, tokens) {
    if (err) {
      console.log(err);
      return;
    }
    monitorMetrics(userData, client, bot, message, metrics, instance);
  });
};

/**
 * Reply with the results of monitoring a list of metrics from a predefined pack.
 * 
 * @param {object} userData - an object containing the projectId and region to use
 * @param {slackbot} bot - the botkit bot to send messages with
 * @param {message} message - the slack message to reply to
 * @param {string} packName - the name of a predefined list of metrics e.g. "cpu", "simple"
 * @returns {boolean} true if the pack exists, false otherwise 
 */
GCPClient.prototype.monitorMetricPack = function(userData, bot, message, packName, instance) {
  if (Metrics.packages[packName]) {
    var metrics = Metrics.packages[packName].metrics;
    this.monitorMetricList(userData, bot, message, metrics, instance);
    return true;
  } else {
    return false;
  }
};

function emojiForStatus(status) {
  if (status == "PENDING") {
    return "✋";
  } else if (status == "RUNNING") {
    return "🏃";
  } else if (status == "DONE" || status == "COMPLETE") {
    return "✅";
  }
}

function fetchConfiguration(baseURL, yamlName, callback) {
  //get the file, use it as the resource info supplied to the insert cmd in gcp
  var configString = "";
  var files = [{ path: yamlName }];
  
  fetchNextFile(files, baseURL, true, function(body, imports, errors) {
    callback(body, imports, errors);
  });
}

function fetchNextFile(files, baseURL, isConfig, callback) {
  var file = files.shift();
  // The recursion terminating case
  if (!file) {
    callback(null, [], []);
    return;
  }
  
  var fileImports = [];
  var errors = [];
  var fileURL = url.resolve(baseURL, file.path);
  console.log('fetching', isConfig ? 'config' : 'template', fileURL);

  request(fileURL, function (error, response, body) {
    if (!error && response.statusCode == 200) {
      var yamlContent = yaml.parse(body);
      files = files.concat(yamlContent.imports);
      if (!isConfig) {
        fileImports.push({
          name: file.path,
          content: body
        });
      }
    } else {
      body = null;
      var errorMsg = error || (response.statusCode + ' response status');
      errors.push(errorMsg + ' for ' + fileURL );
    }
    
    // Trigger the call for the next file (also handles empty case..)
    // Build up the imports and errors list by combining in the callback.
    fetchNextFile(files, baseURL, false, function (nextBody, nextImports, nextErrors) {
      callback(body, fileImports.concat(nextImports), errors.concat(nextErrors));
    });
  });
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
      " https://console.cloud.google.com/deployments?authuser=1&project=" + process.env.PROJECT_ID;
  }
  bot.reply(message, replyMessage);
  
  // print out the errors if the deployed is complete and had errors
  if( deploy.operation.status == "DONE" || deploy.operation.status == "COMPLETE" ) {
    if ( deploy.operation.error ) {
      var errors = deploy.operation.error.errors;
      for ( var errorNum in errors ) {
        var error = errors[errorNum];
        console.log("error:", error);
        bot.reply(message, "🚫 *Error*: " + error.code + " *location*: " + error.location + " *message*: " + error.message);
      }
    }
  }
}

function checkDeploy(userData, client, bot, message, depName) {
  var status = "";
  var filterStr = 'name eq ' + depName;

  return manager.deployments.list({
    auth: client.jwtClient,
    project: userData.projectId,
    region: userData.region,
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
          checkDeploy(userData, client, bot, message, depName);
        }, 2000);
      }
      else {
        //now get the resources based on the dep name
        manager.resources.list({
            auth: client.jwtClient,
            project: userData.projectId,
            deployment: depName
          },
          function(err, resp) {

            if(err) {
              console.log(err);
              return;
            }
            if(!resp.resources) {
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
              var propObj = {};
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

function invertMetricsData(responseData) {
  var instanceData = {};
  for (var metric in responseData) {
    var timeSeries = responseData[metric];
    for (var i = 0; i < timeSeries.length; i++) {
      var instance = timeSeries[i].metric.labels.instance_name;
      if (!instanceData[instance]) {
        instanceData[instance] = {};
      }
      instanceData[instance][metric] = timeSeries[i];
    }
  }
  return instanceData;
}

function outputMetricsData(bot, message, metrics, responseData) {  
  // Swap around the data to be per instance instead of per metric
  var instanceData = invertMetricsData(responseData);
  
  // Now build one slack message per instance
  var hasData = false;
  var count = 0;
  for (var instance in instanceData) {
    hasData = true;
    var instanceMessage = '*' + instance + '*\n';
    var chart = new GoogleChart(400, 150);
    var attachments = [];
    
    for (var i in metrics) {
      var metric = metrics[i];
      var timeSeries = instanceData[instance][metric];
      var attachment = {
        'title': metric,
        'color': 'good'
      };
      if (timeSeries) {
        var values = [];
        var points = timeSeries.points;
        if (points && points.length > 0) {
          var newestPoint = points[0];
          var oldestPoint = points[points.length-1];
          var newestValue = getTimeSeriesValue(newestPoint);
          for( j = 0; j < points.length; j++ ) {
              value = getTimeSeriesValue(points[j]);
              values.push(value);
          }
          
          var startTime = Utils.formatDate(new Date(oldestPoint.interval.startTime));
          var endTime = Utils.formatDate(new Date(newestPoint.interval.endTime));
          var imageUrl = chart.buildUrl(values, metric, startTime, endTime);
          attachment.image_url = imageUrl;
          attachment.title_link = imageUrl;
          attachment.fallback = Utils.round(newestValue, 3) + ' at ' + newestPoint.interval.endTime;
        }
      } else {
        attachment.text = 'No data\n';
        attachment.color = 'warning';
      }
      attachments.push(attachment);
    }
    
    bot.reply(message, {
      'text': instanceMessage,
      'username': bot.identity.name, // Required to add image attachments
      'attachments': attachments
    }); 
  }
  
  if (!hasData) {
    bot.reply(message, 'No monitor data returned.');
  }
}

function monitorSeries(userData, client, metric, instance, callback) {
  var startDate = new Date();
  var endDate = new Date();
  startDate.setDate(startDate.getDate() - 1);
  
  var filter = 'metric.type = "' + metric + '"';
  if(instance) {
    filter += ' AND metric.label.instance_name = "' + instance + '"';
  }
  console.log('filter:', filter, 'instance:', instance);
  monitoring.projects.timeSeries.list({
      auth: client.jwtClient,
      name: 'projects/' + userData.projectId,
      filter: filter,
      'interval.startTime': startDate.toJSON(),
      'interval.endTime': endDate.toJSON(),
      'aggregation.perSeriesAligner': Metrics.alignments[metric] || 'ALIGN_MAX',
      'aggregation.alignmentPeriod': Utils.calculateIntervalLength(startDate, endDate, 350) + 's'
    },
    function( err, resp ) {
      if (err) {
        console.log(err);
        callback(metric, null, err);
        return;
      }
      
      if (resp.timeSeries) {
        callback(metric, resp.timeSeries);
      } else {
        callback(metric);
        console.log("timeSeries response:", resp);
      }
    }
  );
}

function getTimeSeriesValue(point) {
  if (point.value.doubleValue) {
    return parseFloat(point.value.doubleValue);
  } else if (point.value.int64Value) {
    return parseInt(point.value.int64Value);
  }
  return;
}

function listDeployments(userData, client, bot, message, filterStr) {
  var params = {
    auth: client.jwtClient,
    project: userData.projectId,
    region: userData.region };
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

function monitorMetrics(userData, client, bot, message, metrics, instance) {
  var responseData = {};
  var metricsComplete = 0;
  
  var monitorCallback = function(metric, timeSeries, error) {
    if (error) {
      bot.reply(message, error.message);
    }
    if (timeSeries) {
      responseData[metric] = timeSeries;
    }
    metricsComplete++;
    if (metricsComplete == metrics.length) {
      outputMetricsData(bot, message, metrics, responseData);
    }
  };
  
  for (var i in metrics) {
    var metric = metrics[i];
    responseData[metric] = [];
    monitorSeries(userData, client, metric, instance, monitorCallback);
  }
}

module.exports = GCPClient;
